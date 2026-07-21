/**
 * In-memory rate limit for backup presign (per token hash).
 * Process-local — fine for single Node instance; reset on deploy.
 */

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;

/** @type {Map<string, number[]>} */
const hitsByKey = new Map();

/**
 * @param {string} key
 * @param {{ windowMs?: number; max?: number; now?: number }} [options]
 * @returns {{ ok: true } | { ok: false; retryAfterSec: number }}
 */
export function checkBackupPresignRateLimit(key, options = {}) {
  const windowMs = Math.max(1000, Math.floor(Number(options.windowMs ?? DEFAULT_WINDOW_MS) || DEFAULT_WINDOW_MS));
  const max = Math.max(1, Math.floor(Number(options.max ?? DEFAULT_MAX) || DEFAULT_MAX));
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const id = String(key ?? '').trim() || 'anonymous';

  const cutoff = now - windowMs;
  const prev = (hitsByKey.get(id) ?? []).filter((t) => t > cutoff);

  if (prev.length >= max) {
    const oldest = prev[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    hitsByKey.set(id, prev);
    return { ok: false, retryAfterSec };
  }

  prev.push(now);
  hitsByKey.set(id, prev);
  return { ok: true };
}

/** Test helper */
export function resetBackupPresignRateLimit() {
  hitsByKey.clear();
}