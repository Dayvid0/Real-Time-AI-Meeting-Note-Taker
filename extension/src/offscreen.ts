import { saveSession } from './lib/db';
import { notesContext } from './lib/notes-context';
import { WsClient } from './lib/ws-client';
import { emptySession, reduceSession, type ViewEvent } from './lib/session-view';

declare const __RELAY_URL__: string;
type Capture = {
  stopped: boolean; streams: MediaStream[]; context: AudioContext | null;
  node: AudioWorkletNode | null; client: WsClient | null; tabId?: number;
  microphone: MediaStream | null; microphonePending: Promise<boolean> | null;
  microphoneSource: MediaStreamAudioSourceNode | null;
  microphoneRetry: ReturnType<typeof setTimeout> | undefined;
  microphoneAttempts: number; microphoneConnectedAt: number;
  microphoneFailure: 'permission' | 'missing' | 'busy' | 'other' | null;
};
let current: Capture | null = null;
let starting: Promise<void> | null = null;
let stopping: Promise<void> | null = null;
let view = emptySession();
let persisted = emptySession();
let writes: Promise<void> = Promise.resolve();
let lastWriteRevision = 0;
let lastActiveAt = Date.now();

function checkForWake(): void {
  const now = Date.now();
  const elapsed = now - lastActiveAt;
  lastActiveAt = now;
  if (elapsed >= 5000) current?.client?.resumeAfterWake(elapsed);
}

document.addEventListener('visibilitychange', checkForWake);
function scheduleWakeCheck(): void {
  setTimeout(() => { checkForWake(); scheduleWakeCheck(); }, 1000);
}
scheduleWakeCheck();

function persist(): void {
  const snapshot = view;
  lastWriteRevision = snapshot.revision;
  writes = writes.then(async () => {
    try {
      await saveSession(persisted, snapshot);
      persisted = snapshot;
      if (lastWriteRevision === snapshot.revision) publish({ type: 'storage', status: 'saved' });
    } catch {
      publish({ type: 'storage', status: 'failed' });
    }
  });
}

function publish(event: ViewEvent): void {
  view = reduceSession(view, event);
  void chrome.runtime.sendMessage({ target: 'panel', revision: view.revision, event }).catch(() => {});
  if (event.type !== 'storage' && view.sessionId) persist();
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message.target !== 'offscreen') return;
  if (message.type === 'state') {
    respond({ active: current !== null, tabId: current?.tabId, sessionId: view.sessionId });
  } else if (message.type === 'snapshot') {
    respond({ state: view });
  } else if (message.type === 'start') {
    if (current || starting || stopping) { respond({ ok: false }); return; }
    const capture: Capture = { stopped: false, streams: [], context: null, node: null, client: null, tabId: message.tabId, microphone: null, microphonePending: null, microphoneSource: null, microphoneRetry: undefined, microphoneAttempts: 0, microphoneConnectedAt: 0, microphoneFailure: null };
    current = capture;
    publish({ type: 'session-start', sessionId: crypto.randomUUID(), startedAt: Date.now(), title: typeof message.title === 'string' ? message.title.slice(0, 200) : undefined });
    starting = start(capture, message.streamId).catch(() => {
      if (!capture.stopped) publish({ type: 'error', code: 'capture_failed', message: 'Could not capture this tab. Try a normal meeting or audio tab.' });
      cleanup(capture);
      if (current === capture && !capture.stopped) {
        current = null;
        publish({ type: 'session-stop', endedAt: Date.now() });
      }
    }).finally(() => { starting = null; });
    respond({ ok: true });
  } else if (message.type === 'enable-microphone') {
    const capture = current;
    if (!capture || capture.stopped || message.sessionId !== view.sessionId) {
      respond({ ok: true, attached: false }); return;
    }
    void (async () => {
      await starting;
      if (capture.stopped || current !== capture) return { ok: true, attached: false };
      cancelMicrophoneRetry(capture);
      capture.microphoneAttempts = 0;
      const attached = await enableMicrophone(capture);
      return { ok: attached, attached };
    })().then(respond).catch(() => respond({ ok: false, attached: false }));
    return true;
  } else if (message.type === 'stop') {
    void stop();
    respond({ ok: true });
  }
});

function requireActive(capture: Capture): void {
  if (capture.stopped || current !== capture) throw new Error('Capture cancelled');
}

async function start(capture: Capture, streamId: string): Promise<void> {
  publish({ type: 'status', state: 'connecting', text: 'Starting audio capture…' });
  // Consume the short-lived ID before worklet setup, network requests or mic prompts.
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
  });
  capture.streams.push(tab);
  requireActive(capture);
  tab.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
    if (!capture.stopped && current === capture) {
      publish({ type: 'error', code: 'tab_closed', message: 'The captured meeting tab closed or stopped sharing audio. This meeting was stopped and its captured notes remain saved.' });
      void stop();
    }
  }));
  const context = new AudioContext({ sampleRate: 16000 });
  capture.context = context;
  // tabCapture mutes the original tab; restore playback immediately, including while permissions load.
  const tabSource = context.createMediaStreamSource(tab);
  tabSource.connect(context.destination);
  await context.resume();
  requireActive(capture);
  if (context.sampleRate !== 16000) throw new Error('Unsupported sample rate');
  await context.audioWorklet.addModule('pcm-worklet.js');
  requireActive(capture);
  const client = new WsClient(__RELAY_URL__, publish);
  capture.client = client;
  const node = new AudioWorkletNode(context, 'stereo-capture', {
    numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1],
    channelCountMode: 'explicit', channelCount: 2,
  });
  capture.node = node;
  node.port.onmessage = event => {
    if (event.data instanceof ArrayBuffer) client.send(event.data);
  };
  tabSource.connect(node, 0, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  node.connect(silent).connect(context.destination);
  client.start(() => notesContext(view.transcript));
  void enableMicrophone(capture);
}

const microphoneRetryDelays = [500, 1000, 3000];

function cancelMicrophoneRetry(capture: Capture): void {
  clearTimeout(capture.microphoneRetry);
  capture.microphoneRetry = undefined;
}

function microphoneUnavailable(capture: Capture): void {
  if (current !== capture || capture.stopped) return;
  const messages = {
    permission: 'Microphone permission is blocked or was removed. Choose Enable microphone and allow access in Brave.',
    missing: 'No microphone is available. Reconnect it, then choose Enable microphone. Words spoken while it was unavailable may be missing.',
    busy: 'The microphone could not be reopened. Check your sound input or another app using it, then choose Enable microphone.',
    other: 'The microphone could not reconnect. Check your sound input, then choose Enable microphone. Words spoken during the interruption may be missing.',
  };
  publish({ type: 'microphone', available: false });
  publish({ type: 'error', code: 'mic_unavailable', message: messages[capture.microphoneFailure || 'other'] });
}

function scheduleMicrophoneRecovery(capture: Capture): void {
  if (current !== capture || capture.stopped || capture.microphone || capture.microphoneRetry !== undefined) return;
  if (capture.microphoneFailure === 'permission' || capture.microphoneAttempts >= microphoneRetryDelays.length) {
    microphoneUnavailable(capture); return;
  }
  publish({ type: 'microphone', available: false, reconnecting: true });
  capture.microphoneRetry = setTimeout(() => {
    capture.microphoneRetry = undefined;
    if (current !== capture || capture.stopped) return;
    capture.microphoneAttempts++;
    void enableMicrophone(capture, true).then(connected => {
      if (!connected) scheduleMicrophoneRecovery(capture);
    });
  }, microphoneRetryDelays[capture.microphoneAttempts]);
}

async function enableMicrophone(capture: Capture, automatic = false): Promise<boolean> {
  if (capture.microphone?.getAudioTracks().some(track => track.readyState !== 'ended')) return true;
  if (capture.microphonePending) return capture.microphonePending;
  capture.microphonePending = (async () => {
    let stream: MediaStream | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    try {
      requireActive(capture);
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      requireActive(capture);
      if (!capture.context || !capture.node) throw new Error('Capture not ready');
      const tracks = stream.getAudioTracks();
      if (!tracks.length || tracks.every(track => track.readyState === 'ended')) throw new Error('No live microphone');
      source = capture.context.createMediaStreamSource(stream);
      source.connect(capture.node, 0, 0);
      capture.streams.push(stream);
      capture.microphone = stream;
      capture.microphoneSource = source;
      capture.microphoneConnectedAt = Date.now();
      capture.microphoneFailure = null;
      cancelMicrophoneRetry(capture);
      tracks.forEach(track => track.addEventListener('ended', () => {
        if (current === capture && !capture.stopped && capture.microphone === stream) {
          capture.microphoneSource?.disconnect(); capture.microphoneSource = null;
          capture.microphone = null;
          capture.streams = capture.streams.filter(item => item !== stream);
          stream?.getTracks().forEach(item => item.stop());
          // A stable microphone starts a fresh retry budget. Repeated immediate drops remain bounded.
          if (Date.now() - capture.microphoneConnectedAt >= 30000) capture.microphoneAttempts = 0;
          publish({ type: 'gap', message: 'Microphone interrupted. Some of your speech may be missing while it reconnects.' });
          scheduleMicrophoneRecovery(capture);
        }
      }));
      publish({ type: 'microphone', available: true });
      return true;
    } catch (error: unknown) {
      source?.disconnect();
      stream?.getTracks().forEach(track => track.stop());
      if (current === capture && !capture.stopped) {
        const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
        capture.microphoneFailure = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(String(name)) ? 'permission'
          : ['NotFoundError', 'DevicesNotFoundError'].includes(String(name)) ? 'missing'
          : ['NotReadableError', 'TrackStartError', 'AbortError'].includes(String(name)) ? 'busy' : 'other';
        if (!automatic) microphoneUnavailable(capture);
      }
      return false;
    }
  })().finally(() => { capture.microphonePending = null; });
  return capture.microphonePending;
}

function cleanup(capture: Capture): void {
  cancelMicrophoneRetry(capture);
  capture.microphoneSource?.disconnect(); capture.microphoneSource = null;
  capture.microphone = null;
  capture.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
  capture.streams = [];
  capture.node?.disconnect();
  if (capture.context && capture.context.state !== 'closed') void capture.context.close().catch(() => {});
}

async function stop(): Promise<void> {
  if (stopping) return stopping;
  const capture = current;
  if (!capture) return;
  capture.stopped = true;
  cancelMicrophoneRetry(capture);
  stopping = (async () => {
    await starting;
    if (capture.node) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 250);
        capture.node!.port.addEventListener('message', event => {
          if (event.data?.type === 'flushed') { clearTimeout(timer); resolve(); }
        });
        capture.node!.port.postMessage({ type: 'flush' });
      });
    }
    cleanup(capture);
    await capture.client?.stop();
    if (current === capture) {
      publish({ type: 'status', state: 'stopping', text: 'Saving meeting…' });
      await writes;
      current = null;
      publish({ type: 'session-stop', endedAt: Date.now() });
    }
  })().finally(() => { stopping = null; });
  return stopping;
}
