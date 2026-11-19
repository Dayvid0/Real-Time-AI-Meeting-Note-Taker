import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function moduleFrom(path) {
  const bundle = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const { emptyTranscript, reduceTranscript, formatTime } = await moduleFrom('src/lib/transcript.ts');
const { emptySession, reduceSession, applyUpdate } = await moduleFrom('src/lib/session-view.ts');
const line = (seq, speaker, text, startMs, endMs, final = false) => ({ type: 'transcript', seq, speaker, text, startMs, endMs, final });

test('interims replace in place and shorter finals replace speculative words without duplicate lines', () => {
  let state = emptyTranscript();
  state = reduceTranscript(state, line(1, 'remote', 'We can', 0, 2000));
  state = reduceTranscript(state, line(2, 'remote', 'We can meet tomorrow and discuss', 0, 4000));
  const id = state.lines[0].id;
  state = reduceTranscript(state, line(3, 'remote', 'We can meet tomorrow.', 0, 2800, true));
  state = reduceTranscript(state, line(4, 'remote', 'And discuss the report.', 2800, 5500, true));
  assert.equal(state.lines.length, 2);
  assert.equal(state.lines[0].id, id);
  assert.equal(state.lines[0].text, 'We can meet tomorrow.');
  assert.equal(state.lines[0].endMs, 2800);
  assert.ok(state.lines.every(row => row.final));
});

test('overlapping speakers keep separate draft rows and stable first-sequence order', () => {
  let state = emptyTranscript();
  for (const event of [line(1, 'remote', 'First', 1000, 2000), line(2, 'local', 'Second', 0, 1500),
    line(3, 'remote', 'First revised', 1000, 2500, true), line(4, 'local', 'Second revised', 0, 2000, true)]) {
    state = reduceTranscript(state, event);
  }
  assert.deepEqual(state.lines.map(row => row.speaker), ['remote', 'local']);
  assert.deepEqual(state.lines.map(row => row.order), [0, 1]);
  assert.equal(state.lines.length, 2);
});

test('replayed or out-of-order sequences do not duplicate or revert text; final cannot become interim', () => {
  let state = reduceTranscript(emptyTranscript(), line(4, 'local', 'Confirmed.', 0, 2000, true));
  const previous = state;
  state = reduceTranscript(state, line(4, 'local', 'Duplicate', 0, 2000, true));
  assert.equal(state, previous);
  state = reduceTranscript(state, line(2, 'local', 'Stale', 0, 1000));
  state = reduceTranscript(state, line(5, 'local', 'Late draft', 0, 2500));
  assert.equal(state.lines.length, 1);
  assert.equal(state.lines[0].text, 'Confirmed.');
  assert.equal(state.lines[0].final, true);
  assert.equal(state.lastSeq, 5);
});

test('reconnection separates draft generations and retains gaps without declaring drafts final', () => {
  let state = reduceTranscript(emptyTranscript(), line(1, 'local', 'Unfinished', 0, 1500));
  state = reduceTranscript(state, { type: 'gap', message: 'Connection lost' });
  state = reduceTranscript(state, line(2, 'local', 'After reconnect', 0, 2000, true));
  assert.equal(state.lines.length, 3);
  assert.equal(state.lines[0].interrupted, true);
  assert.equal(state.lines[0].final, false);
  assert.equal(state.lines[1].type, 'gap');
  assert.notEqual(state.lines[0].id, state.lines[2].id);
});

test('new meeting clears old errors and text while snapshot/live overlap is ignored exactly once', () => {
  let state = reduceSession(emptySession(), { type: 'session-start', sessionId: 'one', startedAt: 100 });
  const error = { type: 'error', code: 'mic_denied', message: 'Microphone unavailable' };
  state = reduceSession(state, error);
  state = reduceSession(state, line(1, 'remote', 'Test line', 0, 1000, true));
  const snapshot = structuredClone(state);
  assert.equal(applyUpdate(snapshot, { revision: state.revision, event: line(1, 'remote', 'Test line', 0, 1000, true) }), snapshot);
  state = applyUpdate(snapshot, { revision: state.revision + 1, event: { type: 'gap', message: 'A gap' } });
  state = applyUpdate(state, { revision: state.revision, event: { type: 'gap', message: 'A gap' } });
  assert.equal(state.transcript.lines.filter(row => row.type === 'gap').length, 1);
  state = reduceSession(state, { type: 'session-start', sessionId: 'two', startedAt: 500 });
  assert.equal(state.warning, null);
  assert.equal(state.transcript.lines.length, 0);
  assert.equal(state.active, true);
  assert.equal(state.sessionId, 'two');
});

test('completion waits for capture cleanup before enabling another meeting and retains warnings', () => {
  let state = reduceSession(emptySession(), { type: 'session-start', sessionId: 'one', startedAt: 100 });
  state = reduceSession(state, { type: 'microphone', available: false });
  state = reduceSession(state, { type: 'status', state: 'recording', text: 'Live' });
  assert.equal(state.microphone, 'unavailable');
  state = reduceSession(state, { type: 'complete' });
  assert.equal(state.active, true);
  state = reduceSession(state, { type: 'session-stop', endedAt: 1000 });
  assert.equal(state.active, false);
  assert.equal(state.complete, true);
  assert.equal(state.endedAt, 1000);
});

test('five-minute synthetic meeting and panel reopen retain one line per segment beyond 500 raw updates', () => {
  let state = reduceSession(emptySession(), { type: 'session-start', sessionId: 'five-minutes', startedAt: 0 });
  let seq = 0;
  for (let segment = 0; segment < 100; segment++) {
    for (let draft = 0; draft < 6; draft++) {
      for (const speaker of ['local', 'remote']) {
        state = reduceSession(state, line(++seq, speaker, `Segment ${segment} revision ${draft}`, segment * 3000, segment * 3000 + 500 * (draft + 1), draft === 5));
      }
    }
  }
  const reopened = structuredClone(state);
  assert.equal(reopened.transcript.lines.length, 200);
  assert.equal(new Set(reopened.transcript.lines.map(row => row.id)).size, 200);
  assert.ok(reopened.transcript.lines.every(row => row.final));
  assert.equal(reopened.transcript.lines.at(-1).endMs, 300000);
  assert.equal(reopened.transcript.lastSeq, 1200);
});

test('timestamps cover zero, minutes and multi-hour meetings', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(61299), '01:01');
  assert.equal(formatTime(3723000), '1:02:03');
});

test('recovering the relay clears temporary server and token warnings', () => {
  for (const code of ['server_down', 'token_expired', 'token_rejected']) {
    let state = reduceSession(emptySession(), { type: 'session-start', sessionId: code, startedAt: 0 });
    state = reduceSession(state, { type: 'error', code, message: 'Temporary connection problem' });
    state = reduceSession(state, { type: 'status', state: 'recording', text: 'Live' });
    assert.equal(state.warning, null, `${code} should clear after reconnect`);
  }
});
