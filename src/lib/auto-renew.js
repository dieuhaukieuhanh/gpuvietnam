import { getPlanPriceVnd } from '@/lib/plan-pricing';
import { ensureGpuPricingLoaded } from '@/lib/gpu-pricing-config';
import { loadScbRemainingForUser } from '@/lib/gpu/remaining-consumer';
import { processPlanRenew } from '@/lib/user-plan-inventory';
import {
  createUserNotification,
  NOTIFICATION_TYPES,
} from '@/lib/user-notifications';
import { getOrCreateUserSettings } from '@/lib/user-settings';
import { routes } from '@/lib/routes';

const ACTIVE_STATUSES = ['active', 'provisioning'];

export const DEFAULT_AUTO_RENEW_THRESHOLD = 10;
export const AUTO_RENEW_THRESHOLD_OPTIONS = [5, 10, 15, 20];
export const LOW_HOURS_NOTIFY_THRESHOLD = 10;

/**
 * @deprecated M10 — use M2 `loadScbRemainingForUser`. Kept for unit tests of threshold math.
 * @param {number | null | undefined} hoursRemaining
 */
export function getHoursRemainingFromScb(hoursRemaining) {
  return hoursRemaining != null ? hoursRemaining : null;
}

export function isWithinAutoRenewThreshold(hoursRemaining, threshold) {
  return hoursRemaining !== null && hoursRemaining <= threshold;
}

/**
 * Đánh giá trạng thái gia hạn tự động (không thực hiện giao dịch).
 */
export async function evaluateAutoRenew(supabaseAdmin, userId) {
  await ensureGpuPricingLoaded(supabaseAdmin);
  const settings = await getOrCreateUserSettings(supabaseAdmin, userId);
  const threshold = Number(settings.auto_renew_threshold ?? DEFAULT_AUTO_RENEW_THRESHOLD);

  const remainingRead = await loadScbRemainingForUser(supabaseAdmin, userId);
  const walletBalance = Number(remainingRead.walletBalance ?? 0);
  const hoursRemaining = remainingRead.hoursRemaining;

  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('id, plan, billing, status, expires_at')
    .eq('user_id', userId)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const enabled = Boolean(settings.auto_renew_enabled);
  const withinThreshold = isWithinAutoRenewThreshold(hoursRemaining, threshold);
  const renewPrice =
    subscription && subscription.billing !== 'hourly'
      ? getPlanPriceVnd(subscription.plan, subscription.billing)
      : 0;

  const walletMethod = settings.auto_renew_method === 'wallet';
  const canChargeWallet =
    enabled &&
    withinThreshold &&
    walletMethod &&
    renewPrice > 0 &&
    walletBalance >= renewPrice;

  let badge = null;
  if (enabled && withinThreshold && renewPrice > 0) {
    badge = canChargeWallet ? 'ready' : 'low_balance';
  }

  return {
    autoRenewThreshold: threshold,
    autoRenewEnabled: enabled,
    autoRenewMethod: settings.auto_renew_method,
    hoursRemaining,
    withinThreshold,
    renewPrice,
    walletBalance,
    canAutoRenew: canChargeWallet,
    badge,
    remainingState: remainingRead.remaining?.state ?? null,
    subscription: subscription
      ? { id: subscription.id, plan: subscription.plan, billing: subscription.billing }
      : null,
  };
}

/**
 * Thực hiện gia hạn tự động qua Ví nếu đủ điều kiện.
 */
export async function executeAutoRenew(supabaseAdmin, userId) {
  const evaluation = await evaluateAutoRenew(supabaseAdmin, userId);

  if (!evaluation.autoRenewEnabled) {
    return { action: 'skipped', reason: 'disabled', ...evaluation };
  }

  if (!evaluation.withinThreshold) {
    return {
      action: 'skipped',
      reason: 'above_threshold',
      message: `Còn ${evaluation.hoursRemaining}h — chưa cần gia hạn (ngưỡng ${evaluation.autoRenewThreshold}h).`,
      ...evaluation,
    };
  }

  if (!evaluation.subscription) {
    return { action: 'skipped', reason: 'no_subscription', ...evaluation };
  }

  if (evaluation.autoRenewMethod !== 'wallet') {
    return {
      action: 'manual_transfer',
      message: 'Gói sắp hết giờ. Vui lòng chuyển khoản để gia hạn.',
      ...evaluation,
    };
  }

  if (evaluation.subscription.billing === 'hourly' || evaluation.renewPrice <= 0) {
    return {
      action: 'skipped',
      reason: 'hourly_not_supported',
      message: 'Gia hạn tự động qua Ví chỉ áp dụng gói Combo.',
      ...evaluation,
    };
  }

  if (!evaluation.canAutoRenew) {
    await createUserNotification(supabaseAdmin, {
      userId,
      type: NOTIFICATION_TYPES.LOW_HOURS,
      title: '⚠️ Gia hạn tự động thất bại — nạp thêm',
      message: `Số dư Ví ${evaluation.walletBalance.toLocaleString('vi-VN')}đ không đủ để gia hạn ${evaluation.renewPrice.toLocaleString('vi-VN')}đ.`,
      link: routes.dashboardWallet,
    });
    return {
      action: 'insufficient_balance',
      message: 'Không đủ số dư',
      ...evaluation,
    };
  }

  const renewResult = await processPlanRenew(supabaseAdmin, userId, {
    plan: evaluation.subscription.plan,
    billing: evaluation.subscription.billing,
    isAutoRenew: true,
  });

  if (renewResult.error === 'insufficient') {
    await createUserNotification(supabaseAdmin, {
      userId,
      type: NOTIFICATION_TYPES.LOW_HOURS,
      title: '⚠️ Gia hạn tự động thất bại — nạp thêm',
      message: `Thiếu ${renewResult.shortage?.toLocaleString('vi-VN')}đ để gia hạn tự động.`,
      link: routes.dashboardWallet,
    });
    return {
      action: 'insufficient_balance',
      message: 'Không đủ số dư',
      ...evaluation,
    };
  }

  if (renewResult.error) {
    return { action: 'failed', message: renewResult.error, ...evaluation };
  }

  await createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.PAYMENT_SUCCESS,
    title: `🎁 Gia hạn tự động: +${renewResult.hoursAdded}h ${renewResult.quote?.planName ?? ''}`,
    message: `Đã tái tục tự động với thưởng ${renewResult.quote?.bonusLabel ?? '3%'} giờ.`,
    link: routes.dashboardGoiCuaToi,
  });

  return {
    action: 'renewed',
    message: `Đã gia hạn tự động — cộng ${renewResult.hoursAdded}h vào gói.`,
    hoursAdded: renewResult.hoursAdded,
    walletBalance: renewResult.walletBalance,
    amountCharged: renewResult.quote?.price,
    ...evaluation,
  };
}

/** Alias gọi từ Dashboard / auto-renew/check */
export async function executeAutoRenewCheck(supabaseAdmin, userId) {
  return executeAutoRenew(supabaseAdmin, userId);
}
