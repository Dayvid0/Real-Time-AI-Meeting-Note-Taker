import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/offscreen.ts'], bundle: true, write: false, format: 'iife',
  define: { __RELAY_URL__: JSON.stringify('http://127.0.0.1:8001') }, plugins: [{ name: 'external-boundaries', setup(build) {
    build.onResolve({ filter: /\/lib\/(ws-client|db)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    build.onLoad({ filter: /ws-client$/, namespace: 'mock' }, () => ({ contents: `
      export class WsClient { constructor(url,publish){this.publish=publish;globalThis.clients.push(this);}
      start(){this.publish({type:'status',state:'recording',text:'Live'});} send(){}
      resumeAfterWake(value){this.wakeMs=value;}
      async stop(){this.publish({type:'complete'});} }
    ` }));
    build.onLoad({ filter: /\/db$/, namespace: 'mock' }, () => ({ contents: 'export async function saveSession() {}' }));
  } }] });
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
function stream() {
  const callbacks = new Map();
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; }, addEventListener: (type, fn) => callbacks.set(type, fn) };
  return { getTracks: () => [track], getAudioTracks: () => [track], track, ended: () => { track.readyState = 'ended'; callbacks.get('ended')?.(); } };
}
function harness() {
  let listener, resolveMic, rejectMic, micRequests = 0, micAllowed = false;
  let now = 0, timerId = 0;
  const timers = new Map(), deviceListeners = new Set(), documentListeners = new Map();
  const clock = {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await settle();
      }
      now = end;
    },
  };
  const tab = stream(), connections = [], clients = [], messages = [];
  class AudioContext {
    sampleRate = 16000; state = 'running'; destination = {};
    audioWorklet = { addModule: async () => {} };
    async resume() {} async close() { this.state = 'closed'; }
    createMediaStreamSource(media) { return { connect: (_node, _output, input) => { connections.push({ media, input }); }, disconnect() {} }; }
    createGain() { return { gain: {}, connect() {} }; }
  }
  class AudioWorkletNode {
    constructor() { let flush; this.port = { addEventListener: (_type, fn) => { flush = fn; }, postMessage: () => flush?.({ data: { type: 'flushed' } }) }; }
    disconnect() {} connect(value) { return value; }
  }
  vm.runInNewContext(bundle.outputFiles[0].text, {
    clients, AudioContext, AudioWorkletNode, ArrayBuffer, Date: class extends Date { static now() { return now; } }, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    crypto: { randomUUID: () => 'session-1' },
    navigator: { mediaDevices: { getUserMedia: async constraints => {
      if (constraints.audio.mandatory) return tab;
      micRequests++;
      if (!micAllowed) throw { name: 'NotAllowedError' };
      return await new Promise((resolve, reject) => { resolveMic = resolve; rejectMic = reject; });
    }, addEventListener: (type, fn) => { if (type === 'devicechange') deviceListeners.add(fn); }, removeEventListener: (type, fn) => { if (type === 'devicechange') deviceListeners.delete(fn); } } },
    document: { visibilityState: 'visible', addEventListener: (type, fn) => documentListeners.set(type, fn) },
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async message => { messages.push(message); } } },
  });
  return { tab, connections, clients, messages, clock, timers, fail: name => rejectMic({ name }), deviceChanged: () => deviceListeners.forEach(fn => fn()), sleep: ms => { now += ms; }, wake: () => documentListeners.get('visibilitychange')?.(), get micRequests() { return micRequests; }, allow() { micAllowed = true; }, supply: value => resolveMic(value),
    request(type, extra = {}) { return new Promise(resolve => listener({ target: 'offscreen', type, ...extra }, {}, resolve)); } };
}

test('permission recovery joins the live microphone input without restarting transcription or changing session', async () => {
  const h = harness();
  await h.request('start', { streamId: 'stream', tabId: 42 }); await settle();
  assert.equal(h.clients.length, 1);
  assert.equal((await h.request('snapshot')).state.microphone, 'unavailable');
  assert.equal(h.messages.some(message => message.type === 'mic-denied'), false, 'no unexpected setup tab');
  h.allow(); const result = h.request('enable-microphone', { sessionId: 'session-1' }); await settle();
  const mic = stream(); h.supply(mic); await result; await settle();
  const view = (await h.request('snapshot')).state;
  assert.equal(view.microphone, 'available'); assert.equal(view.warning, null);
  assert.equal(view.sessionId, 'session-1'); assert.equal(view.active, true);
  assert.equal(h.clients.length, 1);
  assert.ok(h.connections.some(value => value.media === mic && value.input === 0));
  await h.request('enable-microphone', { sessionId: 'session-1' });
  assert.equal(h.micRequests, 2, 'already connected microphone is reused');
  mic.track.readyState = 'ended'; mic.ended(); await settle();
  assert.equal((await h.request('snapshot')).state.microphone, 'reconnecting');
  await h.request('stop'); await settle();
});

test('Stop during microphone recovery releases late audio and stale setup cannot attach to another session', async () => {
  const h = harness();
  await h.request('start', { streamId: 'stream', tabId: 42 }); await settle(); h.allow();
  assert.equal((await h.request('enable-microphone', { sessionId: 'old-session' })).attached, false);
  assert.equal(h.micRequests, 1);
  const recovered = h.request('enable-microphone', { sessionId: 'session-1' }); await settle();
  await h.request('stop'); await settle();
  const late = stream(); h.supply(late); await recovered; await settle();
  assert.equal(late.track.readyState, 'ended');
  assert.equal(h.connections.some(value => value.media === late), false);
  assert.equal((await h.request('state')).active, false);
});


test('Stop during the first microphone request does not wait for permission and releases late tracks', async () => {
  const h = harness(); h.allow();
  await h.request('start', { streamId: 'stream', tabId: 42 }); await settle();
  await h.request('stop'); await settle();
  assert.equal((await h.request('state')).active, false);
  const late = stream(); h.supply(late); await settle();
  assert.equal(late.track.readyState, 'ended');
  assert.equal(h.connections.some(value => value.media === late), false);
});


test('a later microphone dropout reconnects automatically in the same meeting and preserves tab audio', async () => {
  const h = harness(); h.allow();
  await h.request('start', { streamId: 'stream', tabId: 42 }); await settle();
  const first = stream(); h.supply(first); await settle();
  await h.clock.advance(40000);
  first.ended(); await settle();
  assert.equal((await h.request('snapshot')).state.microphone, 'reconnecting');
  await h.clock.advance(500);
  assert.equal(h.micRequests, 2, 'one automatic reacquisition after ended');
  const next = stream(); h.supply(next); await settle();
  const view = (await h.request('snapshot')).state;
  assert.equal(view.microphone, 'available'); assert.equal(view.warning, null);
  assert.equal(view.sessionId, 'session-1'); assert.equal(h.clients.length, 1);
  assert.equal(h.tab.track.readyState, 'live');
  assert.ok(view.transcript.lines.some(line => line.type === 'gap' && /microphone/i.test(line.message)));
  assert.equal(h.messages.some(message => message.target === 'background'), false);
  await h.request('stop'); await settle();
});

test('automatic microphone recovery is bounded and permission denial stops retrying without a popup', async () => {
  const h = harness(); h.allow();
  await h.request('start', { streamId: 'stream', tabId: 42 }); await settle();
  const mic = stream(); h.supply(mic); await settle(); mic.ended();
  await h.clock.advance(500); h.fail('NotReadableError'); await settle();
  await h.clock.advance(1000); h.fail('NotFoundError'); await settle();
  await h.clock.advance(3000); h.fail('NotAllowedError'); await settle();
  await h.clock.advance(60000); h.deviceChanged(); await settle();
  assert.equal(h.micRequests, 4, 'three automatic retries only');
  const view = (await h.request('snapshot')).state;
  assert.equal(view.microphone, 'unavailable');
  assert.match(view.warning.message, /blocked|permission/i);
  assert.equal(h.messages.some(message => message.target === 'background'), false);
  await h.request('stop'); await settle();
});

test('Stop cancels scheduled recovery and releases a late automatically acquired microphone', async () => {
  const h = harness(); h.allow();
  await h.request('start', { streamId: 'stream', tabId: 42 }); await settle();
  const mic = stream(); h.supply(mic); await settle(); mic.ended();
  await h.request('stop'); await settle(); await h.clock.advance(10000);
  assert.equal(h.micRequests, 1);
  const other = harness(); other.allow();
  await other.request('start', { streamId: 'stream', tabId: 42 }); await settle();
  const first = stream(); other.supply(first); await settle(); first.ended();
  await other.clock.advance(500);
  await other.request('stop'); await settle();
  const late = stream(); other.supply(late); await settle();
  assert.equal(late.track.readyState, 'ended');
  assert.equal(other.connections.some(value => value.media === late), false);
  assert.equal((await other.request('state')).active, false);
});


test('quick repeated dropouts cannot create an infinite recovery loop and a stable connection resets the budget', async () => {
  const h = harness(); h.allow();
  await h.request('start', { streamId: 'stream', tabId: 42 }); await settle();
  let mic = stream(); h.supply(mic); await settle();
  for (const delay of [500, 1000, 3000]) {
    mic.ended(); await h.clock.advance(delay);
    mic = stream(); h.supply(mic); await settle();
  }
  mic.ended(); await h.clock.advance(10000);
  assert.equal(h.micRequests, 4);
  assert.equal((await h.request('snapshot')).state.microphone, 'unavailable');
  const manual = h.request('enable-microphone', { sessionId: 'session-1' }); await settle();
  mic = stream(); h.supply(mic); await manual; await settle();
  mic.ended(); await h.clock.advance(500);
  mic = stream(); h.supply(mic); await settle();
  await h.clock.advance(30000); mic.ended(); await h.clock.advance(500);
  assert.equal(h.micRequests, 7, 'stable period restores the first retry delay');
  mic = stream(); h.supply(mic); await settle();
  assert.equal((await h.request('snapshot')).state.microphone, 'available');
  await h.request('stop'); await settle();
});

test('offscreen capture detects a long sleep/wake pause and asks the existing client to reconnect', async () => {
  const h = harness();
  await h.request('start', { streamId: 'stream', tabId: 42 }); await settle();
  assert.equal(typeof h.clients[0].resumeAfterWake, 'function');
  h.sleep(65000); h.wake(); await settle();
  assert.equal(h.clients[0].wakeMs, 65000);
  assert.equal(h.clients.length, 1, 'sleep recovery keeps the same capture owner');
  assert.equal(h.tab.track.readyState, 'live');
  await h.request('stop'); await settle();
});

test('closing the captured meeting tab stops safely with a clear saved-session warning', async () => {
  const h = harness();
  await h.request('start', { streamId: 'stream', tabId: 42 }); await settle();
  h.tab.ended(); await settle();
  const view = (await h.request('snapshot')).state;
  assert.equal(view.active, false);
  assert.equal(view.warning.code, 'tab_closed');
  assert.match(view.warning.message, /tab.*closed|ended/i);
});
