import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
async function moduleFrom(path) {
  const bundle = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const { emptySession, reduceSession } = await moduleFrom('src/lib/session-view.ts');
const { saveSession, loadMeeting, listMeetings, closeDatabase } = await moduleFrom('src/lib/db.ts');
const { notesContext } = await moduleFrom('src/lib/notes-context.ts');
const { exportMarkdown, exportFilename } = await moduleFrom('src/lib/export.ts');
const { parseServerMessage } = await moduleFrom('src/lib/protocol.ts');
const line = (seq, text, final = true) => ({ type: 'transcript', seq, text, speaker: 'local', startMs: 0, endMs: 1000, final });
const notes = { type: 'notes', kind: 'final', summary: 'Planning complete.', decisions: ['Release Monday'], actionItems: [{ owner: 'Ada', task: 'Send report', due: 'Friday' }], partial: false };

test('incremental saves survive database close/reopen, replace drafts, and keep previous meetings', async () => {
  let before = emptySession();
  let state = reduceSession(before, { type: 'session-start', sessionId: 'saved-one', startedAt: 1000, title: 'Planning meeting' });
  await saveSession(before, state); before = state;
  state = reduceSession(state, line(1, 'Initial draft', false)); await saveSession(before, state); before = state;
  state = reduceSession(state, line(2, 'Final transcript about zebras')); await saveSession(before, state); before = state;
  state = reduceSession(state, notes); await saveSession(before, state); before = state;
  state = reduceSession(state, { type: 'session-stop', endedAt: 2000 }); await saveSession(before, state);
  await closeDatabase();
  const loaded = await loadMeeting('saved-one');
  assert.equal(loaded.transcript.lines.length, 1);
  assert.equal(loaded.transcript.lines[0].text, 'Final transcript about zebras');
  assert.equal(loaded.notes.final.actionItems[0].owner, 'Ada');
  assert.equal(loaded.active, false);
  assert.equal((await listMeetings('zebras')).length, 1);
  assert.equal((await listMeetings('Ada')).length, 1);
  const next = reduceSession(state, { type: 'session-start', sessionId: 'saved-two', startedAt: 3000, title: 'Next meeting' });
  await saveSession(state, next);
  assert.equal((await listMeetings()).length, 2);
  assert.equal((await loadMeeting('saved-one')).transcript.lines.length, 1);
  await closeDatabase();
});
test('notes failure keeps transcript and exports useful Markdown safely', () => {
  let state = reduceSession(emptySession(), { type: 'session-start', sessionId: 'export', startedAt: 1000, title: 'Plan / <script>' });
  state = reduceSession(state, line(1, '<img src=x> & [link](bad)'));
  state = reduceSession(state, { type: 'summary_status', kind: 'final', status: 'unavailable', reason: 'provider_failed' });
  assert.equal(state.transcript.lines.length, 1);
  assert.match(exportMarkdown(state), /Final notes unavailable/);
  assert.doesNotMatch(exportMarkdown(state), /<img/);
  state = reduceSession(state, notes);
  const markdown = exportMarkdown(state);
  assert.match(markdown, /## Decisions/);
  assert.match(markdown, /Ada/);
  assert.match(markdown, /Friday/);
  assert.doesNotMatch(exportFilename(state), /[<>/]/);
});
test('reconnect context contains finals only, bounded bytes, and flags omitted speech', () => {
  const state = emptySession();
  for (let i = 0; i < 300; i++) state.transcript.lines.push({ ...line(i+1, '話'.repeat(100)), id: String(i), order: i, interrupted: false });
  state.transcript.lines.push({ ...line(301, 'Draft excluded', false), id: 'draft', order: 301, interrupted: false });
  const context = notesContext(state.transcript);
  assert.equal(context.notesPartial, true);
  assert.ok(context.notesContext.length < 300);
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).byteLength < 32768);
  assert.ok(context.notesContext.every(row => row.text !== 'Draft excluded'));
});
test('wire notes, summaries and status are validated without interrupting normal transcripts', () => {
  assert.equal(parseServerMessage(JSON.stringify(notes)).actionItems[0].task, 'Send report');
  assert.throws(() => parseServerMessage(JSON.stringify({ ...notes, actionItems: [{ owner: 'Ada', task: 12 }] })));
  assert.throws(() => parseServerMessage(JSON.stringify({ type: 'notes_budget', remaining: -1 })));
  assert.equal(parseServerMessage(JSON.stringify({ type: 'summary_status', kind: 'final', status: 'unavailable', reason: 'not_configured' })).type, 'summary_status');
});

test('interrupted draft is recovered as unconfirmed and gaps mark generated notes partial', async () => {
  let previous = emptySession();
  let state = reduceSession(previous, { type: 'session-start', sessionId: 'interrupted', startedAt: 4000 });
  await saveSession(previous, state); previous = state;
  state = reduceSession(state, line(1, 'Draft before crash', false)); await saveSession(previous, state);
  await closeDatabase();
  const recovered = await loadMeeting('interrupted');
  assert.equal(recovered.transcript.lines[0].interrupted, true);
  assert.equal(recovered.transcript.lines[0].final, false);
  state = reduceSession(state, { type: 'gap', message: 'Startup audio missing' });
  state = reduceSession(state, notes);
  assert.equal(state.notes.final.partial, true);
  await closeDatabase();
});
