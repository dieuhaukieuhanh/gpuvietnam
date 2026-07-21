/**
 * Pino-backed multi-channel logger with:
 * - async rotating file sinks
 * - console in development
 * - automatic secret redaction + payload truncation
 * - error/fatal mirror to error.log
 */

import pino from 'pino';

import { LOG_CHANNELS, LOG_CHANNEL_FILES, normalizeChannel } from './channels.js';
import { bindingsFromContext, getLogContext } from './context.js';
import { ensureLogsDir, getLogsDir, initLogging } from './init.js';
import { createRotatingLogStream } from './rotate.js';
import { redactObject } from './redact.js';
import { serializeError } from './serialize-error.js';
import { LOGGING_VERSION } from './version.js';

/** @typedef {import('./channels.js').LogChannel} LogChannel */

/**
 * @typedef {Object} ChannelLogger
 * @property {(obj: Record<string, unknown>|string, msg?: string) => void} trace
 * @property {(obj: Record<string, unknown>|string, msg?: string) => void} debug
 * @property {(obj: Record<string, unknown>|string, msg?: string) => void} info
 * @property {(obj: Record<string, unknown>|string, msg?: string) => void} warn
 * @property {(obj: Record<string, unknown>|string, msg?: string) => void} error
 * @property {(obj: Record<string, unknown>|string, msg?: string) => void} fatal
 * @property {(bindings: Record<string, unknown>) => ChannelLogger} child
 */

/** @type {ReturnType<typeof buildLoggers> | null} */
let cached = null;

function shouldLogToConsole() {
  if (process.env.LOG_TO_CONSOLE === '0' || process.env.LOG_TO_CONSOLE === 'false') return false;
  if (process.env.LOG_TO_CONSOLE === '1' || process.env.LOG_TO_CONSOLE === 'true') return true;
  if (process.env.NODE_ENV === 'test') return false;
  return process.env.NODE_ENV !== 'production';
}

function resolveLevel() {
  return process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
}

/**
 * @param {LogChannel} channel
 * @param {import('pino').Logger | null} errorMirror
 */
function createPinoForChannel(channel, errorMirror) {
  const filePath = LOG_CHANNEL_FILES[channel];
  /** @type {import('pino').StreamEntry[]} */
  const streams = [{ level: resolveLevel(), stream: createRotatingLogStream(filePath) }];

  if (shouldLogToConsole()) {
    // async stdout (sync:false) — never block the event loop on console
    streams.push({
      level: resolveLevel(),
      stream: pino.destination({ dest: 1, sync: false }),
    });
  }

  const base = pino(
    {
      level: resolveLevel(),
      base: { channel, loggingVersion: LOGGING_VERSION },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      serializers: {
        err: (err) => serializeError(err),
        error: (err) => serializeError(err),
      },
    },
    pino.multistream(streams),
  );

  return wrapWithContext(channel, base, errorMirror);
}

/**
 * @param {LogChannel} channel
 * @param {import('pino').Logger} base
 * @param {import('pino').Logger | null} errorMirror
 * @returns {ChannelLogger}
 */
function wrapWithContext(channel, base, errorMirror) {
  /**
   * @param {'trace'|'debug'|'info'|'warn'|'error'|'fatal'} level
   * @param {Record<string, unknown>|string} objOrMsg
   * @param {string} [msg]
   */
  function write(level, objOrMsg, msg) {
    const ctxBindings = bindingsFromContext();
    const ctxOp = getLogContext().operation;
    /** @type {Record<string, unknown>} */
    let obj;
    /** @type {string|undefined} */
    let message;

    if (typeof objOrMsg === 'string') {
      obj = { ...ctxBindings };
      if (ctxOp && obj.operation == null) obj.operation = ctxOp;
      message = objOrMsg;
    } else {
      const incoming = { ...(objOrMsg ?? {}) };
      if (incoming.err != null && !(incoming.err instanceof Error) && typeof incoming.err === 'object') {
        // already serialized-ish; still redact
      } else if (incoming.err instanceof Error) {
        incoming.err = serializeError(incoming.err, {
          provider: /** @type {any} */ (incoming).provider,
          operation: /** @type {any} */ (incoming).operation,
        });
      }
      obj = { ...ctxBindings, ...incoming };
      if (ctxOp && obj.operation == null) obj.operation = ctxOp;
      message = msg;
    }

    const safe = redactObject(obj);

    if (message != null) {
      base[level](safe, message);
    } else {
      base[level](safe);
    }

    if ((level === 'error' || level === 'fatal') && errorMirror && channel !== 'error') {
      const mirrorObj = { ...safe, sourceChannel: channel };
      if (message != null) {
        errorMirror[level](mirrorObj, message);
      } else {
        errorMirror[level](mirrorObj);
      }
    }
  }

  return {
    trace: (o, m) => write('trace', o, m),
    debug: (o, m) => write('debug', o, m),
    info: (o, m) => write('info', o, m),
    warn: (o, m) => write('warn', o, m),
    error: (o, m) => write('error', o, m),
    fatal: (o, m) => write('fatal', o, m),
    child: (bindings) => {
      const childBase = base.child(bindings && typeof bindings === 'object' ? redactObject(bindings) : {});
      return wrapWithContext(channel, childBase, errorMirror);
    },
  };
}

function buildLoggers() {
  initLogging();
  ensureLogsDir();

  const errorPinoBase = createPinoForChannel('error', null);
  // Recreate error channel as raw pino for mirroring (same rotating sink)
  const errorStreams = [
    { level: 'error', stream: createRotatingLogStream(LOG_CHANNEL_FILES.error) },
  ];
  if (shouldLogToConsole()) {
    errorStreams.push({ level: 'error', stream: pino.destination({ dest: 1, sync: false }) });
  }
  const errorPino = pino(
    {
      level: 'error',
      base: { channel: 'error', loggingVersion: LOGGING_VERSION },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      serializers: {
        err: (err) => serializeError(err),
        error: (err) => serializeError(err),
      },
    },
    pino.multistream(errorStreams),
  );

  void errorPinoBase;
  void getLogsDir;

  /** @type {Record<LogChannel, ChannelLogger>} */
  const loggers = {
    error: wrapWithContext('error', errorPino, null),
    app: createPinoForChannel('app', errorPino),
    api: createPinoForChannel('api', errorPino),
    worker: createPinoForChannel('worker', errorPino),
    provider: createPinoForChannel('provider', errorPino),
  };

  return loggers;
}

/**
 * @returns {Record<LogChannel, ChannelLogger>}
 */
export function getLogger() {
  if (!cached) cached = buildLoggers();
  return cached;
}

/**
 * @param {LogChannel|string} [channel]
 * @returns {ChannelLogger}
 */
export function logger(channel) {
  const loggers = getLogger();
  const resolved = normalizeChannel(channel ?? getLogContext().channel ?? 'app');
  return loggers[resolved];
}

/**
 * @param {LogChannel|string} channel
 * @param {'trace'|'debug'|'info'|'warn'|'error'|'fatal'} level
 * @param {string} message
 * @param {Record<string, unknown>} [meta]
 */
export function log(channel, level, message, meta = {}) {
  logger(channel)[level](meta, message);
}

/** Test helper — reset singleton (does not close streams). */
export function __resetLoggerForTests() {
  cached = null;
}
