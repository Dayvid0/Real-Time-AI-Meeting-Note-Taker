import { MAX_FRAME_BYTES, parseServerMessage, type ClientEvent } from './protocol';

type Dependencies = {
  fetch: typeof fetch;
  socket: (url: string, protocols: string[]) => WebSocket;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  random: () => number;
};
const defaults: Dependencies = {
  fetch: (...args) => fetch(...args), socket: (url, protocols) => new WebSocket(url, protocols),
  setTimeout: (...args) => globalThis.setTimeout(...args),
  clearTimeout: id => globalThis.clearTimeout(id), random: Math.random,
};
export function retryDelay(attempt: number, random: number): number {
  return Math.min(15000, 500 * 2 ** Math.min(attempt, 5)) * (0.8 + 0.4 * random);
}

export class WsClient {
  private ws: WebSocket | null = null;
  private ready = false;
  private active = false;
  private ending = false;
  private stopPromise: Promise<void> | null = null;
  private attempt = 0;
  private epoch = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | null = null;
  private finish: (() => void) | null = null;
  private sequence = 0;
  private frameClockMs = 0;
  private sessionOffsetMs = 0;
  private droppedMs = 0;
  private lastProviderSeq = 0;
  private notesBudget: number | undefined;
  private context: (() => { notesContext: { speaker: string; text: string }[]; notesPartial: boolean }) | undefined;

  constructor(private baseUrl: string, private emit: (event: ClientEvent) => void,
              private deps: Dependencies = defaults) {}

  start(context?: () => { notesContext: { speaker: string; text: string }[]; notesPartial: boolean }): void {
    this.context = context;
    this.notesBudget = undefined;
    if (this.active) return;
    this.active = true;
    this.ending = false;
    this.stopPromise = null;
    this.sequence = this.frameClockMs = this.droppedMs = this.attempt = 0;
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (!this.active || this.ending) return;
    const epoch = ++this.epoch;
    this.emit({ type: 'status', state: this.attempt ? 'reconnecting' : 'connecting', text: 'Connecting to transcription service…' });
    const abort = new AbortController();
    this.abort = abort;
    const timeout = this.deps.setTimeout(() => abort.abort(), 10000);
    try {
      const response = await this.deps.fetch(`${this.baseUrl}/v1/token`, { method: 'POST', signal: abort.signal, cache: 'no-store' });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          this.emit({ type: 'error', code: 'token_rejected', message: 'The relay rejected this extension. Reload the extension or check the relay’s allowed browser setting.' });
          this.scheduleRetry();
          return;
        }
        throw new Error('Token request failed');
      }
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('token' in data) || typeof data.token !== 'string') throw new Error('Invalid token');
      if (epoch !== this.epoch || !this.active || this.ending) return;
      const url = new URL('/v1/session', this.baseUrl);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = this.deps.socket(url.href, ['meeting-notes.v1', `auth.${data.token}`]);
      this.ws = ws;
      this.deadline = this.deps.setTimeout(() => this.disconnect(ws, epoch), 15000);
      ws.onopen = () => {
        if (epoch !== this.epoch || this.ending) return;
        ws.send(JSON.stringify({ type: 'start', sampleRate: 16000, channels: 2, ...this.context?.(), ...(this.notesBudget === undefined ? {} : { notesBudget: this.notesBudget }) }));
      };
      ws.onmessage = event => {
        if (epoch !== this.epoch || typeof event.data !== 'string') return;
        try {
          const message = parseServerMessage(event.data);
          if (message.type === 'ready') {
            if (this.ready || this.ending) throw new Error('Unexpected ready');
            this.deps.clearTimeout(this.deadline);
            this.ready = true;
            this.attempt = 0;
            this.sessionOffsetMs = this.frameClockMs;
            this.lastProviderSeq = 0;
            if (this.droppedMs > 0) this.emit({ type: 'gap', message: `${Math.round(this.droppedMs)} ms of audio could not be sent while disconnected.` });
            this.droppedMs = 0;
            this.emit({ type: 'status', state: 'recording', text: 'Streaming tab + microphone audio' });
          } else if (message.type === 'transcript') {
            if (!this.ready || message.seq <= this.lastProviderSeq) throw new Error('Unexpected transcript sequence');
            this.lastProviderSeq = message.seq;
            this.emit({ ...message, seq: ++this.sequence, startMs: message.startMs + this.sessionOffsetMs, endMs: message.endMs + this.sessionOffsetMs });
          } else if (message.type === 'notes_budget') {
            this.notesBudget = message.remaining;
          } else if (message.type === 'summary') {
            this.emit({ ...message, atMs: message.atMs + this.sessionOffsetMs });
          } else if (message.type === 'complete') {
            if (!this.ending) throw new Error('Unexpected completion');
            this.emit(message);
            this.completeStop();
          } else {
            this.emit(message);
          }
        } catch {
          this.emit({ type: 'error', code: 'invalid_response', message: 'Invalid response from relay' });
          this.disconnect(ws, epoch);
        }
      };
      ws.onerror = () => this.disconnect(ws, epoch);
      ws.onclose = event => {
        if (event.code === 1008 && !this.ending) {
          this.emit({ type: 'error', code: 'token_expired', message: 'The connection permission expired or was rejected. Reconnecting with fresh permission…' });
        }
        this.disconnect(ws, epoch);
      };
    } catch {
      if (epoch === this.epoch && this.active && !this.ending) {
        this.emit({ type: 'error', code: 'server_down', message: 'Cannot reach the local transcription service. It will keep retrying automatically.' });
        this.scheduleRetry();
      }
    } finally {
      this.deps.clearTimeout(timeout);
      if (this.abort === abort) this.abort = null;
    }
  }

  private disconnect(ws: WebSocket, epoch: number): void {
    if (epoch !== this.epoch) return;
    ++this.epoch;
    this.ready = false;
    this.deps.clearTimeout(this.deadline);
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    ws.close();
    this.ws = null;
    if (this.ending) {
      this.emit({ type: 'error', code: 'finalization_failed', message: 'Connection closed before all final transcripts arrived' });
      this.completeStop();
    } else if (this.active) {
      this.emit({ type: 'gap', message: 'Connection lost. Audio sent just before the disconnect may be missing.' });
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (!this.active || this.ending || this.retryTimer !== undefined) return;
    const delay = retryDelay(this.attempt++, this.deps.random());
    this.emit({ type: 'status', state: 'reconnecting', text: `Relay unavailable. Retrying in ${(delay / 1000).toFixed(1)}s…` });
    this.retryTimer = this.deps.setTimeout(() => { this.retryTimer = undefined; void this.connect(); }, delay);
  }

  send(frame: ArrayBuffer): boolean {
    if (!frame.byteLength || frame.byteLength > MAX_FRAME_BYTES || frame.byteLength % 4) throw new Error('Invalid stereo frame');
    if (!this.active || this.ending) return false;
    const duration = frame.byteLength / 64;
    this.frameClockMs += duration;
    if (!this.ready || !this.ws || this.ws.readyState !== 1) {
      this.droppedMs += duration;
      return false;
    }
    if (this.ws.bufferedAmount + frame.byteLength > MAX_FRAME_BYTES * 10) {
      this.droppedMs += duration;
      this.disconnect(this.ws, this.epoch);
      return false;
    }
    try { this.ws.send(frame); return true; }
    catch { this.droppedMs += duration; this.disconnect(this.ws, this.epoch); return false; }
  }

  resumeAfterWake(sleptMs: number): void {
    if (!this.active || this.ending || !Number.isFinite(sleptMs) || sleptMs < 5000) return;
    this.emit({ type: 'gap', message: `Computer sleep or pause lasted about ${Math.round(sleptMs / 1000)} seconds. Audio during that time may be missing.` });
    this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.abort?.abort();
    const ws = this.ws;
    if (ws) this.disconnect(ws, this.epoch);
    this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.attempt = 0;
    void this.connect();
  }

  stop(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.ending) return this.stopPromise ?? Promise.resolve();
    this.ending = true;
    this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.abort?.abort();
    this.emit({ type: 'status', state: 'stopping', text: 'Waiting for final transcript lines…' });
    this.stopPromise = new Promise(resolve => {
      this.finish = resolve;
      if (!this.ready || !this.ws || this.ws.readyState !== 1) {
        this.completeStop();
        return;
      }
      this.deps.clearTimeout(this.deadline);
      this.deadline = this.deps.setTimeout(() => {
        this.emit({ type: 'error', code: 'finalization_timeout', message: 'Timed out waiting for final transcript lines' });
        this.completeStop();
      }, 45000);
      try { this.ws.send(JSON.stringify({ type: 'end' })); }
      catch {
        this.emit({ type: 'error', code: 'finalization_failed', message: 'Could not request final transcript lines' });
        this.completeStop();
      }
    });
    return this.stopPromise;
  }

  private completeStop(): void {
    this.active = this.ready = false;
    ++this.epoch;
    this.deps.clearTimeout(this.deadline);
    this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.emit({ type: 'status', state: 'stopped', text: 'Stopped' });
    this.finish?.();
    this.finish = null;
  }
}
