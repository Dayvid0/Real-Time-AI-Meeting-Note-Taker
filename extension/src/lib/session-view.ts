import { emptyNotes, type SummaryState } from './notes';
import type { ClientEvent, ConnectionState } from './protocol';
import { emptyTranscript, reduceTranscript, type TranscriptState } from './transcript';

export type ViewEvent = ClientEvent
  | { type: 'session-start'; sessionId: string; startedAt: number; title?: string }
  | { type: 'session-stop'; endedAt: number }
  | { type: 'microphone'; available: boolean; reconnecting?: boolean }
  | { type: 'storage'; status: 'saved' | 'failed' };
export type SessionView = {
  sessionId: string | null; title: string; revision: number; active: boolean;
  notes: SummaryState; storage: 'saving' | 'saved' | 'failed';
  phase: ConnectionState | 'idle'; startedAt: number | null; endedAt: number | null;
  microphone: 'unknown' | 'available' | 'unavailable' | 'reconnecting';
  warning: { code: string; message: string } | null;
  complete: boolean; transcript: TranscriptState;
};
export type ViewUpdate = { target: 'panel'; revision: number; event: ViewEvent };

export function emptySession(revision = 0): SessionView {
  return {
    sessionId: null, title: 'Untitled meeting', notes: emptyNotes(), storage: 'saving', revision, active: false, phase: 'idle', startedAt: null, endedAt: null,
    microphone: 'unknown', warning: null, complete: false, transcript: emptyTranscript(),
  };
}

export function reduceSession(state: SessionView, event: ViewEvent): SessionView {
  const revision = state.revision + 1;
  if (event.type === 'storage') return { ...state, revision, storage: event.status };
  state = { ...state, storage: state.storage === 'failed' ? 'failed' : 'saving' };
  if (event.type === 'session-start') {
    return { ...emptySession(revision), sessionId: event.sessionId, startedAt: event.startedAt,
      title: event.title || 'Untitled meeting', active: true, phase: 'connecting' };
  }
  if (event.type === 'notes') {
    const partial = event.partial || state.transcript.lines.some(line => line.type === 'gap');
    return { ...state, revision, notes: { ...state.notes, final: { ...event, partial }, status: 'ready', reason: '', partial } };
  }
  if (event.type === 'summary') return { ...state, revision, notes: { ...state.notes, rolling: event.content, atMs: event.atMs, partial: event.partial, status: 'ready', reason: '' } };
  if (event.type === 'summary_status') return { ...state, revision, notes: { ...state.notes, status: 'unavailable', reason: event.reason } };
  if (event.type === 'microphone') {
    return { ...state, revision, microphone: event.available ? 'available' : event.reconnecting ? 'reconnecting' : 'unavailable',
      warning: (event.available || event.reconnecting) && ['mic_denied', 'mic_unavailable'].includes(state.warning?.code || '') ? null : state.warning };
  }
  if (event.type === 'session-stop') {
    return { ...state, revision, active: false, phase: 'stopped', endedAt: event.endedAt,
      transcript: reduceTranscript(state.transcript, { type: 'status', state: 'stopped', text: 'Stopped' }) };
  }
  const next = { ...state, revision, storage: state.storage === 'failed' ? 'failed' as const : 'saving' as const, transcript: reduceTranscript(state.transcript, event) };
  if (event.type === 'status') {
    next.phase = event.state;
    if (event.state === 'recording' && state.warning
      && ['asr_unavailable', 'session_failed', 'invalid_response', 'server_down', 'token_expired', 'token_rejected'].includes(state.warning.code)) next.warning = null;
  }
  if (event.type === 'error') next.warning = { code: event.code, message: event.message };
  if (event.type === 'complete') next.complete = true;
  return next;
}

// Snapshot and live messages may overlap while opening. Revisions span all meetings in this document.
export function applyUpdate(state: SessionView, update: ViewUpdate): SessionView {
  if (update.revision <= state.revision) return state;
  return { ...reduceSession(state, update.event), revision: update.revision };
}
