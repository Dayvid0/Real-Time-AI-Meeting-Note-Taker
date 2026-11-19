import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import * as fakeIDB from 'fake-indexeddb';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/offscreen.ts'], bundle: true, write: false, format: 'iife',
  define: { __RELAY_URL__: JSON.stringify('http://127.0.0.1:8001') } });
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function harness(getUserMedia) {
  let listener;
  const events = [];
  vm.runInNewContext(bundle.outputFiles[0].text, {
    navigator: { mediaDevices: { getUserMedia } }, crypto: { randomUUID: () => 'meeting-test' },
    Date, document: { addEventListener() {}, visibilityState: 'visible' },
    setTimeout: (fn, delay) => delay === 1000 ? 0 : setTimeout(fn, delay), clearTimeout,
    structuredClone, ...fakeIDB,
    chrome: { runtime: {
      sendMessage: async value => { if (value.target === 'panel') events.push(value); },
      onMessage: { addListener: fn => { listener = fn; } },
    } },
  });
  return { events, request(type, extra = {}) {
    let result;
    listener({ target: 'offscreen', type, ...extra }, {}, value => { result = value; });
    return result;
  } };
}

test('capture failure restores an inactive view and preserves a sanitized error', async () => {
  const h = harness(async () => { throw new Error('sensitive device detail'); });
  assert.equal(h.request('start', { streamId: 'test-stream-id' }).ok, true);
  await settle();
  assert.equal(h.request('state').active, false);
  const snapshot = h.request('snapshot').state;
  assert.equal(snapshot.active, false);
  assert.equal(snapshot.phase, 'stopped');
  assert.equal(snapshot.warning.code, 'capture_failed');
  assert.doesNotMatch(snapshot.warning.message, /sensitive device detail/);
  assert.ok(h.events.every((event, i) => event.revision === i + 1));
});

test('Stop during pending capture releases the eventual stream and permits a fresh session', async () => {
  let resolve, stopped = 0;
  const h = harness(() => new Promise(done => { resolve = done; }));
  h.request('start', { streamId: 'test-stream-id' });
  assert.equal(h.request('state').active, true);
  assert.equal(h.request('start', { streamId: 'duplicate' }).ok, false);
  h.request('stop');
  resolve({ getTracks: () => [{ stop: () => { stopped++; } }] });
  await settle();
  for (let i = 0; i < 100 && h.request('state').active; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(stopped, 1);
  assert.equal(h.request('state').active, false);
  assert.equal(h.request('snapshot').state.active, false);
  assert.equal(h.request('snapshot').state.warning, null);
  assert.equal(h.request('start', { streamId: 'another' }).ok, true);
  h.request('stop');
  resolve({ getTracks: () => [] });
  await settle();
});
