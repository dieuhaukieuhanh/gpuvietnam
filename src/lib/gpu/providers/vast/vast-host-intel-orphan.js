/**
 * Vast Host Intelligence orphan sweeper — cancel leftover probe instances.
 *
 * Scope: label = gpuvietnam-host-intel only (ops probes, never customer sessions).
 */

import { randomUUID } from 'node:crypto';
import { opsAlertAsync } from '../../../ops/alert-dispatcher.js';
import { logger } from '../../../logging/index.js';
import { HOST_INTEL_VAST_LABEL } from '../../host-reputation/host-intel-runtime.js';

export const DEFAULT_VAST_HOST_INTEL_ORPHAN_GRACE_MS = 10 * 60 * 1000;

export function resolveVastHostIntelOrphanGraceMs() {
  const raw = Number(
    process.env.VAST_HOST_INTEL_ORPHAN_GRACE_MS ?? DEFAULT_VAST_HOST_INTEL_ORPHAN_GRACE_MS,
  );
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_VAST_HOST_INTEL_ORPHAN_GRACE_MS;
}

/**
 * @param {Record<string, unknown>} row
 * @returns {{ id: string; label: string; startMs: number; status: string } | null}
 */
export function normalizeVastHostIntelInstance(row) {
  if (!row || typeof row !== 'object') return null;
  const id = row.id != null ? String(row.id).trim() : '';
  if (!id) return null;
  const label = row.label != null ? String(row.label).trim() : '';
  let startMs = 0;
  const startDate = Number(row.start_date ?? row.startDate ?? 0);
  // Vast uses unix seconds; some payloads use ms. Values ≤1e12 treated as seconds.
  if (Number.isFinite(startDate) && startDate > 0) {
    startMs = startDate > 1e12 ? startDate : startDate * 1000;
  }
  const status = String(row.actual_status ?? row.cur_state ?? '').toLowerCase();
  return { id, label, startMs, status };
}

/**
 * @param {Array<ReturnType<typeof normalizeVastHostIntelInstance>>} instances
 * @param {{ nowMs?: number; graceMs?: number; label?: string }} [options]
 */
export function classifyVastHostIntelOrphans(instances, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const graceMs = options.graceMs ?? resolveVastHostIntelOrphanGraceMs();
  const label = options.label ?? HOST_INTEL_VAST_LABEL;
  /** @type {Array<{ id: string; ageMs: number; status: string; action: 'wait'|'destroy'; reason: string }>} */
  const out = [];

  for (const inst of instances) {
    if (!inst) continue;
    if (inst.label !== label) continue;
    const ageMs = inst.startMs > 0 ? Math.max(0, nowMs - inst.startMs) : Number.POSITIVE_INFINITY;
    if (ageMs < graceMs) {
      out.push({
        id: inst.id,
        ageMs: Number.isFinite(ageMs) ? ageMs : -1,
        status: inst.status,
        action: 'wait',
        reason: 'grace_period',
      });
      continue;
    }
    out.push({
      id: inst.id,
      ageMs: Number.isFinite(ageMs) ? ageMs : -1,
      status: inst.status,
      action: 'destroy',
      reason: 'past_grace',
    });
  }
  return out;
}

/**
 * @param {{
 *   vastClient: { listInstancesByLabel: (label: string) => Promise<Record<string, unknown>[]>; destroyInstance: (id: string) => Promise<unknown> };
 *   graceMs?: number;
 *   requestId?: string;
 *   nowMs?: number;
 * }} deps
 */
export async function runVastHostIntelOrphanPass(deps) {
  const requestId = deps.requestId || randomUUID();
  const graceMs = deps.graceMs ?? resolveVastHostIntelOrphanGraceMs();
  const nowMs = deps.nowMs ?? Date.now();
  const log = logger('provider');

  const rows = await deps.vastClient.listInstancesByLabel(HOST_INTEL_VAST_LABEL);
  const normalized = rows.map((r) => normalizeVastHostIntelInstance(r)).filter(Boolean);
  const decisions = classifyVastHostIntelOrphans(normalized, { nowMs, graceMs });

  /** @type {Array<{ id: string; action: string; reason: string; ok?: boolean; error?: string }>} */
  const actions = [];

  for (const d of decisions) {
    if (d.action === 'wait') {
      actions.push({ id: d.id, action: 'wait', reason: d.reason });
      continue;
    }

    opsAlertAsync({
      event: 'orphan_host_intel',
      severity: 'critical',
      title: `Vast host-intel orphan ${d.id}`,
      details: {
        instanceId: d.id,
        ageMs: d.ageMs,
        status: d.status,
        graceMs,
        requestId,
      },
      dedupeKey: `orphan_host_intel:vast:${d.id}`,
    });

    try {
      await deps.vastClient.destroyInstance(d.id);
      actions.push({ id: d.id, action: 'destroy', reason: d.reason, ok: true });
      log.info(
        {
          operation: 'vast.host_intel_orphan',
          event: 'ORPHAN_DESTROYED',
          instanceId: d.id,
          ageMs: d.ageMs,
          requestId,
        },
        'Destroyed Vast host-intel orphan instance',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      actions.push({ id: d.id, action: 'destroy', reason: d.reason, ok: false, error: message });
      log.error(
        {
          operation: 'vast.host_intel_orphan',
          event: 'ORPHAN_DESTROY_FAILED',
          instanceId: d.id,
          requestId,
          err: { message },
        },
        'Failed to destroy Vast host-intel orphan',
      );
    }
  }

  return {
    requestId,
    label: HOST_INTEL_VAST_LABEL,
    listed: normalized.length,
    graceMs,
    destroyCandidates: decisions.filter((d) => d.action === 'destroy').length,
    actions,
  };
}
