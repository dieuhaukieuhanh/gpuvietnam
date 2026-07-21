import { getPlanNameFromKey } from '@/lib/gpu-pricing';
import { routes } from '@/lib/routes';

export const NOTIFICATION_TYPES = {
  HOUR_GRANT: 'hour_grant',
  PAYMENT_SUCCESS: 'payment_success',
  PLAN_RENEW_PENDING: 'plan_renew_pending',
  PLAN_RENEW: 'plan_renew',
  LOW_HOURS: 'low_hours',
  EXPIRING: 'expiring',
  MAINTENANCE: 'maintenance',
  AUTO_STOP: 'auto_stop',
  IDLE_WARNING: 'idle_warning',
  CREDIT_WARNING: 'credit_warning',
  BACKUP_STARTED: 'backup_started',
  SUPPORT_REQUEST: 'support_request',
  SUPPORT_ACTIVE: 'support_active',
};

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string | null;
 *   type: string;
 *   title: string;
 *   message?: string | null;
 *   link?: string | null;
 * }} payload
 */
export async function createUserNotification(supabaseAdmin, payload) {
  const { userId, type, title, message = null, link = null } = payload;

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title,
      message,
      link,
      is_read: false,
    })
    .select('id, user_id, type, title, message, link, is_read, created_at')
    .single();

  if (error) {
    console.warn('[user-notifications] create failed:', error.message);
    return null;
  }

  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 */
export async function notifyHourGrant(supabaseAdmin, { userId, hours, gpuPlan }) {
  const planName = getPlanNameFromKey(gpuPlan) ?? gpuPlan ?? 'Pro';
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.HOUR_GRANT,
    title: `🎁 Bạn được tặng ${hours}h gói ${planName}`,
    message: `Admin đã tặng bạn ${hours} giờ sử dụng gói ${planName}.`,
    link: routes.dashboardGoiCuaToi,
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 */
export async function notifyPaymentSuccess(supabaseAdmin, { userId, planName, amountLabel }) {
  const detail = amountLabel ? `Số tiền: ${amountLabel}.` : null;
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.PAYMENT_SUCCESS,
    title: '✅ Thanh toán thành công',
    message: planName ? `Gói ${planName} đã được kích hoạt.${detail ? ` ${detail}` : ''}` : detail,
    link: routes.dashboardGoiCuaToi,
  });
}

export async function notifyWalletDepositApproved(supabaseAdmin, { userId, amount, newBalance }) {
  const amountLabel = `${Number(amount).toLocaleString('vi-VN')}đ`;
  const balanceLabel = `${Number(newBalance).toLocaleString('vi-VN')}đ`;
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.PAYMENT_SUCCESS,
    title: `✅ Nạp ${amountLabel} thành công — Số dư: ${balanceLabel}`,
    message: 'Yêu cầu nạp Ví đã được Admin duyệt.',
    link: routes.dashboardWallet,
  });
}

export async function notifyWalletDepositRejected(supabaseAdmin, { userId, amount }) {
  const amountLabel = `${Number(amount).toLocaleString('vi-VN')}đ`;
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.LOW_HOURS,
    title: `❌ Nạp ${amountLabel} bị từ chối — Liên hệ hỗ trợ`,
    message: 'Vui lòng kiểm tra lại thông tin chuyển khoản hoặc liên hệ bộ phận hỗ trợ.',
    link: routes.dashboardWallet,
  });
}

export async function notifyPlanRenewPending(supabaseAdmin, { userId, planName, transferAmount, renewPrice }) {
  const transferLabel = `${Number(transferAmount).toLocaleString('vi-VN')}đ`;
  const renewLabel = `${Number(renewPrice).toLocaleString('vi-VN')}đ`;
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.PLAN_RENEW_PENDING,
    title: `⏳ Yêu cầu tái tục ${planName} đang chờ duyệt`,
    message: `Admin sẽ xác nhận chuyển khoản bổ sung ${transferLabel} (tổng tái tục ${renewLabel}) trong 5–15 phút.`,
    link: routes.dashboardGoiCuaToi,
  });
}

export async function notifyPlanRenewApproved(supabaseAdmin, { userId, planName, hoursAdded, amountCharged }) {
  const amountLabel = `${Number(amountCharged).toLocaleString('vi-VN')}đ`;
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.PLAN_RENEW,
    title: `✅ Tái tục ${planName} thành công — +${hoursAdded}h`,
    message: `Admin đã duyệt chuyển khoản và kích hoạt tái tục. Số tiền trừ Ví: ${amountLabel}.`,
    link: routes.dashboardGoiCuaToi,
  });
}

export async function notifyPlanRenewRejected(supabaseAdmin, { userId, planName, transferAmount, reason }) {
  const transferLabel = `${Number(transferAmount).toLocaleString('vi-VN')}đ`;
  const detail = reason ? ` Lý do: ${reason}.` : '';
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.LOW_HOURS,
    title: `❌ Tái tục ${planName} bị từ chối`,
    message: `Yêu cầu chuyển khoản bổ sung ${transferLabel} chưa được duyệt.${detail} Liên hệ hỗ trợ nếu cần.`,
    link: routes.dashboardGoiCuaToi,
  });
}

/** Hook sẵn sàng — gọi khi giờ còn lại dưới ngưỡng. */
export async function notifyLowHours(supabaseAdmin, { userId, hoursLeft, planName }) {
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.LOW_HOURS,
    title: '⚠️ Sắp hết giờ',
    message: `Gói ${planName ?? 'GPU'} của bạn còn ${hoursLeft} giờ.`,
    link: routes.dashboardGoiCuaToi,
  });
}

/** Hook sẵn sàng — gọi khi gói sắp hết hạn. */
export async function notifyExpiringPlan(supabaseAdmin, { userId, planName, expiresAt }) {
  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString('vi-VN')
    : 'sắp tới';
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.EXPIRING,
    title: '⚠️ Gói sắp hết hạn',
    message: `Gói ${planName ?? 'GPU'} hết hạn ${expiryLabel}.`,
    link: routes.dashboardGoiCuaToi,
  });
}

export async function notifySupportRequestToCustomer(supabaseAdmin, { userId, sessionId }) {
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.SUPPORT_REQUEST,
    title: '👁 Admin muốn xem màn hình để hỗ trợ bạn',
    message: `Admin gửi đề nghị xem màn hình làm việc của bạn.\n\n⚠️ Admin chỉ có thể XEM, không thể thao tác.\n⏱️ Phiên hỗ trợ tự động kết thúc sau 30 phút.`,
    link: `${routes.dashboard}?supportSession=${sessionId}`,
  });
}

export async function notifyAdminMachineStopped(supabaseAdmin, { userId, backupSuccess = false }) {
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: backupSuccess ? '✅ Admin đã tắt máy — dữ liệu đã lưu' : '⏹️ Admin đã tắt máy của bạn',
    message: backupSuccess
      ? 'Admin đã tắt máy GPU. Dữ liệu đã được backup — khôi phục từ tab Bộ nhớ khi bật máy lại.'
      : 'Máy GPU của bạn đã được Admin tắt. Bạn có thể khởi động lại từ Dashboard khi cần.',
    link: backupSuccess ? routes.dashboardStorage : routes.dashboard,
  });
}

export async function notifyUserMachineStopped(supabaseAdmin, { userId, backupSuccess = false }) {
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.AUTO_STOP,
    title: backupSuccess ? '✅ Máy đã tắt và dữ liệu đã được lưu' : '⏹️ Máy đã tắt',
    message: backupSuccess
      ? 'Dữ liệu đã được backup an toàn. Khôi phục từ tab Bộ nhớ khi bật máy lại.'
      : 'Máy GPU đã tắt. Backup không thực hiện được hoặc máy chưa có dữ liệu.',
    link: routes.dashboardStorage,
  });
}

export async function notifyAdminMachineStarted(supabaseAdmin, { userId, planName }) {
  const planLabel = planName ? ` gói ${planName}` : '';
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.MAINTENANCE,
    title: '🚀 Admin đã khởi động máy cho bạn',
    message: `Admin đã bắt đầu khởi động máy GPU${planLabel}. Máy sẽ sẵn sàng trong khoảng 2 phút.`,
    link: routes.dashboard,
  });
}

export async function notifyAutoStopOutOfCredit(supabaseAdmin, { userId, backupSuccess = false }) {
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.AUTO_STOP,
    title: backupSuccess ? '✅ Máy đã tắt và dữ liệu đã được lưu' : '⏰ Máy đã tự động tắt',
    message: backupSuccess
      ? 'Máy đã tắt vì hết giờ. Dữ liệu đã được backup — lần sau mở máy có thể khôi phục từ tab Bộ nhớ.'
      : 'Máy đã tự động tắt vì bạn đã hết giờ sử dụng. Nạp thêm để tiếp tục.',
    link: backupSuccess ? routes.dashboardStorage : routes.dashboardGoiCuaToi,
  });
}

export async function notifyAutoStopIdle(supabaseAdmin, { userId, backupSuccess = false }) {
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.AUTO_STOP,
    title: backupSuccess ? '✅ Máy đã tắt và dữ liệu đã được lưu' : '⏰ Máy đã tự động tắt',
    message: backupSuccess
      ? 'Máy đã tắt sau 1 giờ không sử dụng. Dữ liệu đã được lưu an toàn trên Backup.'
      : 'Máy đã tự động tắt sau 1 giờ không sử dụng. Backup thất bại — vui lòng liên hệ hỗ trợ nếu cần.',
    link: routes.dashboardStorage,
  });
}

export async function notifyBackupStarted(supabaseAdmin, { userId }) {
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.BACKUP_STARTED,
    title: '💾 Đang lưu dữ liệu của bạn...',
    message: 'Hệ thống đang tự động backup dữ liệu trước khi tắt máy.',
    link: routes.dashboardStorage,
  });
}

export async function notifyIdleWarning(supabaseAdmin, { userId }) {
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.IDLE_WARNING,
    title: '⚠️ Máy sắp tự động tắt',
    message: 'Máy sẽ tự động tắt sau 5 phút nếu không có hoạt động. Hãy chạy một job để giữ máy.',
    link: routes.dashboard,
  });
}

/** Notify ~30 minutes before out-of-credit auto-stop for the active package. */
export async function notifyCreditWarning(supabaseAdmin, { userId, minutesLeft = 30, planName }) {
  const minutes = Math.max(1, Math.ceil(Number(minutesLeft) || 30));
  const planLabel = planName ? ` gói ${planName}` : '';
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.CREDIT_WARNING,
    title: '⚠️ Máy sắp tắt vì hết giờ gói đang dùng',
    message: `Gói${planLabel} còn khoảng ${minutes} phút. Máy sẽ tự tắt khi hết giờ gói này (giờ ở gói khác không giữ máy). Hãy lưu công việc hoặc gia hạn.`,
    link: routes.dashboardGoiCuaToi,
  });
}

export async function notifySupportSessionActive(supabaseAdmin, { userId }) {
  return createUserNotification(supabaseAdmin, {
    userId,
    type: NOTIFICATION_TYPES.SUPPORT_ACTIVE,
    title: '🔴 Phiên hỗ trợ từ xa đang bật',
    message: 'Admin đang xem màn hình làm việc của bạn. Phiên tự kết thúc sau 30 phút.',
    link: routes.dashboard,
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function getUnreadNotificationCount(supabaseAdmin, userId) {
  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) throw error;
  return count ?? 0;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ limit?: number; offset?: number }} options
 */
export async function listUserNotifications(supabaseAdmin, userId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 50);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const { data, error, count } = await supabaseAdmin
    .from('notifications')
    .select('id, type, title, message, link, is_read, created_at', { count: 'exact' })
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;

  const unreadCount = await getUnreadNotificationCount(supabaseAdmin, userId);

  return {
    items: data ?? [],
    total: count ?? 0,
    unreadCount,
    limit,
    offset,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ id?: number; all?: boolean }} payload
 */
export async function markNotificationsRead(supabaseAdmin, userId, payload) {
  if (payload.all) {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw error;
    return { success: true };
  }

  const id = Number(payload.id);
  if (!Number.isFinite(id)) {
    return { error: 'Thiếu id thông báo.' };
  }

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return { error: 'Không tìm thấy thông báo.' };
  }

  return { success: true, id: data.id };
}
