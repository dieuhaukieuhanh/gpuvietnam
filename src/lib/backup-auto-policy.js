/**
 * Auto-backup policy resolution.
 *
 * Layers (highest priority first):
 * 1. Per-user override: force_on | force_off | null
 * 2. Plan default: Starter / Pro / Studio all on
 *
 * Periodic L1 intervals (outputs / workflows) differ by plan — see
 * `getBackupIntervalsForPlan` / admin `intervals_json` on backup_auto_policy.
 * Models interval unchanged (image default).
 *
 * enabled = userOverride ?? planDefault
 *
 * Global Starter campaign (`starter_auto_backup` window) is legacy and no longer
 * gates enablement (all tiers default on).
 */

import { normalizeBackupPlanKey } from './backup-entitlement.js';

export const AUTO_BACKUP_OVERRIDE = {
  FORCE_ON: 'force_on',
  FORCE_OFF: 'force_off',
};

/** @typedef {'force_on'|'force_off'|null} AutoBackupOverride */
/** @typedef {'starter'|'pro'|'studio'} BackupPlanKey */

/**
 * @typedef {{ outputsSec: number; workflowsSec: number }} BackupPlanIntervals
 */

/**
 * @typedef {{
 *   starterAutoBackup: boolean;
 *   startsAt: string|null;
 *   endsAt: string|null;
 *   note: string|null;
 *   updatedAt: string|null;
 *   updatedBy: string|null;
 *   intervals: Record<BackupPlanKey, BackupPlanIntervals>;
 * }} BackupAutoPolicy
 */

/** Min / max periodic backup interval (seconds). */
export const BACKUP_INTERVAL_SEC_MIN = 30;
export const BACKUP_INTERVAL_SEC_MAX = 24 * 60 * 60;

/** @type {Record<BackupPlanKey, BackupPlanIntervals>} */
export const BACKUP_INTERVALS_BY_PLAN = {
  starter: { outputsSec: 10 * 60, workflowsSec: 20 * 60 },
  pro: { outputsSec: 3 * 60, workflowsSec: 10 * 60 },
  studio: { outputsSec: 60, workflowsSec: 5 * 60 },
};

/** @type {BackupAutoPolicy} */
export const DEFAULT_BACKUP_AUTO_POLICY = {
  starterAutoBackup: false,
  startsAt: null,
  endsAt: null,
  note: null,
  updatedAt: null,
  updatedBy: null,
  intervals: {
    starter: { ...BACKUP_INTERVALS_BY_PLAN.starter },
    pro: { ...BACKUP_INTERVALS_BY_PLAN.pro },
    studio: { ...BACKUP_INTERVALS_BY_PLAN.studio },
  },
};

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function clampBackupIntervalSec(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(
    BACKUP_INTERVAL_SEC_MAX,
    Math.max(BACKUP_INTERVAL_SEC_MIN, Math.floor(n)),
  );
}

/**
 * Merge raw admin JSON with code defaults for all three plans.
 * @param {unknown} raw
 * @returns {Record<BackupPlanKey, BackupPlanIntervals>}
 */
export function mergeBackupIntervalsByPlan(raw) {
  /** @type {Record<BackupPlanKey, BackupPlanIntervals>} */
  const out = {
    starter: { ...BACKUP_INTERVALS_BY_PLAN.starter },
    pro: { ...BACKUP_INTERVALS_BY_PLAN.pro },
    studio: { ...BACKUP_INTERVALS_BY_PLAN.studio },
  };
  if (!raw || typeof raw !== 'object') return out;

  for (const key of /** @type {BackupPlanKey[]} */ (['starter', 'pro', 'studio'])) {
    const row = /** @type {Record<string, unknown>} */ (raw)[key];
    if (!row || typeof row !== 'object') continue;
    const rec = /** @type {Record<string, unknown>} */ (row);
    const defaults = BACKUP_INTERVALS_BY_PLAN[key];
    out[key] = {
      outputsSec: clampBackupIntervalSec(
        rec.outputsSec ?? rec.outputs_sec,
        defaults.outputsSec,
      ),
      workflowsSec: clampBackupIntervalSec(
        rec.workflowsSec ?? rec.workflows_sec,
        defaults.workflowsSec,
      ),
    };
  }
  return out;
}

/**
 * @param {unknown} planKey
 * @param {Partial<Record<BackupPlanKey, BackupPlanIntervals>> | null} [intervalsByPlan]
 * @returns {BackupPlanIntervals}
 */
export function getBackupIntervalsForPlan(planKey, intervalsByPlan = null) {
  const key = /** @type {BackupPlanKey} */ (normalizeBackupPlanKey(planKey) ?? 'starter');
  const merged = mergeBackupIntervalsByPlan(intervalsByPlan);
  return merged[key] ?? merged.starter;
}

/**
 * @param {unknown} value
 * @returns {AutoBackupOverride}
 */
export function normalizeAutoBackupOverride(value) {
  if (value == null) return null;
  const s = String(value).trim().toLowerCase();
  if (s === AUTO_BACKUP_OVERRIDE.FORCE_ON) return AUTO_BACKUP_OVERRIDE.FORCE_ON;
  if (s === AUTO_BACKUP_OVERRIDE.FORCE_OFF) return AUTO_BACKUP_OVERRIDE.FORCE_OFF;
  if (s === '' || s === 'null' || s === 'default' || s === 'follow') return null;
  return null;
}

/**
 * Plan default: Starter / Pro / Studio all on.
 * @param {unknown} planKey
 * @returns {boolean}
 */
export function planDefaultAutoBackup(planKey) {
  const key = normalizeBackupPlanKey(planKey) ?? 'starter';
  return key === 'starter' || key === 'pro' || key === 'studio';
}

/**
 * Global Starter campaign is active only when flag is on and now is inside [startsAt, endsAt]
 * (null bound = open on that side). Legacy — no longer gates enablement.
 *
 * @param {Partial<BackupAutoPolicy>|null|undefined} policy
 * @param {Date|number|string} [now]
 * @returns {boolean}
 */
export function isGlobalStarterAutoBackupActive(policy, now = Date.now()) {
  if (!policy || !policy.starterAutoBackup) return false;
  const t = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(t)) return false;

  if (policy.startsAt) {
    const start = new Date(policy.startsAt).getTime();
    if (Number.isFinite(start) && t < start) return false;
  }
  if (policy.endsAt) {
    const end = new Date(policy.endsAt).getTime();
    if (Number.isFinite(end) && t > end) return false;
  }
  return true;
}

/**
 * Pure resolver.
 *
 * @param {{
 *   planKey?: unknown;
 *   userOverride?: unknown;
 *   globalStarterPolicy?: Partial<BackupAutoPolicy>|null;
 *   now?: Date|number|string;
 * }} input
 * @returns {{
 *   enabled: boolean;
 *   planKey: BackupPlanKey;
 *   override: AutoBackupOverride;
 *   source: 'force_on'|'force_off'|'plan_default';
 * }}
 */
export function resolveAutoBackupEnabled(input = {}) {
  const planKey = /** @type {BackupPlanKey} */ (
    normalizeBackupPlanKey(input.planKey) ?? 'starter'
  );
  const override = normalizeAutoBackupOverride(input.userOverride);

  if (override === AUTO_BACKUP_OVERRIDE.FORCE_ON) {
    return { enabled: true, planKey, override, source: 'force_on' };
  }
  if (override === AUTO_BACKUP_OVERRIDE.FORCE_OFF) {
    return { enabled: false, planKey, override, source: 'force_off' };
  }

  const planOn = planDefaultAutoBackup(planKey);
  return {
    enabled: planOn,
    planKey,
    override: null,
    source: 'plan_default',
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {BackupAutoPolicy}
 */
export function normalizeBackupAutoPolicyRow(row) {
  if (!row || typeof row !== 'object') {
    return { ...DEFAULT_BACKUP_AUTO_POLICY, intervals: mergeBackupIntervalsByPlan(null) };
  }
  return {
    starterAutoBackup: Boolean(row.starter_auto_backup ?? row.starterAutoBackup),
    startsAt: row.starts_at != null ? String(row.starts_at) : row.startsAt != null ? String(row.startsAt) : null,
    endsAt: row.ends_at != null ? String(row.ends_at) : row.endsAt != null ? String(row.endsAt) : null,
    note: row.note != null && String(row.note).trim() ? String(row.note).trim() : null,
    updatedAt: row.updated_at != null ? String(row.updated_at) : row.updatedAt != null ? String(row.updatedAt) : null,
    updatedBy: row.updated_by != null ? String(row.updated_by) : row.updatedBy != null ? String(row.updatedBy) : null,
    intervals: mergeBackupIntervalsByPlan(row.intervals_json ?? row.intervals),
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @returns {Promise<BackupAutoPolicy>}
 */
export async function loadBackupAutoPolicy(supabaseAdmin) {
  try {
    const { data, error } = await supabaseAdmin
      .from('backup_auto_policy')
      .select('id, starter_auto_backup, starts_at, ends_at, note, updated_at, updated_by, intervals_json')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      if (/does not exist|schema cache|Could not find/i.test(error.message || '')) {
        if (/intervals_json/i.test(error.message || '')) {
          const legacy = await supabaseAdmin
            .from('backup_auto_policy')
            .select('id, starter_auto_backup, starts_at, ends_at, note, updated_at, updated_by')
            .eq('id', 1)
            .maybeSingle();
          if (!legacy.error) return normalizeBackupAutoPolicyRow(legacy.data);
        }
        console.warn('[backup-auto-policy] table missing — using defaults');
        return { ...DEFAULT_BACKUP_AUTO_POLICY, intervals: mergeBackupIntervalsByPlan(null) };
      }
      console.warn('[backup-auto-policy] load failed:', error.message);
      return { ...DEFAULT_BACKUP_AUTO_POLICY, intervals: mergeBackupIntervalsByPlan(null) };
    }

    return normalizeBackupAutoPolicyRow(data);
  } catch (err) {
    console.warn(
      '[backup-auto-policy] load error:',
      err instanceof Error ? err.message : err,
    );
    return { ...DEFAULT_BACKUP_AUTO_POLICY, intervals: mergeBackupIntervalsByPlan(null) };
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @returns {Promise<Record<BackupPlanKey, BackupPlanIntervals>>}
 */
export async function loadBackupIntervalsByPlan(supabaseAdmin) {
  const policy = await loadBackupAutoPolicy(supabaseAdmin);
  return policy.intervals;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   starterAutoBackup?: boolean;
 *   startsAt?: string|null;
 *   endsAt?: string|null;
 *   note?: string|null;
 *   updatedBy?: string|null;
 *   intervals?: unknown;
 * }} patch
 * @returns {Promise<BackupAutoPolicy>}
 */
export async function saveBackupAutoPolicy(supabaseAdmin, patch = {}) {
  /** @type {Record<string, unknown>} */
  const updates = {};

  if (patch.starterAutoBackup !== undefined) {
    updates.starter_auto_backup = Boolean(patch.starterAutoBackup);
  }
  if (patch.startsAt !== undefined) {
    updates.starts_at = patch.startsAt ? String(patch.startsAt) : null;
  }
  if (patch.endsAt !== undefined) {
    updates.ends_at = patch.endsAt ? String(patch.endsAt) : null;
  }
  if (patch.note !== undefined) {
    updates.note = patch.note != null && String(patch.note).trim() ? String(patch.note).trim() : null;
  }
  if (patch.updatedBy !== undefined) {
    updates.updated_by = patch.updatedBy || null;
  }
  if (patch.intervals !== undefined) {
    updates.intervals_json = mergeBackupIntervalsByPlan(patch.intervals);
  }

  if (Object.keys(updates).length === 0) {
    return loadBackupAutoPolicy(supabaseAdmin);
  }

  const { data, error } = await supabaseAdmin
    .from('backup_auto_policy')
    .upsert({ id: 1, ...updates }, { onConflict: 'id' })
    .select('id, starter_auto_backup, starts_at, ends_at, note, updated_at, updated_by, intervals_json')
    .single();

  if (error) {
    if (/intervals_json/i.test(error.message || '')) {
      throw new Error(
        'Cột intervals_json chưa có — chạy migration supabase/backup-auto-policy-intervals.sql',
      );
    }
    throw error;
  }
  return normalizeBackupAutoPolicyRow(data);
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {unknown} [planKeyHint]
 * @returns {Promise<{
 *   enabled: boolean;
 *   planKey: BackupPlanKey;
 *   override: AutoBackupOverride;
 *   source: string;
 *   policy: BackupAutoPolicy;
 * }>}
 */
export async function resolveUserAutoBackupContext(supabaseAdmin, userId, planKeyHint = null) {
  const policy = await loadBackupAutoPolicy(supabaseAdmin);

  let override = /** @type {AutoBackupOverride} */ (null);
  let entitledPlan = null;

  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('auto_backup_override, backup_entitled_plan')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      if (!/does not exist|schema cache|Could not find/i.test(error.message || '')) {
        console.warn('[backup-auto-policy] user load failed:', error.message);
      }
    } else if (data) {
      override = normalizeAutoBackupOverride(data.auto_backup_override);
      entitledPlan = data.backup_entitled_plan ?? null;
    }
  } catch (err) {
    console.warn(
      '[backup-auto-policy] user load error:',
      err instanceof Error ? err.message : err,
    );
  }

  const resolved = resolveAutoBackupEnabled({
    planKey: planKeyHint ?? entitledPlan,
    userOverride: override,
    globalStarterPolicy: policy,
  });

  return { ...resolved, policy };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {unknown} [planKeyHint]
 * @returns {Promise<boolean>}
 */
export async function isAutoBackupEnabledForUser(supabaseAdmin, userId, planKeyHint = null) {
  const ctx = await resolveUserAutoBackupContext(supabaseAdmin, userId, planKeyHint);
  return ctx.enabled;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {unknown} override
 * @returns {Promise<AutoBackupOverride>}
 */
export async function setUserAutoBackupOverride(supabaseAdmin, userId, override) {
  const normalized = normalizeAutoBackupOverride(override);
  const { error } = await supabaseAdmin
    .from('users')
    .update({ auto_backup_override: normalized })
    .eq('id', userId);

  if (error) throw error;
  return normalized;
}
