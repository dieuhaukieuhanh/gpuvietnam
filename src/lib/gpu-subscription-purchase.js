import {
  getPlanKeyFromName,
  getPlanNameFromKey,
  getPlanPrice,
  getPlanPurchaseAmount,
  normalizeHourlyPurchaseHours,
} from '@/lib/gpu-pricing';
import { ensureGpuPricingLoaded } from '@/lib/gpu-pricing-config';
import {
  computeExpiresAt,
  getGpuLabel,
  getPlanQuota,
} from '@/lib/plan-hours';
import { DEFAULT_CHECKOUT_ENV } from '@/lib/checkout-auth';
import { syncUserPlanInventory } from '@/lib/user-plan-inventory';
import {
  allocateTransferCode,
  buildSepayTransferInfo,
  buildTransferDescription,
  parseTransferCode,
} from '@/lib/sepay';

const VALID_BILLING = ['hourly', 'combo1', 'combo2'];

/**
 * @param {string} plan
 * @returns {'starter'|'pro'|'studio'|null}
 */
function resolveGpuPlanKey(plan) {
  const fromName = getPlanKeyFromName(plan);
  if (fromName === 'starter' || fromName === 'pro' || fromName === 'studio') {
    return fromName;
  }
  const planKey = String(plan ?? '')
    .trim()
    .toLowerCase();
  if (planKey === 'starter' || planKey === 'pro' || planKey === 'studio') return planKey;
  if (planKey.includes('starter')) return 'starter';
  if (planKey.includes('studio')) return 'studio';
  if (planKey.includes('pro')) return 'pro';
  return null;
}

/**
 * "Mua thêm N giờ lẻ" always creates a new hourly subscription row.
 * Each purchase has its own 60-day validity — never merge into an existing
 * Giờ lẻ line (UI shows one line per purchase; settlement pool still sums them).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string} plan
 * @param {number} hours
 * @param {{
 *   expiresAt?: string|null,
 *   env?: string,
 *   icon?: string,
 *   desc?: string|null,
 * }} [options]
 */
export async function creditAdditionalHoursToHourlyPlan(
  supabaseAdmin,
  userId,
  plan,
  hours,
  options = {},
) {
  const hoursNum = Math.max(0, Math.floor(Number(hours) || 0));
  if (hoursNum <= 0) {
    return { ok: false, error: 'Số giờ không hợp lệ.' };
  }

  const gpuPlan = resolveGpuPlanKey(plan);
  if (!gpuPlan) {
    return { ok: false, error: 'Gói GPU không hợp lệ.' };
  }

  const planLabel = getPlanNameFromKey(gpuPlan) ?? plan;
  const now = new Date().toISOString();
  const expiresAt = options.expiresAt ?? null;

  const { data: subscription, error: insertErr } = await supabaseAdmin
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan: planLabel,
      billing: 'hourly',
      env_name: options.env || DEFAULT_CHECKOUT_ENV.name,
      env_icon: options.icon || DEFAULT_CHECKOUT_ENV.icon,
      env_desc: options.desc ?? DEFAULT_CHECKOUT_ENV.desc,
      gpu_label: getGpuLabel(planLabel),
      hours_total: hoursNum,
      hours_used: 0,
      status: 'active',
      server_status: 'offline',
      is_trial: false,
      transfer_note: `Ví: mua thêm ${hoursNum}h ${planLabel}`,
      expires_at: expiresAt,
      activated_at: now,
      created_at: now,
    })
    .select('*')
    .single();
  if (insertErr) throw insertErr;

  await syncUserPlanInventory(supabaseAdmin, userId);
  return { ok: true, subscription, hoursAdded: hoursNum, gpuPlan };
}

export function normalizeGpuPurchaseInput(body) {
  const plan = body?.plan;
  const billing = VALID_BILLING.includes(body?.billing) ? body.billing : 'combo1';
  const env = body?.env || DEFAULT_CHECKOUT_ENV.name;
  const icon = body?.icon || DEFAULT_CHECKOUT_ENV.icon;
  const desc = body?.desc ?? DEFAULT_CHECKOUT_ENV.desc;
  const transferNote = body?.transferNote ?? null;

  if (!plan) {
    return { error: 'Thiếu thông tin gói.' };
  }

  let hours = null;
  if (billing === 'hourly' && body?.hours != null && body?.hours !== '') {
    hours = normalizeHourlyPurchaseHours(body.hours);
  }

  const additional = body?.additional === true || body?.additional === '1' || body?.additional === 1;

  return { plan, billing, env, icon, desc, transferNote, hours, additional };
}

function resolvePurchasePricing(plan, billing, hours) {
  const quota = getPlanQuota(plan, billing);
  if (billing === 'hourly') {
    const purchaseHours = normalizeHourlyPurchaseHours(hours);
    return {
      price: getPlanPurchaseAmount(plan, billing, purchaseHours),
      hoursTotal: purchaseHours,
      validityDays: quota.validityDays,
    };
  }

  return {
    price: getPlanPrice(plan, billing),
    hoursTotal: quota.hoursTotal,
    validityDays: quota.validityDays,
  };
}

export async function assertNoPendingGpuPayment(supabaseAdmin, userId) {
  const { data: pending } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending_payment')
    .maybeSingle();

  if (pending) {
    return {
      ok: false,
      error: 'Bạn đã có yêu cầu thanh toán đang chờ xác nhận chuyển khoản.',
      code: 'pending_exists',
    };
  }

  return { ok: true };
}

export async function replaceActiveSubscriptions(supabaseAdmin, userId) {
  await supabaseAdmin
    .from('subscriptions')
    .update({ status: 'replaced' })
    .eq('user_id', userId)
    .in('status', ['active', 'pending', 'provisioning', 'pending_payment']);
}

export async function createPendingGpuSubscription(
  supabaseAdmin,
  userId,
  { plan, billing, env, icon, desc, transferNote, hours, fullName },
) {
  await ensureGpuPricingLoaded(supabaseAdmin);
  const pricing = resolvePurchasePricing(plan, billing, hours);
  const expiresAt = computeExpiresAt(pricing.validityDays);
  const now = new Date().toISOString();

  // Ensure SePay can auto-match: transfer_note = GD + 2 chars only.
  let note = typeof transferNote === 'string' ? transferNote.trim() : '';
  let transferCode = parseTransferCode(note);
  if (!transferCode) {
    transferCode = await allocateTransferCode(supabaseAdmin);
    note = buildTransferDescription(fullName, transferCode);
  } else {
    note = transferCode;
  }

  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan,
      billing,
      env_name: env,
      env_icon: icon,
      env_desc: desc,
      gpu_label: getGpuLabel(plan),
      hours_total: pricing.hoursTotal,
      hours_used: 0,
      status: 'pending_payment',
      server_status: 'offline',
      is_trial: false,
      transfer_note: note,
      expires_at: expiresAt,
      activated_at: null,
      created_at: now,
    })
    .select()
    .single();

  if (error) throw error;

  const transfer = buildSepayTransferInfo({
    amount: pricing.price,
    transferCode,
    description: note,
  });

  return { subscription: data, transfer, transferCode, amount: pricing.price };
}

export async function purchaseGpuPlanWithWallet(
  supabaseAdmin,
  userId,
  { plan, billing, env, icon, desc, hours, additional = false },
) {
  await ensureGpuPricingLoaded(supabaseAdmin);
  const pricing = resolvePurchasePricing(plan, billing, hours);
  const price = pricing.price;
  if (price <= 0) {
    return { ok: false, error: 'Gói này không hỗ trợ thanh toán ví.' };
  }

  const pendingCheck = await assertNoPendingGpuPayment(supabaseAdmin, userId);
  if (!pendingCheck.ok) return pendingCheck;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('wallet_balance')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) throw profileError;

  const walletBalance = Number(profile?.wallet_balance ?? 0);
  if (walletBalance < price) {
    return {
      ok: false,
      error: `Số dư ví không đủ. Cần ${price.toLocaleString('vi-VN')}đ, hiện có ${walletBalance.toLocaleString('vi-VN')}đ.`,
      code: 'insufficient_balance',
    };
  }

  const expiresAt = computeExpiresAt(pricing.validityDays);
  const now = new Date().toISOString();
  const newBalance = walletBalance - price;

  // Additional hourly → new Giờ lẻ lot (own 60-day expiry). Combo additional
  // also inserts a new subscription below (no merge into existing combo lines).
  if (additional && billing === 'hourly') {
    const { error: walletError } = await supabaseAdmin
      .from('users')
      .update({ wallet_balance: newBalance, updated_at: now })
      .eq('id', userId);
    if (walletError) throw walletError;

    await supabaseAdmin.from('wallet_transactions').insert({
      user_id: userId,
      type: 'payment',
      amount: price,
      bonus_amount: 0,
      balance_after: newBalance,
      description: `Mua thêm ${pricing.hoursTotal}h ${plan}`,
      status: 'completed',
    });

    const credited = await creditAdditionalHoursToHourlyPlan(
      supabaseAdmin,
      userId,
      plan,
      pricing.hoursTotal,
      {
        expiresAt,
        env,
        icon,
        desc,
      },
    );
    if (!credited.ok) {
      return { ok: false, error: credited.error ?? 'Không cộng được giờ lẻ vào gói.' };
    }

    return {
      ok: true,
      subscription: credited.subscription,
      hoursAdded: credited.hoursAdded,
      walletBalance: newBalance,
      amountCharged: price,
      creditedAs: 'hourly',
    };
  }

  if (!additional) {
    await replaceActiveSubscriptions(supabaseAdmin, userId);
  }

  const { data: subscription, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .insert({
      user_id: userId,
      plan,
      billing,
      env_name: env,
      env_icon: icon,
      env_desc: desc,
      gpu_label: getGpuLabel(plan),
      hours_total: pricing.hoursTotal,
      hours_used: 0,
      status: 'active',
      server_status: 'offline',
      is_trial: false,
      transfer_note: `Ví: ${plan} ${billing}`,
      expires_at: expiresAt,
      activated_at: now,
      created_at: now,
    })
    .select()
    .single();

  if (subError) throw subError;

  const { error: walletError } = await supabaseAdmin
    .from('users')
    .update({ wallet_balance: newBalance, updated_at: now })
    .eq('id', userId);

  if (walletError) throw walletError;

  await supabaseAdmin.from('wallet_transactions').insert({
    user_id: userId,
    type: 'payment',
    amount: price,
    bonus_amount: 0,
    balance_after: newBalance,
    description: additional
      ? `Mua thêm gói ${plan} ${billing}`
      : `Mua gói ${plan} ${billing}`,
    status: 'completed',
  });

  await syncUserPlanInventory(supabaseAdmin, userId);

  return {
    ok: true,
    subscription,
    walletBalance: newBalance,
    amountCharged: price,
  };
}
