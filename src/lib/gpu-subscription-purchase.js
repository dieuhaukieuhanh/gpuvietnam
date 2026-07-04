import { getPlanPrice } from '@/lib/gpu-pricing';
import { ensureGpuPricingLoaded } from '@/lib/gpu-pricing-config';
import {
  computeExpiresAt,
  getGpuLabel,
  getPlanQuota,
} from '@/lib/plan-hours';
import { DEFAULT_CHECKOUT_ENV } from '@/lib/checkout-auth';

const VALID_BILLING = ['hourly', 'combo1', 'combo2'];

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

  return { plan, billing, env, icon, desc, transferNote };
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
      error: 'Bạn đã có yêu cầu thanh toán đang chờ Admin xác nhận.',
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
  { plan, billing, env, icon, desc, transferNote },
) {
  await ensureGpuPricingLoaded(supabaseAdmin);
  const quota = getPlanQuota(plan, billing);
  const expiresAt = computeExpiresAt(quota.validityDays);
  const now = new Date().toISOString();

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
      hours_total: quota.hoursTotal,
      hours_used: 0,
      status: 'pending_payment',
      server_status: 'offline',
      is_trial: false,
      transfer_note: transferNote,
      expires_at: expiresAt,
      activated_at: null,
      created_at: now,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function purchaseGpuPlanWithWallet(
  supabaseAdmin,
  userId,
  { plan, billing, env, icon, desc },
) {
  await ensureGpuPricingLoaded(supabaseAdmin);
  const price = getPlanPrice(plan, billing);
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

  const quota = getPlanQuota(plan, billing);
  const expiresAt = computeExpiresAt(quota.validityDays);
  const now = new Date().toISOString();
  const newBalance = walletBalance - price;

  await replaceActiveSubscriptions(supabaseAdmin, userId);

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
      hours_total: quota.hoursTotal,
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
    description: `Mua gói ${plan} ${billing}`,
    status: 'completed',
  });

  return {
    ok: true,
    subscription,
    walletBalance: newBalance,
    amountCharged: price,
  };
}
