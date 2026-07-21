import {
  getComboPackage,
  getGpuLabel,
  getPlanConfig,
  getPlanKeyFromName,
  getPlanNameFromKey,
  getPlanPrice,
} from '@/lib/gpu-pricing';
import { ensureGpuPricingLoaded } from '@/lib/gpu-pricing-config';
import { buildRenewTransferNote } from '@/lib/plan-renew-request';
import { computeExpiresAt, getPlanQuota } from '@/lib/plan-hours';
import { getPlanPriceVnd } from '@/lib/plan-pricing';
import { loadScbRemainingForUser } from '@/lib/gpu/remaining-consumer';
import { profStart, profEnd, prof } from '@/lib/prof';

export const PROACTIVE_RENEW_HOURS_THRESHOLD = 10;
export const AUTO_RENEW_BONUS_RATE = 0.03;

function normalizePlanKey(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const fromName = getPlanKeyFromName(raw);
  if (fromName === 'starter' || fromName === 'pro' || fromName === 'studio') {
    return fromName;
  }

  const lower = raw.toLowerCase();
  if (lower === 'starter' || lower === 'pro' || lower === 'studio') return lower;

  // Fuzzy match on common labels (order matters: starter before pro).
  if (/\bstarter\b/i.test(raw) || /\brtx\s*3090\b/i.test(raw)) return 'starter';
  if (/\bstudio\b/i.test(raw) || /\b2\s*x\s*rtx\s*4090\b/i.test(raw) || /\brtx\s*4090\s*2x\b/i.test(raw)) {
    return 'studio';
  }
  if (/\bpro\b/i.test(raw) || /\brtx\s*4090\b/i.test(raw)) return 'pro';

  console.warn('[normalizePlanKey] unrecognized plan value, refusing silent pro fallback:', raw);
  return null;
}

function roundHours(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * user_plan_inventory.id is bigint — reject UUIDs accidentally passed as inventory ids.
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseInventoryId(value) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (/^[0-9a-f-]{36}$/i.test(raw)) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) return null;
  return num;
}

function isRowUsable(row) {
  if (!row || row.status !== 'active') return false;
  if (Number(row.hours_remaining ?? 0) <= 0 && row.plan_type !== 'hourly') return false;
  if (row.valid_until && new Date(row.valid_until).getTime() <= Date.now()) return false;
  return true;
}

/**
 * @param {string} planName
 * @param {'combo1'|'combo2'|'hourly'} billing
 * @param {number|null} hoursRemaining
 * @param {{ isAutoRenew?: boolean }} options
 */
export function computeRenewQuote(planName, billing, hoursRemaining, options = {}) {
  const planKey = normalizePlanKey(planName);
  if (!planKey) return null;
  const combo = getComboPackage(planKey, billing);
  if (!combo || billing === 'hourly') {
    return null;
  }

  const baseHours = combo.hours;
  const comboBonus = combo.bonus;
  const remaining = hoursRemaining ?? 0;
  const isAutoRenew = Boolean(options.isAutoRenew);
  const qualifiesForAutoRenewBonus =
    isAutoRenew && remaining >= PROACTIVE_RENEW_HOURS_THRESHOLD;
  const renewBonus = qualifiesForAutoRenewBonus
    ? Math.max(1, Math.floor(baseHours * AUTO_RENEW_BONUS_RATE))
    : 0;
  const totalHours = baseHours + comboBonus + renewBonus;
  const price = getPlanPriceVnd(planName, billing);

  return {
    planKey,
    planName: getPlanNameFromKey(planKey) ?? planName,
    billing,
    baseHours,
    comboBonus,
    renewBonus,
    totalHours,
    bonusRate: qualifiesForAutoRenewBonus ? AUTO_RENEW_BONUS_RATE : 0,
    bonusLabel: qualifiesForAutoRenewBonus ? '3%' : null,
    price,
    validityDays: combo.days,
  };
}

/**
 * Map dashboard/me subscription row(s) for inventory sync prefetch (skip duplicate SELECT).
 * @param {Record<string, unknown> | Record<string, unknown>[] | null | undefined} subscription
 */
export function subscriptionPrefetchForInventorySync(subscription) {
  if (subscription == null) return undefined;
  const list = Array.isArray(subscription) ? subscription : [subscription];
  return list
    .filter((row) => row && row.status === 'active')
    .map((row) => ({
      id: row.id,
      plan: row.plan,
      billing: row.billing,
      hours_total: row.hours_total,
      hours_used: row.hours_used,
      status: row.status,
      expires_at: row.expires_at,
    }));
}

function normalizeSubscriptionsPrefetch(prefetched) {
  if (prefetched === undefined) return undefined;
  if (!prefetched) return [];
  return Array.isArray(prefetched) ? prefetched : [prefetched];
}

/**
 * Map dashboard/me grant rows for inventory sync prefetch (skip duplicate SELECT).
 * @param {Record<string, unknown>[] | null | undefined} grants
 */
export function grantsPrefetchForInventorySync(grants) {
  if (!grants?.length) return [];
  return grants.map((grant) => ({
    id: grant.id,
    gpu_plan: grant.gpu_plan,
    hours_granted: grant.hours_granted,
    hours_used: grant.hours_used,
    expires_at: grant.expires_at,
    status: grant.status,
  }));
}

function shouldUpdateInventoryRow(prev, row) {
  if (!prev?.id) return true;
  return (
    prev.plan_type !== row.plan_type ||
    prev.plan_name !== row.plan_name ||
    Number(prev.hours_total ?? 0) !== Number(row.hours_total ?? 0) ||
    Number(prev.hours_remaining ?? 0) !== Number(row.hours_remaining ?? 0) ||
    Number(prev.price_per_hour ?? 0) !== Number(row.price_per_hour ?? 0) ||
    String(prev.valid_until ?? '') !== String(row.valid_until ?? '') ||
    prev.status !== row.status ||
    prev.source !== row.source ||
    String(prev.grant_id ?? '') !== String(row.grant_id ?? '') ||
    String(prev.billing ?? '') !== String(row.billing ?? '') ||
    String(prev.subscription_id ?? '') !== String(row.subscription_id ?? '')
  );
}

function sortInventoryRows(rows) {
  return [...(rows ?? [])].sort((a, b) => {
    const activeDiff = Number(Boolean(b.is_active)) - Number(Boolean(a.is_active));
    if (activeDiff !== 0) return activeDiff;
    return new Date(String(b.created_at ?? 0)).getTime() - new Date(String(a.created_at ?? 0)).getTime();
  });
}

async function loadSubscriptionsForInventorySync(supabaseAdmin, userId, prefetched) {
  const normalized = normalizeSubscriptionsPrefetch(prefetched);
  if (normalized !== undefined) return normalized;

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id, plan, billing, hours_total, hours_used, status, expires_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('expires_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

async function loadGrantsForInventorySync(supabaseAdmin, userId, prefetched) {
  if (prefetched !== undefined) return prefetched ?? [];
  const { data } = await supabaseAdmin
    .from('manual_hour_grants')
    .select('id, gpu_plan, hours_granted, hours_used, expires_at, status')
    .eq('user_id', userId)
    .eq('status', 'active');
  return data ?? [];
}

async function loadInventoryRowsForSync(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin.from('user_plan_inventory').select('*').eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ subscription?: Record<string, unknown>|Record<string, unknown>[]|null, subscriptions?: Record<string, unknown>[], grants?: Record<string, unknown>[] }} [options]
 */
export async function syncUserPlanInventory(supabaseAdmin, userId, options = {}) {
  const subscriptionPrefetch =
    options.subscriptions !== undefined ? options.subscriptions : options.subscription;

  const [subscriptions, existing, grants] = await Promise.all([
    prof('Load User Plan', () =>
      loadSubscriptionsForInventorySync(supabaseAdmin, userId, subscriptionPrefetch),
    ),
    prof('Load Inventory', () => loadInventoryRowsForSync(supabaseAdmin, userId)),
    prof('Load Usage', () => loadGrantsForInventorySync(supabaseAdmin, userId, options.grants)),
  ]);

  const computeSpan = profStart('Compute');
  const existingByKey = new Map();
  for (const row of existing) {
    const key = row.grant_id ? `gift:${row.grant_id}` : `sub:${row.subscription_id ?? 'main'}`;
    // Keep the newest / first seen row; later duplicates are expired below.
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }

  const upserts = [];
  let hasActive = existing.some((row) => row.is_active);

  for (const subscription of subscriptions) {
    const planKey = normalizePlanKey(subscription.plan);
    if (!planKey) {
      console.warn(
        '[syncUserPlanInventory] skip subscription with unrecognized plan:',
        subscription.id,
        subscription.plan,
      );
      continue;
    }
    const planType = subscription.billing === 'hourly' ? 'hourly' : 'combo';
    const hoursRemaining = Math.max(
      0,
      Number(subscription.hours_total ?? 0) - Number(subscription.hours_used ?? 0),
    );
    const key = `sub:${subscription.id}`;
    const prev = existingByKey.get(key);
    const status =
      hoursRemaining <= 0 && planType !== 'hourly'
        ? 'depleted'
        : subscription.expires_at && new Date(subscription.expires_at).getTime() <= Date.now()
          ? 'expired'
          : 'active';

    upserts.push({
      key,
      row: {
        user_id: userId,
        plan_type: planType,
        plan_name: planKey,
        hours_total: Number(subscription.hours_total ?? 0),
        hours_remaining: roundHours(hoursRemaining),
        price_per_hour: getPlanPrice(planKey, 'hourly'),
        valid_from: prev?.valid_from ?? new Date().toISOString(),
        valid_until: subscription.expires_at,
        is_active: prev?.is_active ?? (status === 'active' && !hasActive),
        status,
        source: prev?.source ?? 'purchased',
        grant_id: null,
        billing: subscription.billing,
        subscription_id: subscription.id,
      },
      prev,
    });
    if (!hasActive && status === 'active') hasActive = true;
  }

  for (const grant of grants) {
    const hoursRemaining = Math.max(
      0,
      Number(grant.hours_granted ?? 0) - Number(grant.hours_used ?? 0),
    );
    const key = `gift:${grant.id}`;
    const prev = existingByKey.get(key);
    const planKey = normalizePlanKey(grant.gpu_plan);
    if (!planKey) {
      console.warn('[syncUserPlanInventory] skip grant with unrecognized gpu_plan:', grant.id, grant.gpu_plan);
      continue;
    }
    let status = 'active';
    if (hoursRemaining <= 0) status = 'depleted';
    else if (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now()) {
      status = 'expired';
    }

    upserts.push({
      key,
      row: {
        user_id: userId,
        plan_type: 'gift',
        plan_name: planKey,
        hours_total: Number(grant.hours_granted ?? 0),
        hours_remaining: roundHours(hoursRemaining),
        price_per_hour: 0,
        valid_from: prev?.valid_from ?? new Date().toISOString(),
        valid_until: grant.expires_at,
        is_active: prev?.is_active ?? false,
        status,
        source: 'granted',
        grant_id: grant.id,
        billing: null,
        subscription_id: null,
      },
      prev,
    });
  }
  profEnd(computeSpan);

  let mutated = false;
  const writeSpan = profStart('DB Writes');
  /** @type {Promise<unknown>[]} */
  const writeOps = [];

  for (const item of upserts) {
    if (item.prev?.id) {
      if (!shouldUpdateInventoryRow(item.prev, item.row)) continue;
      mutated = true;
      writeOps.push(
        supabaseAdmin
          .from('user_plan_inventory')
          .update({
            ...item.row,
            is_active: item.prev.is_active,
          })
          .eq('id', item.prev.id),
      );
    } else {
      mutated = true;
      writeOps.push(supabaseAdmin.from('user_plan_inventory').insert(item.row));
    }
  }

  const activeIds = new Set(upserts.map((u) => u.key));
  for (const row of existing) {
    const key = row.grant_id ? `gift:${row.grant_id}` : `sub:${row.subscription_id ?? 'main'}`;
    const kept = existingByKey.get(key);
    const isDuplicate = kept && Number(kept.id) !== Number(row.id);
    if (!activeIds.has(key) || isDuplicate) {
      if (row.status === 'expired' && !row.is_active && !isDuplicate) continue;
      mutated = true;
      writeOps.push(
        supabaseAdmin
          .from('user_plan_inventory')
          .update({ status: 'expired', is_active: false })
          .eq('id', row.id),
      );
    }
  }

  if (writeOps.length) await Promise.all(writeOps);
  profEnd(writeSpan);

  const readSpan = profStart('DB Reads');
  let inventory;
  if (!mutated) {
    inventory = sortInventoryRows(existing);
  } else {
    const { data, error } = await supabaseAdmin
      .from('user_plan_inventory')
      .select('*')
      .eq('user_id', userId)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    inventory = data ?? [];
  }

  if (inventory.length && !inventory.some((row) => row.is_active)) {
    const firstUsable = inventory.find(isRowUsable);
    if (firstUsable) {
      mutated = true;
      await supabaseAdmin
        .from('user_plan_inventory')
        .update({ is_active: true })
        .eq('id', firstUsable.id);
      firstUsable.is_active = true;
    }
  }
  profEnd(readSpan);

  const returnSpan = profStart('Return');
  profEnd(returnSpan);

  // Keep backup quota + retention in sync whenever GPU inventory changes.
  try {
    const { syncUserBackupEntitlement } = await import('./backup-entitlement.js');
    await syncUserBackupEntitlement(supabaseAdmin, userId);
  } catch (err) {
    console.warn(
      '[syncUserPlanInventory] syncUserBackupEntitlement failed (non-fatal):',
      err instanceof Error ? err.message : err,
    );
  }

  return inventory;
}

export function mapInventoryRow(row) {
  const resolvedKey = normalizePlanKey(row.plan_name);
  if (!resolvedKey) {
    console.warn('[mapInventoryRow] unrecognized plan_name, defaulting display to pro:', row.plan_name);
  }
  const planKey = resolvedKey ?? 'pro';
  const config = getPlanConfig(planKey);
  const usable = isRowUsable(row);
  const planTypeLabel =
    row.plan_type === 'gift' ? '🎁 Tặng' : row.plan_type === 'hourly' ? '⚡ Theo giờ' : '📦 Combo';

  return {
    id: row.id,
    planType: row.plan_type,
    planTypeLabel,
    planName: row.plan_name,
    planKey,
    displayName: config?.name ?? row.plan_name,
    gpu: config?.gpu ?? 'GPU',
    vram: config?.vram ?? '—',
    hoursTotal: Number(row.hours_total ?? 0),
    hoursRemaining: Number(row.hours_remaining ?? 0),
    pricePerHour: Number(row.price_per_hour ?? 0),
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    isActive: Boolean(row.is_active),
    status: row.status,
    source: row.source,
    billing: row.billing,
    grantId: row.grant_id,
    subscriptionId: row.subscription_id,
    usable,
    statusBadge:
      row.is_active && usable
        ? '[Đang dùng]'
        : row.status === 'expired'
          ? 'Hết hạn'
          : row.status === 'depleted'
            ? 'Đã dùng hết'
            : 'Sẵn sàng',
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function listUserPlans(supabaseAdmin, userId) {
  const rows = await syncUserPlanInventory(supabaseAdmin, userId);
  const items = rows.map(mapInventoryRow);
  const usable = items.filter((item) => item.usable);
  const inactive = items.filter((item) => !item.usable);
  const activePlan = items.find((item) => item.isActive && item.usable) ?? null;

  return {
    items,
    usable,
    inactive,
    activePlan,
    count: usable.length,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {number} inventoryId
 */
export async function activateInventoryPlan(supabaseAdmin, userId, inventoryId) {
  const parsedId = parseInventoryId(inventoryId);
  if (!parsedId) {
    return { error: 'Mã gói không hợp lệ.' };
  }

  const { data: target, error } = await supabaseAdmin
    .from('user_plan_inventory')
    .select('*')
    .eq('id', parsedId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!target) return { error: 'Không tìm thấy gói.' };
  if (!isRowUsable(target)) return { error: 'Gói này không còn khả dụng.' };

  const planKey = normalizePlanKey(target.plan_name);
  if (!planKey) {
    return { error: 'Gói này không xác định được loại (Starter / Pro / Studio).' };
  }

  await supabaseAdmin
    .from('user_plan_inventory')
    .update({ is_active: false })
    .eq('user_id', userId);

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('user_plan_inventory')
    .update({ is_active: true, plan_name: planKey })
    .eq('id', parsedId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (updateError) throw updateError;

  // Keep the machine-driving subscription aligned with the selected inventory tier,
  // so start-machine / dashboard always provision the matching GPU.
  const planName = getPlanNameFromKey(planKey) ?? planKey;
  const gpuLabel = getGpuLabel(planKey);
  const subscriptionId = updated.subscription_id ?? null;

  if (subscriptionId) {
    const { error: subErr } = await supabaseAdmin
      .from('subscriptions')
      .update({ plan: planName, gpu_label: gpuLabel })
      .eq('id', subscriptionId)
      .eq('user_id', userId);
    if (subErr) {
      console.warn('[activateInventoryPlan] subscription sync failed:', subErr.message);
    }
  }
  // Gift rows (no subscription_id): do not rewrite another subscription's plan/billing.
  // start-machine resolves GPU from the active inventory planKey.

  console.info('[activateInventoryPlan] activated', {
    userId,
    inventoryId: parsedId,
    planKey,
    subscriptionId,
    gpuLabel,
  });

  return { success: true, plan: mapInventoryRow(updated), planKey, gpuLabel };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {number} inventoryId
 */
export async function deactivateInventoryPlan(supabaseAdmin, userId, inventoryId) {
  const { data: others } = await supabaseAdmin
    .from('user_plan_inventory')
    .select('id')
    .eq('user_id', userId)
    .neq('id', inventoryId)
    .eq('status', 'active');

  if (!others?.length) {
    return { error: 'Không có gói khác để chuyển sang.' };
  }

  await supabaseAdmin
    .from('user_plan_inventory')
    .update({ is_active: false })
    .eq('id', inventoryId)
    .eq('user_id', userId);

  return { success: true };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ plan: string; billing: string; previewOnly?: boolean; isAutoRenew?: boolean }} input
 */
async function loadRenewTargetSubscription(supabaseAdmin, userId, { subscriptionId, plan, billing }) {
  if (subscriptionId) {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  let query = supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (plan) query = query.eq('plan', plan);
  if (billing) query = query.eq('billing', billing);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function processPlanRenew(supabaseAdmin, userId, input) {
  await ensureGpuPricingLoaded(supabaseAdmin);

  const {
    plan,
    billing,
    subscriptionId,
    previewOnly = false,
    isAutoRenew = false,
  } = input;

  const subscription = await loadRenewTargetSubscription(supabaseAdmin, userId, {
    subscriptionId,
    plan,
    billing,
  });

  if (!subscription) {
    return { error: 'Không tìm thấy gói phù hợp để tái tục.' };
  }
  if (subscription.status !== 'active') {
    return { error: 'Gói này không còn hoạt động, không thể tái tục.' };
  }

  const resolvedPlan = plan ?? subscription.plan;
  const resolvedBilling = billing ?? subscription.billing;

  // Validate the picked subscription matches the requested plan/billing
  // (defensive — prevents conflating hours into a wrong payment package).
  const subPlanKey = normalizePlanKey(subscription.plan);
  const requestedPlanKey = normalizePlanKey(resolvedPlan);
  if (subPlanKey !== requestedPlanKey || subscription.billing !== resolvedBilling) {
    return {
      error:
        'Gói thanh toán được chọn không khớp với yêu cầu tái tục. Vui lòng tải lại trang và thử lại.',
    };
  }

  const remainingRead = await loadScbRemainingForUser(supabaseAdmin, userId);
  const hoursRemaining = remainingRead.hoursRemaining ?? 0;

  const quote = computeRenewQuote(resolvedPlan, resolvedBilling, hoursRemaining, {
    isAutoRenew,
  });

  if (!quote) {
    return { error: 'Chỉ tái tục được gói Combo.' };
  }

  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('wallet_balance')
    .eq('id', userId)
    .maybeSingle();

  const walletBalance = Number(profile?.wallet_balance ?? 0);
  const shortage = Math.max(0, quote.price - walletBalance);

  if (walletBalance < quote.price) {
    return {
      error: 'insufficient',
      walletBalance,
      shortage,
      price: quote.price,
      transferNote: buildRenewTransferNote(userId),
      quote,
      subscriptionId: subscription.id,
    };
  }

  if (previewOnly) {
    return {
      success: true,
      preview: true,
      walletBalance,
      balanceAfter: walletBalance - quote.price,
      quote,
      subscriptionId: subscription.id,
    };
  }

  const newBalance = walletBalance - quote.price;
  const quota = getPlanQuota(quote.planName, quote.billing);
  // New combo lot with its own validity — never merge into the existing row
  // (UI shows one line per purchase; settlement pool still sums them).
  const newExpiresAt = computeExpiresAt(quota.validityDays);
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('users')
    .update({ wallet_balance: newBalance, updated_at: now })
    .eq('id', userId);

  const { data: renewedSub, error: insertErr } = await supabaseAdmin
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan: subscription.plan,
      billing: subscription.billing,
      env_name: subscription.env_name,
      env_icon: subscription.env_icon,
      env_desc: subscription.env_desc,
      gpu_label: subscription.gpu_label ?? getGpuLabel(quote.planName),
      hours_total: quote.totalHours,
      hours_used: 0,
      status: 'active',
      server_status: 'offline',
      is_trial: false,
      transfer_note: isAutoRenew
        ? `Tự động tái tục ${quote.planName} ${quote.billing}`
        : `Tái tục ${quote.planName} ${quote.billing}`,
      expires_at: newExpiresAt,
      activated_at: now,
      created_at: now,
    })
    .select('id')
    .single();
  if (insertErr) throw insertErr;

  await supabaseAdmin.from('wallet_transactions').insert({
    user_id: userId,
    type: 'payment',
    amount: quote.price,
    bonus_amount: 0,
    balance_after: newBalance,
    description: `Tái tục ${quote.planName} ${quote.billing} (+${quote.totalHours}h)`,
    status: 'completed',
  });

  await syncUserPlanInventory(supabaseAdmin, userId);

  return {
    success: true,
    walletBalance: newBalance,
    hoursAdded: quote.totalHours,
    quote,
    subscriptionId: renewedSub.id,
  };
}

export function inventoryToSelectorPlan(row) {
  const mapped = typeof row.planName === 'string' ? mapInventoryRow(row) : row;
  const planKey =
    (mapped.planKey === 'starter' || mapped.planKey === 'pro' || mapped.planKey === 'studio'
      ? mapped.planKey
      : null) ?? normalizePlanKey(mapped.planName ?? mapped.plan_name);
  if (!planKey) {
    console.warn(
      '[inventoryToSelectorPlan] cannot resolve plan key from',
      mapped.planName ?? mapped.plan_name,
    );
    return null;
  }
  const config = getPlanConfig(planKey);
  const hoursRemaining = Number(mapped.hoursRemaining ?? mapped.hours_remaining ?? 0);

  return {
    id: String(mapped.id),
    inventoryId: mapped.id,
    subscriptionId: mapped.subscriptionId ?? mapped.subscription_id ?? null,
    type: mapped.planType === 'gift' ? 'gift' : 'main',
    plan_type: mapped.planType,
    plan: planKey,
    gpu: config?.gpu ?? 'GPU',
    vram: config?.vram ?? '—',
    hours_remaining: hoursRemaining,
    price_per_hour: Number(mapped.pricePerHour ?? mapped.price_per_hour ?? 0),
    expires_at: mapped.validUntil ?? mapped.valid_until ?? null,
    label: `${config?.name ?? planKey} (${config?.gpu ?? 'GPU'}) — ${hoursRemaining}h${
      mapped.planType === 'gift' ? ' tặng' : ' còn lại'
    }`,
    badge:
      mapped.planType === 'gift'
        ? '🎁 Quà tặng'
        : mapped.planType === 'hourly'
          ? '⚡ Theo giờ'
          : 'Gói của bạn',
    is_active: Boolean(mapped.isActive ?? mapped.is_active),
  };
}

export { buildRenewTransferNote as buildTransferNote, isRowUsable, normalizePlanKey };
