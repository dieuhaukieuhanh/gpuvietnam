/**
 * Log channel names to file destinations under logs/.
 */

/** @typedef {'app' | 'api' | 'worker' | 'provider' | 'error'} LogChannel */

/** @type {readonly LogChannel[]} */
export const LOG_CHANNELS = Object.freeze(['app', 'api', 'worker', 'provider', 'error']);

/** @type {Record<LogChannel, string>} */
export const LOG_CHANNEL_FILES = Object.freeze({
  app: 'app.log',
  api: 'api.log',
  worker: 'worker.log',
  provider: 'provider.log',
  error: 'error.log',
});

/**
 * @param {string|null|undefined} value
 * @returns {LogChannel}
 */
export function normalizeChannel(value) {
  const key = String(value ?? 'app').toLowerCase();
  if (key === 'api' || key === 'worker' || key === 'provider' || key === 'error' || key === 'app') {
    return key;
  }
  return 'app';
}
