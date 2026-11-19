import type { TranscriptLine, TranscriptState } from './transcript';

export function notesContext(transcript: TranscriptState) {
  const rows = transcript.lines.filter((row): row is TranscriptLine => row.type === 'transcript' && row.final)
    .map(row => ({ speaker: row.speaker, text: row.text }));
  const picked: typeof rows = [];
  let size = 0;
  // Keep recent complete segments within the strict start-control bound. Mark omissions explicitly.
  for (const row of [...rows].reverse()) {
    const bytes = new TextEncoder().encode(JSON.stringify(row)).byteLength;
    if (size + bytes > 20000 || picked.length === 250) break;
    picked.unshift(row); size += bytes;
  }
  return { notesContext: picked, notesPartial: picked.length < rows.length || transcript.lines.some(row => row.type === 'gap') };
}
