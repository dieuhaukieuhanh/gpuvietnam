/**
 * Read-only performance instrumentation.
 *
 * SCB Core is frozen — this module only adds timing logs. It does NOT change
 * any behavior, timeout, retry, control flow, or return value. When no
 * profiling context is active (e.g. outside of an instrumented request),
 * every call is a cheap no-op.
 *
 * Usage:
 *   await withProf('Dashboard request', async () => { ...instrumented body... });
 *   console.log(renderProfTree());
 *
 *   const span = profStart('step');  try { ... } finally { profEnd(span); }
 *   await prof('step', async () => { ... });
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { getReadPathProfilerLabel } from './scb-read-path.js';

const storage = new AsyncLocalStorage();

/**
 * @typedef {Object} ProfSpan
 * @property {string} label
 * @property {number} start
 * @property {number} seq
 * @property {number} [end]
 * @property {number} [elapsed]
 * @property {number} depth
 */

/**
 * @typedef {Object} ProfCtx
 * @property {string} label
 * @property {number} start
 * @property {ProfSpan[]} spans
 * @property {ProfSpan[]} stack
 * @property {number} seq
 */

/** @returns {ProfCtx | undefined} */
function ctx() {
  return storage.getStore();
}

/**
 * Run fn inside a new profiling context.
 * @template T
 * @param {string} label
 * @param {() => T | Promise<T>} fn
 * @returns {T | Promise<T>}
 */
export function withProf(label, fn) {
  /** @type {ProfCtx} */
  const c = { label, start: Date.now(), spans: [], stack: [], seq: 0 };
  return storage.run(c, fn);
}

/**
 * Start a named span. No-op when no profiling context is active.
 * @param {string} label
 * @returns {ProfSpan | null}
 */
export function profStart(label) {
  const c = ctx();
  if (!c) return null;
  /** @type {ProfSpan} */
  const span = { label, start: Date.now(), seq: c.seq++, depth: c.stack.length };
  c.stack.push(span);
  return span;
}

/**
 * End a span opened by profStart.
 * @param {ProfSpan | null} span
 */
export function profEnd(span) {
  if (!span) return;
  const c = ctx();
  if (!c) return;
  span.end = Date.now();
  span.elapsed = span.end - span.start;
  c.spans.push(span);
  const idx = c.stack.indexOf(span);
  if (idx >= 0) c.stack.splice(idx, 1);
}

/**
 * Async helper wrapping profStart/profEnd around fn().
 * @template T
 * @param {string} label
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function prof(label, fn) {
  const span = profStart(label);
  try {
    return await fn();
  } finally {
    profEnd(span);
  }
}

/**
 * Render the captured spans as an indented timing tree. Returns '' when no
 * profiling context is active.
 * @returns {string}
 */
export function renderProfTree() {
  const c = ctx();
  if (!c) return '';
  const total = Date.now() - c.start;
  // Sort by (start, seq): a monotonic seq captured at profStart time breaks
  // millisecond ties so a parent span (started before its children) always
  // renders above them, instead of falling back to finish/insertion order
  // which surfaces children first.
  const sorted = [...c.spans].sort((a, b) =>
    a.start - b.start || a.seq - b.seq,
  );

  const lines = [
    `ReadPath = ${getReadPathProfilerLabel()}`,
    `${c.label} (${total}ms total)`,
  ];
  for (const span of sorted) {
    const indent = '    '.repeat(span.depth);
    const labelStr = span.label.length > 32 ? span.label.slice(0, 29) + '...' : span.label.padEnd(32);
    lines.push(`${indent}├── ${labelStr} ${String(span.elapsed ?? 0).padStart(7)}ms`);
  }
  lines.push(`└── ${' '.repeat(32)} ${String(total).padStart(7)}ms`);
  return lines.join('\n');
}
