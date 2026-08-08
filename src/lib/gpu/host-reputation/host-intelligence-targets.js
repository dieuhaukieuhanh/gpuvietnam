/**
 * Host Intelligence — fair per-GPU-line target selection.
 *
 * Available/target counts are per GPU line. The per-cycle test budget is shared,
 * so we allocate slots by deficit (lines furthest below target first) and give
 * each below-target line at least one slot when budget allows.
 */

import {
  getHostsInCooldownDone,
  getHostsNeedingRecheck,
  isHostUnseen,
} from './index.js';
import { HOST_REPUTATION } from './host-reputation-config.js';

/**
 * @param {string[]} belowTarget
 * @param {Record<string, number>} targetPerLine
 * @param {Record<string, number>} availablePerLine
 * @param {number} maxTotal
 * @returns {Record<string, number>} slots per gpuLine
 */
export function allocateSlotsByDeficit(belowTarget, targetPerLine, availablePerLine, maxTotal) {
  const budget = Math.max(0, Math.floor(Number(maxTotal) || 0));
  /** @type {Record<string, number>} */
  const alloc = {};
  if (budget <= 0 || !Array.isArray(belowTarget) || belowTarget.length === 0) return alloc;

  const ranked = belowTarget
    .map((line) => ({
      line,
      deficit: Math.max(0, (targetPerLine?.[line] ?? 4) - (availablePerLine?.[line] ?? 0)),
    }))
    .filter((row) => row.deficit > 0)
    .sort((a, b) => {
      if (b.deficit !== a.deficit) return b.deficit - a.deficit;
      return String(a.line).localeCompare(String(b.line));
    });

  for (const row of ranked) alloc[row.line] = 0;

  let remaining = budget;

  // Pass 1: one slot each (fairness), highest deficit first
  for (const row of ranked) {
    if (remaining <= 0) break;
    alloc[row.line] = 1;
    remaining -= 1;
  }

  // Pass 2: fill remaining by deficit, never above line deficit
  while (remaining > 0) {
    let given = false;
    for (const row of ranked) {
      if (remaining <= 0) break;
      if (alloc[row.line] >= row.deficit) continue;
      alloc[row.line] += 1;
      remaining -= 1;
      given = true;
    }
    if (!given) break;
  }

  return alloc;
}

/**
 * Build Discover / Recheck / BadRetry queues for one GPU line.
 * @param {Array<{ hostKey: string; offerId: number|string; gpuLine: string }>} lineCandidates
 * @param {{ staleSampleFraction?: number }} [options]
 * @returns {{ discover: typeof lineCandidates; recheck: typeof lineCandidates; badRetry: typeof lineCandidates }}
 */
function buildLineQueues(lineCandidates, options = {}) {
  const fraction = options.staleSampleFraction ?? HOST_REPUTATION.staleSampleFraction ?? 0.1;
  /** @type {typeof lineCandidates} */
  const discover = [];
  /** @type {typeof lineCandidates} */
  const recheck = [];
  /** @type {typeof lineCandidates} */
  const badRetry = [];

  const staleRecords = getHostsNeedingRecheck().filter((r) =>
    lineCandidates.some((c) => c.hostKey === r.hostKey),
  );
  const sampleSize = staleRecords.length > 0
    ? Math.max(1, Math.ceil(staleRecords.length * fraction))
    : 0;
  const staleKeys = new Set(staleRecords.slice(0, sampleSize).map((r) => r.hostKey));
  const cdKeys = new Set(
    getHostsInCooldownDone()
      .filter((r) => lineCandidates.some((c) => c.hostKey === r.hostKey))
      .map((r) => r.hostKey),
  );

  for (const c of lineCandidates) {
    if (isHostUnseen(c.hostKey)) {
      discover.push(c);
      continue;
    }
    if (staleKeys.has(c.hostKey)) {
      recheck.push(c);
      continue;
    }
    if (cdKeys.has(c.hostKey)) {
      badRetry.push(c);
    }
  }

  return { discover, recheck, badRetry };
}

/**
 * Select hosts to test this cycle, fairly across GPU lines below target.
 *
 * @param {Array<{ hostKey: string; offerId: number|string; gpuLine: string }>} allCandidates
 * @param {number} maxTotal
 * @param {{
 *   belowTarget: string[];
 *   targetPerLine: Record<string, number>;
 *   availablePerLine: Record<string, number>;
 * }} context
 * @returns {Array<{ hostKey: string; offerId: number|string; gpuLine: string; reason: string }>}
 */
export function selectTargetsFair(allCandidates, maxTotal, context) {
  const belowTarget = Array.isArray(context?.belowTarget) ? context.belowTarget : [];
  const targetPerLine = context?.targetPerLine || {};
  const availablePerLine = context?.availablePerLine || {};
  const alloc = allocateSlotsByDeficit(belowTarget, targetPerLine, availablePerLine, maxTotal);

  /** @type {Array<{ hostKey: string; offerId: number|string; gpuLine: string; reason: string }>} */
  const targets = [];
  /** @type {Set<string>} */
  const seen = new Set();

  // Highest deficit first (stable with allocateSlotsByDeficit sort)
  const lines = Object.keys(alloc).sort((a, b) => {
    const defA = Math.max(0, (targetPerLine[a] ?? 4) - (availablePerLine[a] ?? 0));
    const defB = Math.max(0, (targetPerLine[b] ?? 4) - (availablePerLine[b] ?? 0));
    if (defB !== defA) return defB - defA;
    return a.localeCompare(b);
  });

  for (const line of lines) {
    const want = alloc[line] || 0;
    if (want <= 0) continue;
    const lineCandidates = (allCandidates || []).filter((c) => c.gpuLine === line);
    if (!lineCandidates.length) continue;

    const queues = buildLineQueues(lineCandidates);
    const ordered = [
      ...queues.discover.map((c) => ({ c, reason: 'discover' })),
      ...queues.recheck.map((c) => ({ c, reason: 'recheck' })),
      ...queues.badRetry.map((c) => ({ c, reason: 'bad_retry' })),
    ];

    let got = 0;
    for (const row of ordered) {
      if (got >= want) break;
      if (seen.has(row.c.hostKey)) continue;
      seen.add(row.c.hostKey);
      targets.push({ ...row.c, reason: row.reason });
      got += 1;
    }
  }

  // If some lines had no testable hosts, reuse leftover budget for other below-target lines
  if (targets.length < maxTotal) {
    const leftover = maxTotal - targets.length;
    const leftoverCandidates = (allCandidates || []).filter(
      (c) => belowTarget.includes(c.gpuLine) && !seen.has(c.hostKey),
    );
    const queues = buildLineQueues(leftoverCandidates);
    const ordered = [
      ...queues.discover.map((c) => ({ c, reason: 'discover' })),
      ...queues.recheck.map((c) => ({ c, reason: 'recheck' })),
      ...queues.badRetry.map((c) => ({ c, reason: 'bad_retry' })),
    ];
    let got = 0;
    for (const row of ordered) {
      if (got >= leftover) break;
      if (seen.has(row.c.hostKey)) continue;
      seen.add(row.c.hostKey);
      targets.push({ ...row.c, reason: row.reason });
      got += 1;
    }
  }

  return targets;
}
