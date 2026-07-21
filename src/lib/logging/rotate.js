/**
 * Size + time based rotating file streams (async, non-blocking).
 */

import { join } from 'node:path';
import { createStream } from 'rotating-file-stream';

import { getLogsDir } from './init.js';

/**
 * @param {string} filename e.g. api.log
 * @returns {import('stream').Writable}
 */
export function createRotatingLogStream(filename) {
  const size = /** @type {any} */ (process.env.LOG_ROTATE_SIZE || '50M');
  const interval = /** @type {any} */ (process.env.LOG_ROTATE_INTERVAL || '1d');
  const maxFiles = Number(process.env.LOG_ROTATE_MAX_FILES || 14);
  const dir = getLogsDir();

  return createStream(filename, {
    path: dir,
    size,
    interval,
    maxFiles,
    // required by rotating-file-stream when maxFiles is set
    history: `${filename}.history.txt`,
    compress: process.env.LOG_ROTATE_COMPRESS === '0' ? false : 'gzip',
    teeToStdout: false,
  });
}

/**
 * @param {string} filename
 * @returns {string}
 */
export function resolveLogFilePath(filename) {
  return join(getLogsDir(), filename);
}
