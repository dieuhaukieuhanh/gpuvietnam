/**
 * Backup entitlement (GPU plan -> GB) + retention (ACTIVE -> GRACE -> DELETED).
 * Effective limit: max(planTierGb, backup_upgrade_gb), default Starter floor when both 0.
 */

import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { listUserBackupR2Objects } from './backup-reconcile.js';
import { getR2Client, isR2Configured } from './r2-client.js';

export const BACKUP_RETENTION_STATE = {
  ACTIVE: 'active',
  GRACE: 'grace',
  DELETED: 'deleted',
};

/** @type {Record<'starter'|'pro'|'studio', { planGb: number; retentionDays: number; rank: number }>} */
export const BACKUP_PLAN_ENTITLEMENTS = {
  starter: { planGb: 100, retentionDays: 30, rank: 1 },
  pro: { planGb: 150, retentionDays: 90, rank: 2 },
  studio: { planGb: 200, retentionDays: 120, rank: 3 },
};

export const DEFAULT_BACKUP_PLAN_GB = BACKUP_PLAN_ENTITLEMENTS.starter.planGb;

/**
 * @param {unknown} value
 * @returns {'starter'|'pro'|'studio'|null}
 */
export function normalizeBackupPlanKey(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'starter' || lower === 'pro' || lower === 'studio') return lower;
  if (trimmed === 'Starter') return 'starter';
  if (trimmed === 'Pro') return 'pro';
  if (trimmed === 'Studio') return 'studio';
  if (/\bstudio\b/i.test(trimmed)) return 'studio';
  if (/\bstarter\b/i.test(trimmed)) return 'starter';
  if (/\bpro\b/i.test(trimmed)) return 'pro';
  return null;
}

/**
 * @param {Iterable<unknown>} planKeysOrNames
 * @returns {'starter'|'pro'|'studio'|null}
 */
export function resolveMaxBackupPlanKey(planKeysOrNames) {
  let best = null;
  let bestRank = 0;
  for (const raw of planKeysOrNames ?? []) {
    const key = normalizeBackupPlanKey(raw);
    if (!key) continue;
    const rank = BACKUP_PLAN_ENTITLEMENTS[key].rank;
    if (rank > bestRank) {
      best = key;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * @param {'starter'|'pro'|'studio'|null|undefined} planKey
 */
export function getBackupEntitlementForPlan(planKey) {
  const key = normalizeBackupPlanKey(planKey);
  if (!key) {
    return {
      planKey: null,
      planGb: 0,
      retentionDays: BACKUP_PLAN_ENTITLEMENTS.starter.retentionDays,
    };
  }
  const row = BACKUP_PLAN_ENTITLEMENTS[key];
  return { planKey: key, planGb: row.planGb, retentionDays: row.retentionDays };
}

/**
 * @param {number} entitledGb
 * @param {number} upgradeGb
 */
export function resolveEffectiveBackupPlanGb(entitledGb, upgradeGb) {
  const entitled = Math.max(0, Math.floor(Number(entitledGb) || 0));
  const upgrade = Math.max(0, Math.floor(Number(upgradeGb) || 0));
  const effective = Math.max(entitled, upgrade);
  return effective > 0 ? effective : DEFAULT_BACKUP_PLAN_GB;
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ nowMs?: number; walletBalance?: number }} [opts]
 */
export function isInventoryRowGivingCapacity(row, opts = {}) {
  if (!row || row.status !== 'active') return false;
  const nowMs = opts.nowMs ?? Date.now();
  if (row.valid_until && new Date(String(row.valid_until)).getTime() <= nowMs) return false;

  const hours = Number(row.hours_remaining ?? 0);
  if (hours > 0) return true;

  if (row.plan_type === 'hourly') {
    const wallet = Number(opts.walletBalance ?? 0);
    return wallet > 0 || hours > 0;
  }

  return false;
}

/**
 * Pure decision for sync (unit-tested).
 * @param {{
 *   inventoryRows: Array<Record<string, unknown>>;
 *   walletBalance?: number;
 *   upgradeGb?: number;
 *   currentState?: string;
 *   graceStartedAt?: string|null;
 *   purgeAfter?: string|null;
 *   previousEntitledPlan?: string|null;
 *   nowMs?: number;
 * }} input
 */
export function computeBackupEntitlementSync(input) {
  const nowMs = input.nowMs ?? Date.now();
  const walletBalance = Number(input.walletBalance ?? 0);
  const upgradeGb = Math.max(0, Math.floor(Number(input.upgradeGb) || 0));
  const rows = Array.isArray(input.inventoryRows) ? input.inventoryRows : [];

  const capacityRows = rows.filter((row) =>
    isInventoryRowGivingCapacity(row, { nowMs, walletBalance }),
  );
  const hasCapacity = capacityRows.length > 0;

  const capacityPlanKey = resolveMaxBackupPlanKey(
    capacityRows.map((row) => row.plan_name ?? row.planName),
  );
  const anyPlanKey = resolveMaxBackupPlanKey(rows.map((row) => row.plan_name ?? row.planName));
  const previousKey = normalizeBackupPlanKey(input.previousEntitledPlan);

  /** @type {'starter'|'pro'|'studio'|null} */
  let entitledPlanKey = null;
  if (hasCapacity) {
    entitledPlanKey = capacityPlanKey ?? previousKey ?? anyPlanKey ?? 'starter';
  } else {
    entitledPlanKey = previousKey ?? anyPlanKey ?? 'starter';
  }

  const entitlement = getBackupEntitlementForPlan(entitledPlanKey);
  const planGb = resolveEffectiveBackupPlanGb(entitlement.planGb, upgradeGb);

  /** @type {'active'|'grace'|'deleted'} */
  let state =
    input.currentState === BACKUP_RETENTION_STATE.DELETED
      ? BACKUP_RETENTION_STATE.DELETED
      : input.currentState === BACKUP_RETENTION_STATE.GRACE
        ? BACKUP_RETENTION_STATE.GRACE
        : BACKUP_RETENTION_STATE.ACTIVE;

  let graceStartedAt = input.graceStartedAt ?? null;
  let purgeAfter = input.purgeAfter ?? null;

  if (hasCapacity) {
    state = BACKUP_RETENTION_STATE.ACTIVE;
    graceStartedAt = null;
    purgeAfter = null;
  } else if (state === BACKUP_RETENTION_STATE.DELETED) {
    // Stay deleted until capacity returns (purchase restores ACTIVE above).
  } else {
    state = BACKUP_RETENTION_STATE.GRACE;
    if (!graceStartedAt) {
      graceStartedAt = new Date(nowMs).toISOString();
    }
    const startMs = new Date(graceStartedAt).getTime();
    const deadlineMs = startMs + entitlement.retentionDays * 24 * 60 * 60 * 1000;
    purgeAfter = new Date(deadlineMs).toISOString();
  }

  return {
    hasCapacity,
    entitledPlanKey: entitlement.planKey,
    retentionDays: entitlement.retentionDays,
    planGb,
    upgradeGb,
    state,
    graceStartedAt,
    purgeAfter,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function syncUserBackupEntitlement(supabaseAdmin, userId) {
  const uid = String(userId ?? '').trim();
  if (!uid) throw new Error('Missing userId');

  const [{ data: profile, error: profileError }, { data: inventory, error: invError }] =
    await Promise.all([
      supabaseAdmin
        .from('users')
        .select(
          'wallet_balance, backup_upgrade_gb, backup_plan_gb, backup_retention_state, backup_grace_started_at, backup_purge_after, backup_entitled_plan',
        )
        .eq('id', uid)
        .maybeSingle(),
      supabaseAdmin
        .from('user_plan_inventory')
        .select('plan_name, plan_type, status, hours_remaining, valid_until')
        .eq('user_id', uid),
    ]);

  if (profileError) throw profileError;
  if (invError) throw invError;
  if (!profile) {
    return { ok: false, reason: 'user_not_found' };
  }

  const decision = computeBackupEntitlementSync({
    inventoryRows: inventory ?? [],
    walletBalance: Number(profile.wallet_balance ?? 0),
    upgradeGb: Number(profile.backup_upgrade_gb ?? 0),
    currentState: String(profile.backup_retention_state ?? BACKUP_RETENTION_STATE.ACTIVE),
    graceStartedAt: profile.backup_grace_started_at ?? null,
    purgeAfter: profile.backup_purge_after ?? null,
    previousEntitledPlan: profile.backup_entitled_plan ?? null,
  });

  const patch = {
    backup_plan_gb: decision.planGb,
    backup_entitled_plan: decision.entitledPlanKey,
    backup_retention_state: decision.state,
    backup_grace_started_at: decision.graceStartedAt,
    backup_purge_after: decision.purgeAfter,
    updated_at: new Date().toISOString(),
  };

  const unchanged =
    Number(profile.backup_plan_gb ?? 0) === decision.planGb &&
    String(profile.backup_entitled_plan ?? '') === String(decision.entitledPlanKey ?? '') &&
    String(profile.backup_retention_state ?? '') === decision.state &&
    String(profile.backup_grace_started_at ?? '') === String(decision.graceStartedAt ?? '') &&
    String(profile.backup_purge_after ?? '') === String(decision.purgeAfter ?? '');

  if (!unchanged) {
    const { error: updateError } = await supabaseAdmin.from('users').update(patch).eq('id', uid);
    if (updateError) throw updateError;
  }

  return { ok: true, changed: !unchanged, ...decision };
}

/**
 * Delete all backup objects under users/{userId}/ on R2.
 * @param {string} userId
 */
export async function deleteUserBackupR2Prefix(userId) {
  if (!isR2Configured()) {
    throw new Error('R2 is not configured');
  }
  const client = getR2Client();
  if (!client) throw new Error('R2 is not configured');

  let deleted = 0;
  let listed = 0;
  for (let page = 0; page < 50; page += 1) {
    const objects = await listUserBackupR2Objects(userId, { maxKeys: 5000 });
    if (!objects.length) break;
    listed += objects.length;

    for (let i = 0; i < objects.length; i += 1000) {
      const chunk = objects.slice(i, i + 1000);
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Delete: {
            Objects: chunk.map((o) => ({ Key: o.r2Key })),
            Quiet: true,
          },
        }),
      );
      deleted += chunk.length - (result.Errors?.length ?? 0);
      if (result.Errors?.length) {
        const first = result.Errors[0];
        throw new Error(
          'R2 delete failed for ' + first.Key + ': ' + (first.Code ?? '') + ' ' + (first.Message ?? ''),
        );
      }
    }
  }

  return { deleted, listed };
}

/**
 * Purge one user past grace: R2 + catalog -> state deleted.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function purgeUserBackupRetention(supabaseAdmin, userId) {
  const uid = String(userId ?? '').trim();
  if (!uid) throw new Error('Missing userId');

  let r2 = { deleted: 0, listed: 0 };
  if (isR2Configured()) {
    r2 = await deleteUserBackupR2Prefix(uid);
  }

  const { error: catalogError, count } = await supabaseAdmin
    .from('storage_files')
    .delete({ count: 'exact' })
    .eq('user_id', uid)
    .eq('storage_type', 'backup');

  if (catalogError) throw catalogError;

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({
      backup_retention_state: BACKUP_RETENTION_STATE.DELETED,
      backup_grace_started_at: null,
      backup_purge_after: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', uid);

  if (updateError) throw updateError;

  return {
    userId: uid,
    r2Deleted: r2.deleted,
    r2Listed: r2.listed,
    catalogDeleted: count ?? 0,
  };
}

/**
 * Cron: sync retention for a batch of users, then purge past deadlines.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{ syncLimit?: number; purgeLimit?: number; nowMs?: number }} [options]
 */
export async function processBackupRetentionCron(supabaseAdmin, options = {}) {
  const syncLimit = Math.min(500, Math.max(1, Math.floor(Number(options.syncLimit ?? 200) || 200)));
  const purgeLimit = Math.min(100, Math.max(1, Math.floor(Number(options.purgeLimit ?? 50) || 50)));
  const nowIso = new Date(options.nowMs ?? Date.now()).toISOString();

  /** @type {Array<Record<string, unknown>>} */
  const syncResults = [];
  /** @type {Array<Record<string, unknown>>} */
  const purgeResults = [];

  const { data: syncCandidates, error: syncError } = await supabaseAdmin
    .from('users')
    .select('id')
    .in('backup_retention_state', [
      BACKUP_RETENTION_STATE.ACTIVE,
      BACKUP_RETENTION_STATE.GRACE,
    ])
    .order('updated_at', { ascending: true })
    .limit(syncLimit);

  if (syncError) throw syncError;

  for (const row of syncCandidates ?? []) {
    try {
      const result = await syncUserBackupEntitlement(supabaseAdmin, String(row.id));
      syncResults.push({ userId: row.id, ...result });
    } catch (err) {
      syncResults.push({
        userId: row.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const { data: due, error: dueError } = await supabaseAdmin
    .from('users')
    .select('id, backup_purge_after')
    .eq('backup_retention_state', BACKUP_RETENTION_STATE.GRACE)
    .lte('backup_purge_after', nowIso)
    .order('backup_purge_after', { ascending: true })
    .limit(purgeLimit);

  if (dueError) throw dueError;

  for (const row of due ?? []) {
    try {
      const purged = await purgeUserBackupRetention(supabaseAdmin, String(row.id));
      purgeResults.push({ ok: true, ...purged });
    } catch (err) {
      purgeResults.push({
        ok: false,
        userId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    synced: syncResults.length,
    purged: purgeResults.filter((r) => r.ok).length,
    purgeFailed: purgeResults.filter((r) => !r.ok).length,
    syncResults,
    purgeResults,
  };
}
