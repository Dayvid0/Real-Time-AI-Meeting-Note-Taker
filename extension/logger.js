/**
 * Tiny leveled logger for the Meeting Notes AI extension.
 *
 * Set `globalThis.MEETING_NOTES_LOG_LEVEL` to one of
 * `"debug" | "info" | "warn" | "error"` to raise/lower verbosity.
 * Defaults to `"info"`, so debug noise is silent in production.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel() {
  const configured =
    typeof globalThis.MEETING_NOTES_LOG_LEVEL === 'string'
      ? globalThis.MEETING_NOTES_LOG_LEVEL.toLowerCase()
      : '';
  return LEVELS[configured] ?? LEVELS.info;
}

function emit(level, scope, args) {
  if (LEVELS[level] < currentLevel()) return;
  const method = level === 'debug' ? 'log' : level;
  // eslint-disable-next-line no-console
  console[method](`[meeting-notes:${scope}]`, ...args);
}

/**
 * @param {string} scope
 * @returns {{debug: (...a: unknown[]) => void, info: (...a: unknown[]) => void, warn: (...a: unknown[]) => void, error: (...a: unknown[]) => void}}
 */
export function createLogger(scope) {
  return {
    debug: (...args) => emit('debug', scope, args),
    info: (...args) => emit('info', scope, args),
    warn: (...args) => emit('warn', scope, args),
    error: (...args) => emit('error', scope, args),
  };
}

export const logger = createLogger('app');
