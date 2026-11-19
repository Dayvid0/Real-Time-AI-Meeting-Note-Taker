import { parseNotes, type FinalNotes } from './notes';

export const SAMPLE_RATE = 16000;
export const CHANNELS = 2;
export const FRAME_SAMPLES = 1600;
export const MAX_FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;

export type Transcript = {
  type: 'transcript'; seq: number; speaker: 'local' | 'remote'; text: string;
  startMs: number; endMs: number; final: boolean;
};
export type ServerMessage = Transcript
  | ({ type: 'notes'; kind: 'final' } & FinalNotes)
  | { type: 'summary'; kind: 'rolling'; content: string; atMs: number; partial: boolean }
  | { type: 'summary_status'; kind: 'rolling' | 'final'; status: 'unavailable'; reason: string }
  | { type: 'notes_budget'; remaining: number }
  | { type: 'ready'; sampleRate: 16000; channels: 2 }
  | { type: 'complete' }
  | { type: 'error'; code: string; message: string };
export type ConnectionState = 'connecting' | 'recording' | 'reconnecting' | 'stopping' | 'stopped';
export type ClientEvent = ServerMessage
  | { type: 'status'; state: ConnectionState; text: string }
  | { type: 'gap'; message: string };

export function parseServerMessage(raw: string): ServerMessage {
  if (raw.length > 1_048_576) throw new Error('Server message too large');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('type' in value)) throw new Error('Invalid server message');
  const m = value as Record<string, unknown>;
  if (m.type === 'notes' && m.kind === 'final') return { type: 'notes', kind: 'final', ...parseNotes(m) };
  if (m.type === 'summary' && m.kind === 'rolling' && typeof m.content === 'string'
    && m.content.length <= 6000 && Number.isInteger(m.atMs) && (m.atMs as number) >= 0
    && typeof m.partial === 'boolean') return m as ServerMessage;
  if (m.type === 'summary_status' && ['rolling', 'final'].includes(m.kind as string)
    && m.status === 'unavailable' && ['not_configured', 'budget_exhausted', 'invalid_response', 'provider_failed', 'timeout'].includes(m.reason as string)) return m as ServerMessage;
  if (m.type === 'notes_budget' && Number.isInteger(m.remaining) && (m.remaining as number) >= 0
    && (m.remaining as number) <= 1000000) return m as ServerMessage;
  if (m.type === 'complete') return { type: 'complete' };
  if (m.type === 'ready' && m.sampleRate === 16000 && m.channels === 2) {
    return { type: 'ready', sampleRate: 16000, channels: 2 };
  }
  if (m.type === 'error' && typeof m.code === 'string' && typeof m.message === 'string') {
    return { type: 'error', code: m.code, message: m.message };
  }
  if (m.type === 'transcript' && Number.isInteger(m.seq) && (m.seq as number) > 0
      && (m.speaker === 'local' || m.speaker === 'remote') && typeof m.text === 'string'
      && Number.isInteger(m.startMs) && (m.startMs as number) >= 0
      && Number.isInteger(m.endMs) && (m.endMs as number) >= (m.startMs as number)
      && typeof m.final === 'boolean') return m as Transcript;
  throw new Error('Invalid server message');
}
