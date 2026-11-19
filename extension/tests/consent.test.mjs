import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';

const bundle = await build({ entryPoints: ['src/lib/consent.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const consent = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('first use is blocked until the privacy and participant-consent notice is acknowledged', () => {
  const store = storage();
  assert.deepEqual(consent.readConsent(store, 1000), { accepted: false, reminderDue: false });
  consent.acceptConsent(store, 1000);
  assert.deepEqual(consent.readConsent(store, 1001), { accepted: true, reminderDue: false });
});

test('privacy reminder returns after 30 days and can be dismissed without resetting consent', () => {
  const store = storage();
  consent.acceptConsent(store, 1000);
  const month = 30 * 24 * 60 * 60 * 1000;
  assert.equal(consent.readConsent(store, 1000 + month - 1).reminderDue, false);
  assert.equal(consent.readConsent(store, 1000 + month).reminderDue, true);
  consent.dismissReminder(store, 1000 + month);
  assert.deepEqual(consent.readConsent(store, 1000 + month + 1), { accepted: true, reminderDue: false });
});

test('invalid or unavailable storage safely returns to the first-use notice', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(consent.readConsent(broken, 1000), { accepted: false, reminderDue: false });
  assert.equal(consent.acceptConsent(broken, 1000), false);
});

test('panel exposes first-run consent and periodic privacy reminder controls', async () => {
  const html = await readFile('static/panel.html', 'utf8');
  for (const id of ['consent-screen', 'consent-accept', 'privacy-reminder', 'privacy-reminder-dismiss']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /tell everyone|participant/i);
  assert.match(html, /Deepgram/);
});
