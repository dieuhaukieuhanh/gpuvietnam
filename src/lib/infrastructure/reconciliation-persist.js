/**
 * M14 — Persist reconciliation runs and drift items (schema: infrastructure-reconciliation.sql).
 * Wiring only — no detection/repair logic.
 */

import { RECONCILIATION_MODULE_VERSION, REPAIR_OUTCOME } from './reconciliation-core.js';

/**
 * @param {string} outcome
 */
function mapRepairOutcomeToStatus(outcome) {
  if (outcome === REPAIR_OUTCOME.REPAIRED) return 'repaired';
  if (outcome === REPAIR_OUTCOME.ALREADY_CONSISTENT) return 'already_consistent';
  if (outcome === REPAIR_OUTCOME.FAILED) return 'failed';
  return 'skipped';
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {Record<string, unknown>} result
 */
export async function persistReconciliationRun(supabaseAdmin, result) {
  try {
    const completedAt = new Date().toISOString();
    const { data: run, error: runError } = await supabaseAdmin
      .from('reconciliation_runs')
      .insert({
        started_at: result.startedAt ?? completedAt,
        completed_at: completedAt,
        repair: Boolean(result.repair),
        drift_count: Number(result.driftCount ?? 0),
        repaired_count: Number(result.counts?.repaired ?? 0),
        skipped_count: Number(result.counts?.skipped ?? 0),
        failed_count: Number(result.counts?.failed ?? 0),
        already_consistent_count: Number(result.counts?.already_consistent ?? 0),
        module_version: result.moduleVersion ?? RECONCILIATION_MODULE_VERSION,
        metadata: {
          repairs: (result.repairs ?? []).map((row) => ({
            driftType: row.drift?.driftType,
            entityId: row.drift?.entityId,
            outcome: row.outcome,
            reason: row.reason ?? null,
          })),
        },
      })
      .select('id')
      .single();

    if (runError) {
      console.warn('[reconciliation-persist] run insert failed:', runError.message);
      return null;
    }

    const runId = run?.id ? String(run.id) : null;
    if (!runId) return null;

    const drifts = Array.isArray(result.drifts) ? result.drifts : [];
    const repairs = Array.isArray(result.repairs) ? result.repairs : [];
    const repairByKey = new Map(
      repairs.map((row) => [
        `${row.drift?.driftType}:${row.drift?.entityType}:${row.drift?.entityId}`,
        row,
      ]),
    );

    if (drifts.length > 0) {
      const rows = drifts.map((drift) => {
        const key = `${drift.driftType}:${drift.entityType}:${drift.entityId}`;
        const repair = repairByKey.get(key);
        const status = repair?.outcome
          ? mapRepairOutcomeToStatus(String(repair.outcome))
          : 'open';
        return {
          run_id: runId,
          drift_type: drift.driftType,
          entity_type: drift.entityType,
          entity_id: drift.entityId,
          user_id: drift.details?.userId ?? null,
          machine_id: drift.details?.machineId ?? null,
          instance_id: drift.details?.instanceId ?? null,
          status,
          message: drift.message,
          details: drift.details ?? null,
          resolved_at: repair ? completedAt : null,
        };
      });

      const { error: driftError } = await supabaseAdmin.from('drift_items').insert(rows);
      if (driftError) {
        console.warn('[reconciliation-persist] drift insert failed:', driftError.message);
      }
    }

    return runId;
  } catch (error) {
    console.warn('[reconciliation-persist] unexpected error:', error);
    return null;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ limit?: number }} [options]
 */
export async function fetchReconciliationRuns(supabaseAdmin, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
  const { data, error } = await supabaseAdmin
    .from('reconciliation_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[reconciliation-persist] fetch runs failed:', error.message);
    return [];
  }
  return data ?? [];
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ runId?: string; limit?: number; status?: string }} [options]
 */
export async function fetchDriftItems(supabaseAdmin, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  let query = supabaseAdmin
    .from('drift_items')
    .select('*')
    .order('detected_at', { ascending: false })
    .limit(limit);

  if (options.runId) {
    query = query.eq('run_id', options.runId);
  }
  if (options.status) {
    query = query.eq('status', options.status);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[reconciliation-persist] fetch drifts failed:', error.message);
    return [];
  }
  return data ?? [];
}
