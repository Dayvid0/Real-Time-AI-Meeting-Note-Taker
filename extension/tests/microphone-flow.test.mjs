import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/background.ts'], bundle: true, write: false, format: 'iife' });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function harness({ legacy = false } = {}) {
  let listener;
  const calls = [];
  const chrome = {
    action: { onClicked: { addListener() {} } },
    sidePanel: { open: async () => {}, setOptions: async value => { calls.push({ type: 'options', ...value }); } },
    offscreen: { hasDocument: async () => true },
    tabs: {
      get: async id => ({ id, windowId: 7 }),
      create: async value => { calls.push({ type: 'new-tab', ...value }); },
    },
    windows: {
      create: async value => { calls.push({ type: 'new-window', ...value }); return { id: 90 }; },
      update: async (id, value) => { calls.push({ type: 'focus', id, ...value }); },
    },
    runtime: {
      getURL: path => `chrome-extension://test/${path}`,
      onMessage: { addListener: fn => { listener = fn; } },
      sendMessage: async value => {
        calls.push(value);
        return value.type === 'state' ? { active: true, tabId: 42, sessionId: 'current' } : { ok: true };
      },
    },
  };
  if (!legacy) chrome.sidePanel.close = async value => { calls.push({ type: 'close', ...value }); };
  vm.runInNewContext(bundle.outputFiles[0].text, { chrome, URL, URLSearchParams });
  return { calls, request: message => new Promise(resolve => {
    const result = listener({ target: 'background', ...message }, { url: 'chrome-extension://test/mic-permission.html' }, resolve);
    if (result !== true) resolve(undefined);
  }) };
}

test('microphone setup preserves the original meeting tab and reuses one small window', async () => {
  const h = harness();
  await h.request({ type: 'microphone-setup', tabId: 99 });
  await h.request({ type: 'microphone-setup', tabId: 99 });
  assert.equal(h.calls.filter(call => call.type === 'new-tab').length, 0);
  const windows = h.calls.filter(call => call.url);
  assert.equal(windows.length, 1, 'setup should open exactly one popup window');
  assert.equal(windows[0].type, 'popup');
  const url = new URL(windows[0].url);
  assert.equal(url.searchParams.get('returnTabId'), '42');
  assert.equal(url.searchParams.get('returnWindowId'), '7');
  assert.equal(url.searchParams.get('sessionId'), 'current');
});

test('granting permission attaches the microphone to the existing session without restarting', async () => {
  const h = harness();
  assert.equal((await h.request({ type: 'microphone-ready', sessionId: 'current' }))?.ok, true);
  assert.ok(h.calls.some(call => call.target === 'offscreen' && call.type === 'enable-microphone' && call.sessionId === 'current'));
  assert.equal(h.calls.filter(call => ['start', 'stop'].includes(call.type)).length, 0);
});

test('close targets the panel window, with a recoverable fallback on older browsers', async () => {
  const h = harness();
  assert.equal((await h.request({ type: 'close-panel', windowId: 7 }))?.ok, true);
  assert.ok(h.calls.some(call => call.type === 'close' && call.windowId === 7));
  const older = harness({ legacy: true });
  await older.request({ type: 'close-panel', windowId: 7 });
  await settle();
  assert.deepEqual(older.calls.filter(call => call.type === 'options').map(call => call.enabled), [false, true]);
});
