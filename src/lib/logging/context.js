/**
 * AsyncLocalStorage request / operation context for structured logging.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * @typedef {Object} LogContext
 * @property {string} [requestId]
 * @property {string} [userId]
 * @property {string} [machineId]
 * @property {string} [gpuSessionId]
 * @property {string} [subscriptionId]
 * @property {string} [operation]
 * @property {string} [channel]
 * @property {Record<string, unknown>} [extra]
 */

/** @type {AsyncLocalStorage<LogContext>} */
const storage = new AsyncLocalStorage();

/** @returns {LogContext} */
export function getLogContext() {
  return storage.getStore() ?? {};
}

/**
 * @template T
 * @param {LogContext} context
 * @param {() => T | Promise<T>} fn
 * @returns {T | Promise<T>}
 */
export function runWithLogContext(context, fn) {
  const parent = getLogContext();
  const merged = {
    ...parent,
    ...context,
    extra: {
      ...(parent.extra ?? {}),
      ...(context.extra ?? {}),
    },
  };
  return storage.run(merged, fn);
}

/**
 * Merge fields into the active context (no-op outside a store).
 * @param {Partial<LogContext>} patch
 */
export function updateLogContext(patch) {
  const store = storage.getStore();
  if (!store) return;
  if (patch.requestId != null) store.requestId = patch.requestId;
  if (patch.userId != null) store.userId = patch.userId;
  if (patch.machineId != null) store.machineId = patch.machineId;
  if (patch.gpuSessionId != null) store.gpuSessionId = patch.gpuSessionId;
  if (patch.subscriptionId != null) store.subscriptionId = patch.subscriptionId;
  if (patch.operation != null) store.operation = patch.operation;
  if (patch.channel != null) store.channel = patch.channel;
  if (patch.extra && typeof patch.extra === 'object') {
    store.extra = { ...(store.extra ?? {}), ...patch.extra };
  }
}

/**
 * Flat fields merged into every log line.
 * @param {Partial<LogContext>} [override]
 * @returns {Record<string, unknown>}
 */
export function bindingsFromContext(override = {}) {
  const ctx = { ...getLogContext(), ...override };
  /** @type {Record<string, unknown>} */
  const out = {};
  if (ctx.requestId) out.requestId = ctx.requestId;
  if (ctx.userId) out.userId = ctx.userId;
  if (ctx.machineId) out.machineId = ctx.machineId;
  if (ctx.gpuSessionId) out.gpuSessionId = ctx.gpuSessionId;
  if (ctx.subscriptionId) out.subscriptionId = ctx.subscriptionId;
  if (ctx.operation) out.operation = ctx.operation;
  if (ctx.extra && typeof ctx.extra === 'object') {
    for (const [k, v] of Object.entries(ctx.extra)) {
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}
