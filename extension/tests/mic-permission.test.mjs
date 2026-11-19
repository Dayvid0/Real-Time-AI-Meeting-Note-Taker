import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/mic-permission.ts'], bundle: true, write: false, format: 'iife' });
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function setup(getUserMedia, reply = { ok: true }) {
  const allow = { disabled: false }, result = { textContent: '' }, back = {};
  const calls = [];
  vm.runInNewContext(bundle.outputFiles[0].text, {
    document: { getElementById: id => ({ allow, result, back })[id] },
    navigator: { mediaDevices: { getUserMedia } },
    location: { search: '?returnTabId=42&returnWindowId=7&sessionId=meeting' }, URLSearchParams,
    window: { close: () => { calls.push('closed'); } },
    chrome: {
      runtime: { sendMessage: async message => { calls.push(message); return reply; } },
      tabs: { update: async id => { calls.push({ tab: id }); } },
      windows: { update: async id => { calls.push({ window: id }); } },
    },
  });
  return { allow, result, back, calls };
}

test('microphone check waits for a click and releases all tracks after permission succeeds', async () => {
  let requests = 0, stopped = 0, resolve;
  const h = setup(options => {
    assert.equal(options.audio, true);
    requests++;
    return new Promise(done => { resolve = done; });
  });
  assert.equal(requests, 0);
  h.allow.onclick();
  assert.equal(requests, 1);
  assert.equal(h.allow.disabled, true);
  resolve({ getTracks: () => [{ stop: () => { stopped++; } }, { stop: () => { stopped++; } }] });
  await settle();
  assert.equal(stopped, 2);
  assert.match(h.result.textContent, /^Microphone allowed/);
  assert.equal(h.allow.disabled, false);
  assert.equal(h.calls[0].type, 'microphone-ready');
  assert.equal(h.calls[0].sessionId, 'meeting');
  assert.equal(h.calls[1].tab, 42);
  assert.equal(h.calls[2].window, 7);
  assert.equal(h.calls[3], 'closed');
});

test('blocked, missing and busy microphones get distinct instructions without raw device details', async () => {
  for (const [name, expected] of [
    ['NotAllowedError', /access is blocked/],
    ['NotFoundError', /No microphone was found/],
    ['NotReadableError', /could not be opened/],
    ['UnknownError', /could not start/],
  ]) {
    const h = setup(async () => { throw { name, message: 'private-device-detail' }; });
    h.allow.onclick();
    await settle();
    assert.match(h.result.textContent, expected);
    assert.doesNotMatch(h.result.textContent, /private-device-detail/);
    assert.equal(h.allow.disabled, false);
  }
});


test('failed microphone attachment stays open to show help; Back never starts recording', async () => {
  const h = setup(async () => ({ getTracks: () => [] }), { ok: false });
  h.allow.onclick(); await settle();
  assert.match(h.result.textContent, /could not join/);
  assert.equal(h.calls.includes('closed'), false);
  h.back.onclick(); await settle();
  assert.equal(h.calls.at(-1), 'closed');
  assert.equal(h.calls.filter(call => call?.type === 'start').length, 0);
});
