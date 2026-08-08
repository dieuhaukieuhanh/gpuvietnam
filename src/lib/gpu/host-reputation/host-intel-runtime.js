/**
 * Host Intelligence runtime helpers:
 * - single-flight lock (prevent overlapping cron cycles)
 * - track rented probe instances/orders for forced cleanup on SIGTERM/exit
 */

import fs from 'node:fs';
import path from 'node:path';
import { opsAlertAsync } from '../../ops/alert-dispatcher.js';

export const HOST_INTEL_VAST_LABEL = 'gpuvietnam-host-intel';
export const HOST_INTEL_CLORE_LABEL = 'gpuvietnam-host-intel-clore';

export const DEFAULT_HOST_INTEL_LOCK_PATH = path.resolve(
  process.env.HOST_INTEL_LOCK_PATH || 'tmp/host-intel.lock',
);

/** Hard wall-clock per probe rent (gate + destroy). */
export function resolveHostIntelProbeMaxMs() {
  const raw = Number(process.env.HOST_INTEL_PROBE_MAX_MS ?? 5 * 60 * 1000);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : 5 * 60 * 1000;
}

/** @type {Set<string>} */
const trackedVast = new Set();
/** @type {Set<string>} */
const trackedClore = new Set();

/** @type {{ destroyVast?: (id: string) => Promise<unknown>; destroyClore?: (id: string) => Promise<unknown> } | null} */
let destroyers = null;

/** @type {boolean} */
let cleaningUp = false;

/**
 * @param {{ destroyVast?: (id: string) => Promise<unknown>; destroyClore?: (id: string) => Promise<unknown> }} handlers
 */
export function setHostIntelDestroyers(handlers) {
  if (!handlers || typeof handlers !== 'object') return;
  destroyers = {
    ...(destroyers || {}),
    ...handlers,
  };
}

export function trackHostIntelVastInstance(instanceId) {
  const id = String(instanceId ?? '').trim();
  if (id) trackedVast.add(id);
}

export function untrackHostIntelVastInstance(instanceId) {
  trackedVast.delete(String(instanceId ?? '').trim());
}

export function trackHostIntelCloreOrder(orderId) {
  const id = String(orderId ?? '').trim();
  if (id) trackedClore.add(id);
}

export function untrackHostIntelCloreOrder(orderId) {
  trackedClore.delete(String(orderId ?? '').trim());
}

export function getTrackedHostIntelLeases() {
  return {
    vast: [...trackedVast],
    clore: [...trackedClore],
  };
}

/** @internal */
export function _resetHostIntelRuntimeForTests() {
  trackedVast.clear();
  trackedClore.clear();
  destroyers = null;
  cleaningUp = false;
}

/**
 * @param {string} [lockPath]
 * @returns {{ ok: true; path: string } | { ok: false; reason: string; holderPid?: number }}
 */
export function acquireHostIntelLock(lockPath = DEFAULT_HOST_INTEL_LOCK_PATH) {
  const resolved = path.resolve(lockPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  if (fs.existsSync(resolved)) {
    try {
      const raw = fs.readFileSync(resolved, 'utf8').trim();
      const holderPid = Number(raw);
      if (Number.isFinite(holderPid) && holderPid > 0) {
        try {
          process.kill(holderPid, 0);
          return { ok: false, reason: 'locked', holderPid };
        } catch {
          // stale lock
        }
      }
    } catch {
      // rewrite below
    }
  }

  try {
    const fd = fs.openSync(resolved, 'wx');
    fs.writeFileSync(fd, `${process.pid}\n`, 'utf8');
    fs.closeSync(fd);
    return { ok: true, path: resolved };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      return { ok: false, reason: 'locked' };
    }
    // Fallback overwrite for weird FS (still better than dual rent)
    fs.writeFileSync(resolved, `${process.pid}\n`, 'utf8');
    return { ok: true, path: resolved };
  }
}

/**
 * @param {string} [lockPath]
 */
export function releaseHostIntelLock(lockPath = DEFAULT_HOST_INTEL_LOCK_PATH) {
  const resolved = path.resolve(lockPath);
  try {
    if (!fs.existsSync(resolved)) return;
    const raw = fs.readFileSync(resolved, 'utf8').trim();
    if (raw === String(process.pid)) {
      fs.unlinkSync(resolved);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Destroy all tracked probe leases. Safe to call multiple times.
 * @param {{ reason?: string }} [options]
 */
export async function cleanupTrackedHostIntelLeases(options = {}) {
  if (cleaningUp) return { vast: [], clore: [], errors: [] };
  cleaningUp = true;
  const reason = options.reason || 'cleanup';
  /** @type {string[]} */
  const vastDone = [];
  /** @type {string[]} */
  const cloreDone = [];
  /** @type {Array<{ provider: string; id: string; error: string }>} */
  const errors = [];

  const vastIds = [...trackedVast];
  const cloreIds = [...trackedClore];

  for (const id of vastIds) {
    try {
      if (!destroyers?.destroyVast) throw new Error('destroyVast not configured');
      await destroyers.destroyVast(id);
      trackedVast.delete(id);
      vastDone.push(id);
      console.log(`[host-intel-cleanup] destroyed vast instance=${id} reason=${reason}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ provider: 'vast', id, error: message });
      console.warn(`[host-intel-cleanup] vast destroy failed id=${id}: ${message}`);
    }
  }

  for (const id of cloreIds) {
    try {
      if (!destroyers?.destroyClore) throw new Error('destroyClore not configured');
      await destroyers.destroyClore(id);
      trackedClore.delete(id);
      cloreDone.push(id);
      console.log(`[host-intel-cleanup] destroyed clore order=${id} reason=${reason}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ provider: 'clore', id, error: message });
      console.warn(`[host-intel-cleanup] clore destroy failed id=${id}: ${message}`);
    }
  }

  if (errors.length > 0) {
    opsAlertAsync({
      event: 'orphan_host_intel',
      severity: 'critical',
      title: `Host-intel cleanup failed (${errors.length})`,
      details: { reason, errors, vastDone, cloreDone },
      dedupeKey: `orphan_host_intel:cleanup_fail:${reason}`,
    });
  }

  cleaningUp = false;
  return { vast: vastDone, clore: cloreDone, errors };
}

/**
 * Install process signal/exit hooks once.
 * @param {{ lockPath?: string }} [options]
 */
export function installHostIntelCleanupHooks(options = {}) {
  const lockPath = options.lockPath || DEFAULT_HOST_INTEL_LOCK_PATH;
  if (/** @type {any} */ (globalThis).__gpuvnHostIntelHooksInstalled) return;
  /** @type {any} */ (globalThis).__gpuvnHostIntelHooksInstalled = true;

  const onSignal = (signal) => {
    console.warn(`[host-intel] received ${signal} — cleaning tracked leases`);
    void cleanupTrackedHostIntelLeases({ reason: signal }).finally(() => {
      releaseHostIntelLock(lockPath);
      // Allow systemd kill to complete; exit after best-effort cleanup.
      setTimeout(() => process.exit(128), 50).unref?.();
    });
  };

  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('beforeExit', () => {
    if (trackedVast.size || trackedClore.size) {
      // beforeExit cannot await long; schedule sync best-effort log
      console.warn(
        `[host-intel] beforeExit with tracked leases vast=${[...trackedVast]} clore=${[...trackedClore]}`,
      );
    }
    releaseHostIntelLock(lockPath);
  });
}

/**
 * Destroy helper with retries + untrack on success.
 * @param {(id: string) => Promise<unknown>} destroyFn
 * @param {string} id
 * @param {'vast'|'clore'} provider
 */
export async function destroyHostIntelLeaseWithRetry(destroyFn, id, provider) {
  const leaseId = String(id ?? '').trim();
  if (!leaseId) return;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await destroyFn(leaseId);
      if (provider === 'vast') untrackHostIntelVastInstance(leaseId);
      else untrackHostIntelCloreOrder(leaseId);
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  console.warn(`[host-intel] destroy failed after retries provider=${provider} id=${leaseId}: ${message}`);
  opsAlertAsync({
    event: 'orphan_host_intel',
    severity: 'critical',
    title: `Host-intel destroy failed ${provider}:${leaseId}`,
    details: { provider, id: leaseId, error: message },
    dedupeKey: `orphan_host_intel:destroy_fail:${provider}:${leaseId}`,
  });
  throw lastErr instanceof Error ? lastErr : new Error(message);
}
