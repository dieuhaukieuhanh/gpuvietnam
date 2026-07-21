/**
 * Ensure logs/ exists and install process-level error handlers once.
 * Directory creation uses sync mkdir only at boot (once); log writes are async.
 */

import { mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

import { LOG_CHANNELS, LOG_CHANNEL_FILES } from './channels.js';

let initialized = false;
let handlersInstalled = false;

function isServerlessReadonlyFs() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** @returns {string} */
export function getLogsDir() {
  if (process.env.LOG_DIR) return String(process.env.LOG_DIR);
  // Vercel/Lambda: only /tmp is writable.
  if (isServerlessReadonlyFs()) return join('/tmp', 'gpuvietnam-logs');
  return join(process.cwd(), 'logs');
}

/**
 * Create logs/ and empty channel files if missing.
 * @returns {string} absolute logs directory
 */
export function ensureLogsDir() {
  const preferred = getLogsDir();
  let dir = preferred;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    dir = join('/tmp', 'gpuvietnam-logs');
    mkdirSync(dir, { recursive: true });
  }
  for (const channel of LOG_CHANNELS) {
    const file = join(dir, LOG_CHANNEL_FILES[channel]);
    try {
      closeSync(openSync(file, 'a'));
    } catch {
      /* ignore touch failures */
    }
  }
  return dir;
}

/**
 * Idempotent boot: file sinks + unhandled rejection / exception to error.log
 */
export function initLogging() {
  if (initialized) return getLogsDir();
  initialized = true;
  const dir = ensureLogsDir();
  installProcessHandlers();
  return dir;
}

function installProcessHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;

  const writeFatal = async (kind, err) => {
    try {
      const { getLogger } = await import('./logger.js');
      const { serializeError } = await import('./serialize-error.js');
      const loggers = getLogger();
      loggers.error.error(
        {
          operation: kind,
          err: serializeError(err, { operation: kind }),
        },
        kind,
      );
    } catch {
      console.error(`[logging] ${kind}`, err);
    }
  };

  process.on('uncaughtException', (err) => {
    void writeFatal('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    void writeFatal('unhandledRejection', err);
  });
}

/** Test helper */
export function __resetInitForTests() {
  initialized = false;
  handlersInstalled = false;
}
