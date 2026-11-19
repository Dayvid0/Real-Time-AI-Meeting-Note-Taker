import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SessionView } from './session-view';
import type { SummaryState } from './notes';
import type { TranscriptState } from './transcript';

type StoredMeeting = Omit<SessionView, 'transcript' | 'notes'> & { id: string; updatedAt: number };
type StoredLine = { meetingId: string; id: string; seq: number; line: TranscriptState['lines'][number] };
interface MeetingDB extends DBSchema {
  meetings: { key: string; value: StoredMeeting; indexes: { startedAt: number } };
  transcripts: { key: [string, string]; value: StoredLine; indexes: { meetingId: string; meetingSeq: [string, number] } };
  summaries: { key: string; value: { meetingId: string; state: SummaryState } };
  notes: { key: string; value: { meetingId: string; value: SummaryState['final'] } };
}
let database: Promise<IDBPDatabase<MeetingDB>> | null = null;
function db() {
  database ??= openDB<MeetingDB>('meeting-notes', 1, {
    upgrade(database) {
      database.createObjectStore('meetings', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      const transcript = database.createObjectStore('transcripts', { keyPath: ['meetingId', 'id'] });
      transcript.createIndex('meetingId', 'meetingId');
      transcript.createIndex('meetingSeq', ['meetingId', 'seq']);
      database.createObjectStore('summaries', { keyPath: 'meetingId' });
      database.createObjectStore('notes', { keyPath: 'meetingId' });
    },
    blocking() { void database?.then(value => value.close()); database = null; },
    terminated() { database = null; },
  }).catch(error => { database = null; throw error; });
  return database;
}
export async function saveSession(previous: SessionView, state: SessionView): Promise<void> {
  if (!state.sessionId) return;
  const database = await db();
  const transaction = database.transaction(['meetings', 'transcripts', 'summaries', 'notes'], 'readwrite', { durability: 'strict' });
  const { transcript, notes, ...metadata } = state;
  await transaction.objectStore('meetings').put({ ...metadata, storage: 'saved', id: state.sessionId, updatedAt: Date.now() });
  const old = previous.sessionId === state.sessionId ? new Map(previous.transcript.lines.map(line => [line.id, line])) : new Map();
  for (const line of transcript.lines) {
    if (old.get(line.id) === line) continue;
    await transaction.objectStore('transcripts').put({ meetingId: state.sessionId, id: line.id, seq: line.type === 'transcript' ? line.seq : line.order, line });
  }
  if (previous.notes !== notes || previous.sessionId !== state.sessionId) {
    await transaction.objectStore('summaries').put({ meetingId: state.sessionId, state: notes });
    if (notes.final) await transaction.objectStore('notes').put({ meetingId: state.sessionId, value: notes.final });
  }
  await transaction.done;
}
export async function loadMeeting(id: string): Promise<SessionView | null> {
  const database = await db();
  const transaction = database.transaction(['meetings', 'transcripts', 'summaries', 'notes']);
  const [meeting, rows, summary, final] = await Promise.all([
    transaction.objectStore('meetings').get(id), transaction.objectStore('transcripts').index('meetingId').getAll(id),
    transaction.objectStore('summaries').get(id), transaction.objectStore('notes').get(id),
  ]);
  await transaction.done;
  if (!meeting) return null;
  const lines = rows.map(row => row.line.type === 'transcript' && !row.line.final ? { ...row.line, interrupted: true } : row.line).sort((a, b) => a.order - b.order);
  return { ...meeting, active: false, phase: 'stopped', storage: 'saved',
    notes: { ...(summary?.state ?? { rolling: '', atMs: 0, partial: false, final: null, status: 'waiting', reason: '' }), ...(final ? { final: final.value } : {}) },
    transcript: { lines, lastSeq: Math.max(0, ...rows.map(row => row.seq)), generation: 0, nextOrder: lines.length },
  };
}
export async function listMeetings(query = ''): Promise<StoredMeeting[]> {
  const database = await db();
  const meetings = (await database.getAllFromIndex('meetings', 'startedAt')).reverse();
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return meetings;
  const matches: StoredMeeting[] = [];
  for (const meeting of meetings) {
    if (meeting.title.toLocaleLowerCase().includes(needle)) { matches.push(meeting); continue; }
    const full = await loadMeeting(meeting.id);
    if (full && [...full.transcript.lines.map(line => line.type === 'transcript' ? line.text : line.message), full.notes.rolling, full.notes.final?.summary || '', ...(full.notes.final?.decisions || []), ...(full.notes.final?.actionItems.map(item => `${item.owner} ${item.task} ${item.due || ''}`) || [])].join(' ').toLocaleLowerCase().includes(needle)) matches.push(meeting);
  }
  return matches;
}
export async function closeDatabase(): Promise<void> { if (database) (await database).close(); database = null; }
