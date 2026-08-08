/**
 * In-memory rate limiter — dùng Map, đủ cho single-instance Vercel deployment.
 *
 * Usage:
 *   const rl = checkRateLimit(`login:${ip}`, { max: 10, windowMs: 15 * 60 * 1000 });
 *   if (!rl.ok) return res.status(429).json({ error: 'Quá nhiều yêu cầu.', retryAfter: rl.retryAfter });
 */

const store = new Map();

/** Dọn dẹp entry hết hạn mỗi 60s để tránh memory leak */
function cleanExpired() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}

// Auto-clean định kỳ
if (typeof setInterval !== 'undefined') {
  setInterval(cleanExpired, 60_000);
}

/**
 * @param {string} key — unique key (e.g. `login:127.0.0.1`)
 * @param {{ max: number, windowMs: number }} options
 * @returns {{ ok: boolean, remaining: number, resetAt: number, retryAfter?: number }}
 */
export function checkRateLimit(key, { max, windowMs }) {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  entry.count += 1;
  store.set(key, entry);

  const remaining = Math.max(0, max - entry.count);
  const ok = entry.count <= max;

  return {
    ok,
    remaining,
    resetAt: entry.resetAt,
    retryAfter: ok ? undefined : Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

/**
 * Lock một key trong khoảng thời gian (dùng cho brute-force lock OTP).
 * Trả về true nếu đang bị lock.
 */
export function isLocked(key) {
  const entry = store.get(key);
  if (!entry) return false;
  if (Date.now() >= entry.resetAt) {
    store.delete(key);
    return false;
  }
  return entry.count < 0; // count < 0 = lock flag
}

/**
 * Set lock cho một key.
 */
export function setLock(key, lockMs) {
  store.set(key, { count: -1, resetAt: Date.now() + lockMs });
}

/**
 * Xóa lock (dùng sau khi verify thành công).
 */
export function clearLock(key) {
  store.delete(key);
}

/**
 * Lấy thời gian lock còn lại (giây), hoặc 0 nếu không bị lock.
 */
export function getLockRemaining(key) {
  const entry = store.get(key);
  if (!entry || entry.count >= 0) return 0;
  const remaining = Math.ceil((entry.resetAt - Date.now()) / 1000);
  return Math.max(0, remaining);
}

/**
 * Reset toàn bộ store (dùng cho testing).
 */
export function resetRateLimitStore() {
  store.clear();
}
