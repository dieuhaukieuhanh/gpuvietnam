/**
 * Append-only provision attempt journal (JSONL under tmp/).
 * Used to decide Clore vs Vast from real funnel data — not a dashboard product.
 *
 * Fields per line: provider, hostId, offerId, instanceId, gpuLine, rentOk,
 * httpPub, httpEndpointOk, systemStatsOk, promptSmokeOk, sshOk, opsDegraded,
 * finalStatus, failStep, failReason, failCategory, timingsMs, at.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PROVISION_JOURNAL_REL = 'tmp/provision-journal.jsonl';

/**
 * @returns {string}
 */
export function resolveProvisionJournalPath() {
  const fromEnv = String(process.env.PROVISION_JOURNAL_PATH ?? '').trim();
  if (fromEnv) return fromEnv;
  return join(process.cwd(), PROVISION_JOURNAL_REL);
}

/**
 * @param {Array<{ step?: string; ok?: boolean; detail?: string; elapsedMs?: number }> | null | undefined} steps
 */
export function extractGateStepFlags(steps) {
  const list = Array.isArray(steps) ? steps : [];
  /** @type {Record<string, { ok: boolean; detail?: string; elapsedMs?: number }>} */
  const byStep = {};
  for (const s of list) {
    const step = String(s?.step ?? '').trim();
    if (!step) continue;
    byStep[step] = {
      ok: Boolean(s.ok),
      detail: s.detail != null ? String(s.detail) : undefined,
      elapsedMs: Number(s.elapsedMs) >= 0 ? Number(s.elapsedMs) : undefined,
    };
  }
  const httpEndpointOk = byStep.http_endpoint?.ok === true || byStep.port?.ok === true;
  const systemStatsOk = byStep.gpu_stats?.ok === true;
  const promptSmokeOk = byStep.comfy_smoke?.ok === true || byStep.comfy_workflow?.ok === true;
  const sshOk = byStep.ssh_exec?.ok === true;
  /** @type {Record<string, number>} */
  const timingsMs = {};
  for (const [k, v] of Object.entries(byStep)) {
    if (v.elapsedMs != null) timingsMs[k] = v.elapsedMs;
  }
  return { httpEndpointOk, systemStatsOk, promptSmokeOk, sshOk, timingsMs, byStep };
}

/**
 * @param {{
 *   provider: string;
 *   hostId?: string | null;
 *   offerId?: string | number | null;
 *   instanceId?: string | number | null;
 *   gpuLine?: string | null;
 *   plan?: string | null;
 *   region?: string | null;
 *   rentOk: boolean;
 *   httpPub?: boolean | null;
 *   gateOk?: boolean | null;
 *   gateStep?: string | null;
 *   gateDetail?: string | null;
 *   gateSteps?: Array<{ step?: string; ok?: boolean; detail?: string; elapsedMs?: number }> | null;
 *   ops?: { ssh_ok?: boolean; ops_degraded?: boolean; ssh_detail?: string | null } | null;
 *   failCategory?: string | null;
 *   rentedAtMs?: number | null;
 *   finishedAtMs?: number | null;
 *   requestId?: string | null;
 *   source?: string | null;
 * }} input
 */
export function buildProvisionJournalEntry(input) {
  const finishedAtMs = Number(input.finishedAtMs) > 0 ? Number(input.finishedAtMs) : Date.now();
  const rentedAtMs = Number(input.rentedAtMs) > 0 ? Number(input.rentedAtMs) : null;
  const flags = extractGateStepFlags(input.gateSteps);
  const gateOk = input.gateOk === true;
  const rentOk = input.rentOk === true;
  const finalStatus = rentOk && gateOk ? 'RUNNING' : 'FAILED';

  let failStep = null;
  let failReason = null;
  if (!rentOk) {
    failStep = 'rent';
    failReason = input.gateDetail != null ? String(input.gateDetail).slice(0, 400) : 'rent failed';
  } else if (!gateOk) {
    failStep = input.gateStep != null ? String(input.gateStep) : 'gate';
    failReason = input.gateDetail != null ? String(input.gateDetail).slice(0, 400) : 'gate failed';
  }

  const sshOk =
    input.ops && typeof input.ops.ssh_ok === 'boolean' ? input.ops.ssh_ok : flags.sshOk;
  const opsDegraded =
    input.ops && typeof input.ops.ops_degraded === 'boolean'
      ? input.ops.ops_degraded
      : rentOk && gateOk && sshOk === false;

  return {
    at: new Date(finishedAtMs).toISOString(),
    provider: String(input.provider || 'unknown'),
    hostId: input.hostId != null ? String(input.hostId) : null,
    offerId: input.offerId != null ? String(input.offerId) : null,
    instanceId: input.instanceId != null ? String(input.instanceId) : null,
    gpuLine: input.gpuLine != null ? String(input.gpuLine) : null,
    plan: input.plan != null ? String(input.plan) : null,
    region: input.region != null ? String(input.region) : null,
    requestId: input.requestId != null ? String(input.requestId) : null,
    source: input.source != null ? String(input.source) : null,
    rentOk,
    httpPub: input.httpPub == null ? null : Boolean(input.httpPub),
    httpEndpointOk: rentOk ? flags.httpEndpointOk : false,
    systemStatsOk: rentOk ? flags.systemStatsOk : false,
    promptSmokeOk: rentOk ? flags.promptSmokeOk : false,
    sshOk: rentOk ? sshOk : null,
    opsDegraded: rentOk && gateOk ? Boolean(opsDegraded) : false,
    finalStatus,
    failStep,
    failReason,
    failCategory: input.failCategory != null ? String(input.failCategory) : failStep,
    timingsMs: {
      ...flags.timingsMs,
      ...(rentedAtMs != null ? { rentToFinishMs: Math.max(0, finishedAtMs - rentedAtMs) } : {}),
    },
  };
}

/**
 * @param {Record<string, unknown>} entry
 * @param {{ path?: string }} [options]
 */
export function appendProvisionJournal(entry, options = {}) {
  const file = options.path || resolveProvisionJournalPath();
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    console.warn(
      '[provision-journal] append failed:',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * @param {string} [filePath]
 * @returns {Record<string, unknown>[]}
 */
export function readProvisionJournal(filePath) {
  const file = filePath || resolveProvisionJournalPath();
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  /** @type {Record<string, unknown>[]} */
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object') rows.push(/** @type {Record<string, unknown>} */ (obj));
    } catch {
      /* skip bad line */
    }
  }
  return rows;
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {{ provider?: string | null }} [filter]
 */
export function summarizeProvisionJournal(rows, filter = {}) {
  const providerFilter = filter.provider != null ? String(filter.provider).toLowerCase() : null;
  const list = rows.filter((r) => {
    if (!providerFilter) return true;
    return String(r.provider ?? '').toLowerCase() === providerFilter;
  });
  const n = list.length;
  const pct = (count) => (n > 0 ? Math.round((count / n) * 1000) / 10 : 0);

  let rentOk = 0;
  let httpPub = 0;
  let httpEndpointOk = 0;
  let systemStatsOk = 0;
  let promptSmokeOk = 0;
  let running = 0;
  /** @type {number[]} */
  const toRunningMs = [];
  /** @type {Record<string, number>} */
  const failByStep = {};
  /** @type {Record<string, number>} */
  const failByCategory = {};

  for (const r of list) {
    if (r.rentOk === true) rentOk += 1;
    if (r.httpPub === true) httpPub += 1;
    if (r.httpEndpointOk === true) httpEndpointOk += 1;
    if (r.systemStatsOk === true) systemStatsOk += 1;
    if (r.promptSmokeOk === true) promptSmokeOk += 1;
    if (r.finalStatus === 'RUNNING') {
      running += 1;
      const ms = Number(
        r.timingsMs && typeof r.timingsMs === 'object'
          ? /** @type {Record<string, unknown>} */ (r.timingsMs).rentToFinishMs
          : NaN,
      );
      if (Number.isFinite(ms) && ms >= 0) toRunningMs.push(ms);
    }
    if (r.finalStatus === 'FAILED') {
      const step = String(r.failStep || 'unknown');
      failByStep[step] = (failByStep[step] || 0) + 1;
      const cat = String(r.failCategory || step);
      failByCategory[cat] = (failByCategory[cat] || 0) + 1;
    }
  }

  const avg = (arr) =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  return {
    total: n,
    provider: providerFilter,
    funnel: {
      rentOk: { count: rentOk, pct: pct(rentOk) },
      httpPub: { count: httpPub, pct: pct(httpPub) },
      httpEndpointOk: { count: httpEndpointOk, pct: pct(httpEndpointOk) },
      systemStatsOk: { count: systemStatsOk, pct: pct(systemStatsOk) },
      promptSmokeOk: { count: promptSmokeOk, pct: pct(promptSmokeOk) },
      running: { count: running, pct: pct(running) },
    },
    avgRentToRunningMs: avg(toRunningMs),
    failByStep,
    failByCategory,
  };
}
