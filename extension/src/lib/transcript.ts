import type { ClientEvent, Transcript } from './protocol';

export type TranscriptLine = Transcript & {
  id: string; order: number; interrupted: boolean;
};
export type GapLine = { type: 'gap'; id: string; order: number; message: string };
export type TranscriptState = {
  lines: (TranscriptLine | GapLine)[];
  lastSeq: number;
  generation: number;
  nextOrder: number;
};

export function emptyTranscript(): TranscriptState {
  return { lines: [], lastSeq: 0, generation: 0, nextOrder: 0 };
}

function interrupt(line: TranscriptLine | GapLine): TranscriptLine | GapLine {
  return line.type === 'transcript' && !line.final ? { ...line, interrupted: true } : line;
}

export function reduceTranscript(state: TranscriptState, event: ClientEvent): TranscriptState {
  if (event.type === 'gap') {
    return {
      ...state, generation: state.generation + 1, nextOrder: state.nextOrder + 1,
      lines: [...state.lines.map(interrupt), {
        type: 'gap', id: `gap:${state.nextOrder}`, order: state.nextOrder, message: event.message,
      }],
    };
  }
  if (event.type === 'complete' || (event.type === 'status' && event.state === 'stopped')) {
    return { ...state, lines: state.lines.map(interrupt) };
  }
  if (event.type !== 'transcript' || event.seq <= state.lastSeq) return state;

  // Segment start times identify revisions; each audio channel revises independently.
  // Gaps separate generations so unfinished lines cannot absorb post-reconnect speech.
  const id = `${state.generation}:${event.speaker}:${event.startMs}`;
  const previous = state.lines.find(line => line.id === id);
  if (previous?.type === 'transcript') {
    if (previous.final && !event.final) return { ...state, lastSeq: event.seq };
    return {
      ...state, lastSeq: event.seq,
      lines: state.lines.map(line => line.id === id
        ? { ...event, id, order: previous.order, interrupted: false } : line),
    };
  }
  // Preserve unexpected unfinished segments as unconfirmed, never inventing a final result.
  const lines = state.lines.map(line => line.type === 'transcript' && line.speaker === event.speaker
    ? interrupt(line) : line);
  return {
    ...state, lastSeq: event.seq, nextOrder: state.nextOrder + 1,
    lines: [...lines, { ...event, id, order: state.nextOrder, interrupted: false }],
  };
}

export function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return minutes < 60 ? `${String(minutes).padStart(2, '0')}:${rest}`
    : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`;
}
