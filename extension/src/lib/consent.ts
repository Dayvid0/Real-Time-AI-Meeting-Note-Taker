const ACCEPTED_AT = 'meeting-notes-consent-accepted-at';
const REMINDED_AT = 'meeting-notes-consent-reminded-at';
const REMINDER_MS = 30 * 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function readTime(store: Store, key: string): number | null {
  try {
    const value = store.getItem(key);
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  } catch { return null; }
}

function writeTime(store: Store, key: string, now: number): boolean {
  try { store.setItem(key, String(now)); return true; }
  catch { return false; }
}

export function readConsent(store: Store, now = Date.now()): { accepted: boolean; reminderDue: boolean } {
  const acceptedAt = readTime(store, ACCEPTED_AT);
  if (acceptedAt === null) return { accepted: false, reminderDue: false };
  const remindedAt = readTime(store, REMINDED_AT) ?? acceptedAt;
  return { accepted: true, reminderDue: now - remindedAt >= REMINDER_MS };
}

export function acceptConsent(store: Store, now = Date.now()): boolean {
  return writeTime(store, ACCEPTED_AT, now) && writeTime(store, REMINDED_AT, now);
}

export function dismissReminder(store: Store, now = Date.now()): boolean {
  return writeTime(store, REMINDED_AT, now);
}
