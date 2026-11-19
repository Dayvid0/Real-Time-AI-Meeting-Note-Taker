import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/lib/ws-client.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { WsClient, retryDelay } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function harness() {
  const sockets = [], timers = new Map(), events = [], requests = [];
  let nextTimer = 0;
  class Socket {
    readyState = 0;
    bufferedAmount = 0;
    sent = [];
    close() { this.readyState = 3; }
    send(value) { this.sent.push(value); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    drop(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
  }
  const client = new WsClient('http://127.0.0.1:8000', event => events.push(event), {
    fetch: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, json: async () => ({ token: `token${requests.length}` }) };
    },
    socket: (url, protocols) => { const socket = new Socket(); Object.assign(socket, { url, protocols }); sockets.push(socket); return socket; },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), random: () => 0.5,
  });
  return { client, sockets, timers, events, requests,
    runTimer(delay) {
      const pair = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(pair, `Expected timer ${delay}`);
      timers.delete(pair[0]); pair[1].fn();
    },
  };
}
const ready = { type: 'ready', sampleRate: 16000, channels: 2 };
const transcript = { type: 'transcript', seq: 1, speaker: 'local', text: 'test', startMs: 0, endMs: 100, final: true };

test('waits for ready, uses token subprotocol, and drains final results before resolving stop', async () => {
  const h = harness();
  h.client.start();
  await settle();
  const ws = h.sockets[0];
  assert.equal(ws.url, 'ws://127.0.0.1:8000/v1/session');
  assert.deepEqual(ws.protocols, ['meeting-notes.v1', 'auth.token1']);
  ws.open();
  assert.deepEqual(JSON.parse(ws.sent[0]), { type: 'start', sampleRate: 16000, channels: 2 });
  assert.equal(h.client.send(new ArrayBuffer(6400)), false);
  ws.message(ready);
  assert.equal(h.client.send(new ArrayBuffer(6400)), true);
  let stopped = false;
  const completion = h.client.stop().then(() => { stopped = true; });
  let duplicateStopResolved = false;
  const duplicateStop = h.client.stop().then(() => { duplicateStopResolved = true; });
  await settle();
  assert.equal(stopped, false);
  assert.equal(duplicateStopResolved, false);
  assert.deepEqual(JSON.parse(ws.sent.at(-1)), { type: 'end' });
  ws.message(transcript);
  ws.message({ type: 'complete' });
  await completion;
  await duplicateStop;
  assert.equal(h.events.find(e => e.type === 'transcript').startMs, 100);
  assert.equal(h.timers.size, 0);
});

test('reconnect gets a new token, marks lost audio and keeps sequence and timestamps increasing', async () => {
  const h = harness();
  h.client.start(); await settle();
  h.sockets[0].open(); h.sockets[0].message(ready);
  h.client.send(new ArrayBuffer(6400));
  h.sockets[0].message(transcript);
  h.sockets[0].drop();
  assert.equal(h.client.send(new ArrayBuffer(6400)), false);
  h.runTimer(500); await settle();
  assert.equal(h.requests.length, 2);
  const ws = h.sockets[1];
  assert.equal(ws.protocols[1], 'auth.token2');
  ws.open(); ws.message(ready);
  h.client.send(new ArrayBuffer(6400)); ws.message(transcript);
  const lines = h.events.filter(e => e.type === 'transcript');
  assert.deepEqual(lines.map(e => e.seq), [1, 2]);
  assert.deepEqual(lines.map(e => e.startMs), [0, 200]);
  assert.equal(h.events.filter(e => e.type === 'gap').length, 2);
  const completion = h.client.stop(); ws.message({ type: 'complete' }); await completion;
});

test('backpressure disconnects instead of retaining an unbounded audio buffer', async () => {
  const h = harness(); h.client.start(); await settle();
  const ws = h.sockets[0]; ws.open(); ws.message(ready);
  ws.bufferedAmount = 64000;
  assert.equal(h.client.send(new ArrayBuffer(6400)), false);
  assert.equal(ws.readyState, 3);
  assert.equal(ws.sent.length, 1);
  await h.client.stop();
  assert.equal(h.timers.size, 0);
});

test('stop during reconnect cancels pending retries and never reconnects', async () => {
  const h = harness(); h.client.start(); await settle();
  h.sockets[0].open(); h.sockets[0].message(ready); h.sockets[0].drop();
  assert.ok(h.timers.size > 0);
  await h.client.stop(); await settle();
  assert.equal(h.timers.size, 0);
  assert.equal(h.sockets.length, 1);
});

test('a finalization timeout reports loss and clears all timers', async () => {
  const h = harness(); h.client.start(); await settle();
  const ws = h.sockets[0]; ws.open(); ws.message(ready);
  const completion = h.client.stop(); h.runTimer(45000); await completion;
  assert.ok(h.events.some(e => e.code === 'finalization_timeout'));
  assert.equal(h.timers.size, 0);
});

test('backoff increases and stays bounded, with jitter', () => {
  assert.equal(retryDelay(0, 0.5), 500);
  assert.equal(retryDelay(1, 0.5), 1000);
  assert.equal(retryDelay(100, 0.5), 15000);
  assert.ok(retryDelay(2, 0) < retryDelay(2, 1));
});

test('notes failure does not disconnect audio, budget and prior context survive reconnect', async () => {
  const h = harness();
  h.client.start(() => ({ notesContext: [{ speaker: 'local', text: 'Prior commitment' }], notesPartial: false }));
  await settle();
  let ws = h.sockets[0]; ws.open(); ws.message(ready);
  ws.message({ type: 'summary_status', kind: 'rolling', status: 'unavailable', reason: 'provider_failed' });
  assert.equal(ws.readyState, 1);
  assert.equal(h.client.send(new ArrayBuffer(6400)), true);
  ws.message({ type: 'notes_budget', remaining: 20000 });
  ws.drop(); h.runTimer(500); await settle(); ws = h.sockets[1]; ws.open();
  const start = JSON.parse(ws.sent[0]);
  assert.equal(start.notesBudget, 20000);
  assert.equal(start.notesContext[0].text, 'Prior commitment');
  ws.message(ready);
  const completion = h.client.stop();
  ws.message({ type: 'notes', kind: 'final', summary: 'Test summary', decisions: [], actionItems: [], partial: false });
  assert.ok(h.events.some(event => event.type === 'notes'));
  ws.message({ type: 'complete' }); await completion;
});

test('resume after computer sleep reconnects immediately and records the sleeping interval as a gap', async () => {
  const h = harness();
  h.client.start(); await settle();
  const first = h.sockets[0]; first.open(); first.message(ready);
  h.client.send(new ArrayBuffer(6400));
  h.client.resumeAfterWake(65000);
  await settle();
  assert.equal(first.readyState, 3);
  assert.equal(h.requests.length, 2, 'wake should not wait for the existing backoff');
  const next = h.sockets[1]; next.open(); next.message(ready);
  assert.ok(h.events.some(event => event.type === 'gap' && /sleep|wake/i.test(event.message)));
  const completion = h.client.stop(); next.message({ type: 'complete' }); await completion;
});

test('token rejection is distinguished from a stopped relay without exposing response details', async () => {
  const h = harness();
  h.client = new WsClient('http://127.0.0.1:8000', event => h.events.push(event), {
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ detail: 'private' }) }),
    socket: () => { throw new Error('must not connect'); },
    setTimeout: (fn, delay) => { const id = h.timers.size + 100; h.timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => h.timers.delete(id), random: () => 0.5,
  });
  h.client.start(); await settle();
  const error = h.events.find(event => event.type === 'error');
  assert.equal(error.code, 'token_rejected');
  assert.match(error.message, /extension|relay/i);
  assert.doesNotMatch(error.message, /private/);
  await h.client.stop();
});

test('an expired websocket token and an unreachable relay have clear recoverable errors', async () => {
  const h = harness(); h.client.start(); await settle();
  h.sockets[0].drop(1008);
  assert.equal(h.events.find(event => event.code === 'token_expired')?.type, 'error');
  await h.client.stop();

  const events = [], timers = new Map(); let next = 0;
  const unavailable = new WsClient('http://127.0.0.1:8000', event => events.push(event), {
    fetch: async () => { throw new TypeError('private network detail'); },
    socket: () => { throw new Error('must not connect'); },
    setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), random: () => 0.5,
  });
  unavailable.start(); await settle();
  const serverDown = events.find(event => event.code === 'server_down');
  assert.match(serverDown.message, /local transcription service|relay/i);
  assert.doesNotMatch(serverDown.message, /private/);
  await unavailable.stop();
});
