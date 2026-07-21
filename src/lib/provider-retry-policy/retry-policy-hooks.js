/**
 * Provider/operation hooks that refine a baseline retry decision
 * without embedding provider logic in the engine core.
 */

/** @type {Map<string, Array<Function>>} */
const hooks = new Map();

/**
 * @param {string} provider
 * @param {string} [operation]
 */
function hookKey(provider, operation = '*') {
  return String(provider || '*').toLowerCase() + ':' + String(operation || '*').toLowerCase();
}

/**
 * @param {string} provider
 * @param {string|null|undefined} operation
 * @param {(input: object, decision: object) => object} fn
 */
export function registerRetryPolicyHook(provider, operation, fn) {
  if (typeof fn !== 'function') return () => {};
  const key = hookKey(provider, operation ?? '*');
  const list = hooks.get(key) || [];
  list.push(fn);
  hooks.set(key, list);
  return () => {
    const cur = hooks.get(key) || [];
    hooks.set(
      key,
      cur.filter((x) => x !== fn),
    );
  };
}

/**
 * @param {object} input
 * @param {object} decision
 */
export function applyRetryPolicyHooks(input, decision) {
  const provider = String(input.provider || '*').toLowerCase();
  const operation = String(input.operation || '*').toLowerCase();
  const keys = [
    hookKey(provider, operation),
    hookKey(provider, '*'),
    hookKey('*', operation),
    hookKey('*', '*'),
  ];
  let next = { ...decision };
  /** @type {Set<Function>} */
  const seen = new Set();
  for (const key of keys) {
    for (const fn of hooks.get(key) || []) {
      if (seen.has(fn)) continue;
      seen.add(fn);
      const patched = fn(input, next);
      if (patched && typeof patched === 'object') next = patched;
    }
  }
  return next;
}

export function clearRetryPolicyHooksForTests() {
  hooks.clear();
}
