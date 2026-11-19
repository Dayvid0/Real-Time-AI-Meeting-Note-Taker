import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const exec = promisify(execFile);

test('store packager creates a ZIP containing the built manifest at the archive root', async () => {
  await rm('meeting-notes-extension.zip', { force: true });
  await exec(process.execPath, ['package.mjs']);
  const zip = await readFile('meeting-notes-extension.zip');
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.match(zip.toString('binary'), /manifest\.json/);
  assert.doesNotMatch(zip.toString('binary'), /dist\/manifest\.json/);
});
