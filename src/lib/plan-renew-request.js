import { ensureGpuPricingLoaded } from '@/lib/gpu-pricing-config';
import { WALLET_BANK_INFO } from '@/lib/wallet-deposit';
import { loadScbRemainingForUser } from '@/lib/gpu/remaining-consumer';
import {
  computeRenewQuote,
  processPlanRenew,
} from '@/lib/user-plan-inventory';
import {
  notifyPlanRenewApproved,
  notifyPlanRenewPending,
  notifyPlanRenewRejected,
} from '@/lib/user-notifications';
import {
  allocateTransferCode,
  buildSepayTransferInfo,
  parseTransferCode,
} from '@/lib/sepay';

/**
 * Legacy helper — still used by some call sites for display.
 * Prefer allocateTransferCode() when creating a new renew request.
 */
export function buildRenewTransferNote(userId) {
  return `TAITUC-${String(userId).replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function formatPendingRenewResponse(row) {
  const code = parseTransferCode(row.transfer_note);
  const sepay = buildSepayTransferInfo({
    amount: Number(row.transfer_amount),
    transferCode: code || row.transfer_note,
    description: row.transfer_note,
  });
  return {
    request: {
      id: row.id,
      plan: row.plan,
      billing: row.billing,
      renewPrice: Number(row.renew_price),
      transferAmount: Number(row.transfer_amount),
      hoursToAdd: Number(row.hours_to_add),
      transferNote: row.transfer_note,
      transferCode: code,
      status: row.status,
      createdAt: row.created_at,
    },
    transfer: {
      bankName: sepay.bankName,
      accountNumber: sepay.accountNumber,
      accountName: sepay.accountName,
      amount: sepay.amount,
      transferNote: row.transfer_note,
      transferCode: code || sepay.transferCode,
      transferContent: sepay.transferContent,
      expectedMinutes: sepay.expectedMinutes,
      expectedLabel: sepay.expectedLabel,
      qrUrl: sepay.qrUrl,
    },
  };
}

async function loadRenewContext(supabaseAdmin, userId, plan, billing, subscriptionId) {
  let subscription = null;
  if (subscriptionId) {
    const { data: sub, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('id, plan, billing, hours_total, hours_used, status, expires_at')
      .eq('id', subscriptionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (subError) throw subError;
    subscription = sub ?? null;
  }

  if (!subscription) {
    let query = supabaseAdmin
      .from('subscriptions')
      .select('id, plan, billing, hours_total, hours_used, status, expires_at')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (plan) query = query.eq('plan', plan);
    if (billing) query = query.eq('billing', billing);
    const { data: sub } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    subscription = sub ?? null;
  }

  if (!subscription) {
    return { error: 'Không tìm thấy gói phù hợp để tái tục.' };
  }
  if (subscription.status !== 'active') {
    return { error: 'Gói này không còn hoạt động, không thể tái tục.' };
  }

  const remainingRead = await loadScbRemainingForUser(supabaseAdmin, userId);
  const hoursRemaining = remainingRead.hoursRemaining ?? 0;

  const resolvedPlan = plan ?? subscription.plan;
  const resolvedBilling = billing ?? subscription.billing;

  const quote = computeRenewQuote(resolvedPlan, resolvedBilling, hoursRemaining, {
    isAutoRenew: false,
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

  return {
    subscription,
    quote,
    walletBalance,
    shortage,
    plan: resolvedPlan,
    billing: resolvedBilling,
  };
}

/**
 * Khách xác nhận đã chuyển khoản bổ sung để tái tục.
 */
export async function createPlanRenewTransferRequest(supabaseAdmin, userId, { plan, billing, subscriptionId }) {
  await ensureGpuPricingLoaded(supabaseAdmin);

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('plan_renew_requests')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) {
    return {
      success: true,
      alreadyPending: true,
      pending: formatPendingRenewResponse(existing),
    };
  }

  const ctx = await loadRenewContext(supabaseAdmin, userId, plan, billing, subscriptionId);
  if (ctx.error) return { error: ctx.error };

  if (ctx.shortage <= 0) {
    return { error: 'Số dư Ví đủ để tái tục ngay — không cần chuyển khoản bổ sung.' };
  }

  const now = new Date().toISOString();
  const transferCode = await allocateTransferCode(supabaseAdmin);
  // Nội dung CK = mã 4 ký tự (GDxx)
  const transferNote = transferCode;

  const { data: row, error: insertError } = await supabaseAdmin
    .from('plan_renew_requests')
    .insert({
      user_id: userId,
      subscription_id: ctx.subscription?.id ?? null,
      plan: ctx.quote.planName,
      billing: ctx.quote.billing,
      renew_price: ctx.quote.price,
      transfer_amount: ctx.shortage,
      wallet_balance: ctx.walletBalance,
      hours_to_add: ctx.quote.totalHours,
      transfer_note: transferNote,
      status: 'pending',
      updated_at: now,
    })
    .select('*')
    .single();

  if (insertError) throw insertError;

  await notifyPlanRenewPending(supabaseAdmin, {
    userId,
    planName: ctx.quote.planName,
    transferAmount: ctx.shortage,
    renewPrice: ctx.quote.price,
  });

  return {
    success: true,
    pending: formatPendingRenewResponse(row),
  };
}

/**
 * Admin duyệt: cộng tiền CK vào Ví rồi thực hiện tái tục.
 */
export async function approvePlanRenewRequest(supabaseAdmin, requestId) {
  await ensureGpuPricingLoaded(supabaseAdmin);

  const { data: req, error: fetchError } = await supabaseAdmin
    .from('plan_renew_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!req) return { error: 'Không tìm thấy yêu cầu tái tục đang chờ duyệt.' };

  const transferAmount = Number(req.transfer_amount);
  const now = new Date().toISOString();

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('wallet_balance')
    .eq('id', req.user_id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) return { error: 'Không tìm thấy tài khoản khách hàng.' };

  const walletBalance = Number(profile.wallet_balance ?? 0);
  const balanceAfterCredit = walletBalance + transferAmount;

  const { error: walletError } = await supabaseAdmin
    .from('users')
    .update({ wallet_balance: balanceAfterCredit, updated_at: now })
    .eq('id', req.user_id);

  if (walletError) throw walletError;

  await supabaseAdmin.from('wallet_transactions').insert({
    user_id: req.user_id,
    type: 'deposit',
    amount: transferAmount,
    bonus_amount: 0,
    balance_after: balanceAfterCredit,
    description: `CK bổ sung tái tục ${req.plan} ${req.billing}`,
    status: 'completed',
    updated_at: now,
  });

  const renewResult = await processPlanRenew(supabaseAdmin, req.user_id, {
    plan: req.plan,
    billing: req.billing,
    subscriptionId: req.subscription_id ?? null,
    isAutoRenew: false,
  });

  if (renewResult.error === 'insufficient') {
    return {
      error:
        'Đã cộng tiền CK vào Ví nhưng số dư vẫn chưa đủ tái tục (có thể giá đã thay đổi). Xử lý thủ công hoặc yêu cầu khách bổ sung thêm.',
      walletBalance: balanceAfterCredit,
    };
  }

  if (renewResult.error) {
    return { error: renewResult.error };
  }

  await supabaseAdmin
    .from('plan_renew_requests')
    .update({
      status: 'approved',
      processed_at: now,
      updated_at: now,
    })
    .eq('id', requestId);

  await notifyPlanRenewApproved(supabaseAdmin, {
    userId: req.user_id,
    planName: renewResult.quote?.planName ?? req.plan,
    hoursAdded: renewResult.hoursAdded,
    amountCharged: renewResult.quote?.price ?? Number(req.renew_price),
  });

  return {
    success: true,
    requestId,
    ...renewResult,
  };
}

/**
 * Admin từ chối yêu cầu tái tục qua CK.
 */
export async function rejectPlanRenewRequest(supabaseAdmin, requestId, reason) {
  const { data: req, error: fetchError } = await supabaseAdmin
    .from('plan_renew_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!req) return { error: 'Không tìm thấy yêu cầu tái tục đang chờ duyệt.' };

  const now = new Date().toISOString();
  const rejectReason = reason?.trim() || null;

  const { error: updateError } = await supabaseAdmin
    .from('plan_renew_requests')
    .update({
      status: 'rejected',
      reject_reason: rejectReason,
      processed_at: now,
      updated_at: now,
    })
    .eq('id', requestId);

  if (updateError) throw updateError;

  await notifyPlanRenewRejected(supabaseAdmin, {
    userId: req.user_id,
    planName: req.plan,
    transferAmount: Number(req.transfer_amount),
    reason: rejectReason,
  });

  return { success: true, userId: req.user_id };
}

export async function fetchPendingPlanRenewRequests(supabaseAdmin) {
  const { data: rows, error } = await supabaseAdmin
    .from('plan_renew_requests')
    .select(
      'id, user_id, plan, billing, renew_price, transfer_amount, wallet_balance, hours_to_add, transfer_note, created_at',
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const userIds = [...new Set((rows ?? []).map((r) => r.user_id))];
  if (userIds.length === 0) return [];

  const { data: users, error: usersError } = await supabaseAdmin
    .from('users')
    .select('id, email, phone, full_name')
    .in('id', userIds);

  if (usersError) throw usersError;

  const usersById = Object.fromEntries((users ?? []).map((u) => [u.id, u]));

  return (rows ?? []).map((row) => ({
    type: 'plan_renew',
    id: row.id,
    user_id: row.user_id,
    created_at: row.created_at,
    user: usersById[row.user_id] ?? null,
    plan_name: row.plan,
    plan: row.plan,
    billing: row.billing,
    renew_price: Number(row.renew_price),
    transfer_amount: Number(row.transfer_amount),
    wallet_balance: Number(row.wallet_balance),
    hours_to_add: Number(row.hours_to_add),
    transfer_note: row.transfer_note,
  }));
}
