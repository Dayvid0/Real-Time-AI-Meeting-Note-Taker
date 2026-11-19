import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/background.ts'], bundle: true, write: false, format: 'iife' });
function harness({ active = false, fail = false } = {}) {
  let action, listener;
  const calls = [];
  const context = {
    chrome: {
      action: { onClicked: { addListener: fn => { action = fn; } } },
      sidePanel: { open: async args => { calls.push({ type: 'panel', tabId: args.tabId }); } },
      offscreen: { hasDocument: async () => true },
      tabCapture: { getMediaStreamId: async args => {
        calls.push({ type: 'stream', tabId: args.targetTabId });
        if (fail) throw new Error('private browser error');
        return 'short-lived-id';
      } },
      runtime: {
        onMessage: { addListener: fn => { listener = fn; } },
        sendMessage: async message => { calls.push(message); return message.type === 'state' ? { active } : { ok: true }; },
      },
    },
  };
  vm.runInNewContext(bundle.outputFiles[0].text, context);
  return { calls, action, request: message => new Promise(resolve => {
    assert.equal(listener({ target: 'background', ...message }, {}, resolve), true);
  }) };
}

test('toolbar opens the side panel without implicitly starting or stopping a meeting', () => {
  const h = harness(); h.action({ id: 42 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].type, 'panel');
});
test('Start uses the selected tab and active capture prevents duplicate tab capture', async () => {
  const h = harness();
  assert.equal((await h.request({ type: 'start', tabId: 42 })).ok, true);
  assert.equal(h.calls.find(call => call.type === 'stream').tabId, 42);
  assert.equal(h.calls.find(call => call.type === 'start').streamId, 'short-lived-id');
  const active = harness({ active: true });
  assert.equal((await active.request({ type: 'start', tabId: 42 })).ok, true);
  assert.equal(active.calls.filter(call => call.type === 'stream').length, 0);
});
test('Stop delegates to the offscreen owner and capture errors stay sanitized and actionable', async () => {
  const h = harness();
  assert.equal((await h.request({ type: 'stop' })).ok, true);
  assert.equal(h.calls[0].target, 'offscreen');
  assert.equal(h.calls[0].type, 'stop');
  const failed = await harness({ fail: true }).request({ type: 'start', tabId: 42 });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /toolbar icon/);
  assert.doesNotMatch(failed.message, /private browser error/);
});

test('service-worker restart recreates a missing offscreen owner before starting capture', async () => {
  let listener, created = false;
  const calls = [];
  const chrome = {
    action: { onClicked: { addListener() {} } }, sidePanel: { open: async () => {} },
    offscreen: {
      hasDocument: async () => created,
      createDocument: async options => { created = true; calls.push({ type: 'create-document', ...options }); },
      Reason: { USER_MEDIA: 'USER_MEDIA' },
    },
    tabCapture: { getMediaStreamId: async () => 'stream-after-worker-restart' },
    runtime: {
      onMessage: { addListener: fn => { listener = fn; } },
      sendMessage: async message => { calls.push(message); return message.type === 'state' ? { active: false } : { ok: true }; },
    },
  };
  vm.runInNewContext(bundle.outputFiles[0].text, { chrome });
  const response = await new Promise(resolve => listener({ target: 'background', type: 'start', tabId: 42 }, {}, resolve));
  assert.equal(response.ok, true);
  assert.equal(calls.filter(call => call.type === 'create-document').length, 1);
  assert.ok(calls.some(call => call.type === 'start' && call.streamId === 'stream-after-worker-restart'));
});
