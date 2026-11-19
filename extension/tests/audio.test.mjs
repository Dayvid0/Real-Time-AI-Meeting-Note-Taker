import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

async function moduleFrom(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { pcm16, mono, writeStereo } = await moduleFrom('src/lib/pcm.ts');
const { parseServerMessage } = await moduleFrom('src/lib/protocol.ts');

test('PCM16 clipping, little-endian stereo order, mono downmix and absent mic silence', () => {
  assert.equal(pcm16(-2), -32768);
  assert.equal(pcm16(2), 32767);
  assert.equal(pcm16(NaN), 0);
  assert.equal(mono([], 0), 0);
  assert.equal(mono([new Float32Array([0.75]), new Float32Array([-0.25])], 0), 0.25);
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  writeStereo(view, 0, -1, 1);
  writeStereo(view, 1, 0, 0.5);
  assert.deepEqual([...new Uint8Array(bytes)], [0, 128, 255, 127, 0, 0, 255, 63]);
});

test('worklet keeps channels aligned and flushes the last partial frame', async () => {
  const bundle = await build({ entryPoints: ['src/pcm-worklet.ts'], bundle: true, write: false, format: 'iife' });
  let Processor;
  const messages = [];
  class MockProcessor {
    port = { postMessage: value => messages.push(value) };
  }
  vm.runInNewContext(bundle.outputFiles[0].text, {
    AudioWorkletProcessor: MockProcessor,
    registerProcessor: (name, implementation) => { assert.equal(name, 'stereo-capture'); Processor = implementation; },
    ArrayBuffer, DataView, Float32Array,
  });
  const processor = new Processor();
  const local = new Float32Array(128).fill(0.5);
  const remote = new Float32Array(128).fill(-0.5);
  const output = [[new Float32Array(128)]];
  for (let i = 0; i < 13; i++) processor.process([[local], [remote]], output);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].byteLength, 6400);
  for (let i = 0; i < 1600; i++) {
    assert.equal(new DataView(messages[0]).getInt16(i * 4, true), 16383);
    assert.equal(new DataView(messages[0]).getInt16(i * 4 + 2, true), -16384);
  }
  processor.port.onmessage({ data: { type: 'flush' } });
  assert.equal(messages[1].byteLength, 64 * 4);
  assert.equal(messages[2].type, 'flushed');
  assert.equal(processor.process([[local], [remote]], output), false);
});

test('worklet emits local silence while remote tab audio continues', async () => {
  const bundle = await build({ entryPoints: ['src/pcm-worklet.ts'], bundle: true, write: false, format: 'iife' });
  let Processor;
  const messages = [];
  class MockProcessor { port = { postMessage: value => messages.push(value) }; }
  vm.runInNewContext(bundle.outputFiles[0].text, {
    AudioWorkletProcessor: MockProcessor, registerProcessor: (_, value) => { Processor = value; },
    ArrayBuffer, DataView, Float32Array,
  });
  const processor = new Processor();
  processor.process([[], [new Float32Array(128).fill(1)]], [[new Float32Array(128)]]);
  processor.port.onmessage({ data: { type: 'flush' } });
  const view = new DataView(messages[0]);
  for (let i = 0; i < 128; i++) {
    assert.equal(view.getInt16(i * 4, true), 0);
    assert.equal(view.getInt16(i * 4 + 2, true), 32767);
  }
});

test('incoming protocol rejects malformed sequences, labels, and timestamps', () => {
  const good = { type: 'transcript', seq: 1, speaker: 'local', text: 'hello', startMs: 0, endMs: 100, final: true };
  assert.deepEqual(parseServerMessage(JSON.stringify(good)), good);
  for (const change of [{ seq: 0 }, { seq: 1.2 }, { speaker: 'unknown' }, { startMs: -1 }, { endMs: -1 }, { final: 'yes' }]) {
    assert.throws(() => parseServerMessage(JSON.stringify({ ...good, ...change })));
  }
  assert.throws(() => parseServerMessage('null'));
  assert.throws(() => parseServerMessage('{"type":"ready","sampleRate":8000,"channels":2}'));
});
