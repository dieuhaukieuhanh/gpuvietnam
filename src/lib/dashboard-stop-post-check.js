/**
 * Client post-check after stop/destroy API — presentation + poll policy only.
 * Server still owns provider verify-destroyed before closing the session.
 */

/** @typedef {'confirmed'|'pending'|'still_active'} StopPostCheckVerdict */

export const STOP_POST_CHECK = Object.freeze({
  /** ~24s wall clock with default interval */
  maxAttempts: 12,
  intervalMs: 2_000,
});

export const STOP_POST_CHECK_COPY = Object.freeze({
  verifying:
    'Đang xác nhận máy đã tắt (GPU + phiên trên hệ thống)…',
  verifyingHint: 'Không đóng trang — vài giây nữa sẽ có kết quả.',
  verifyingButton: 'Đang xác nhận tắt máy...',
  sessionCallout: 'Đang xác nhận máy đã tắt — timer tạm dừng',
  timerCaption: 'Đang xác nhận tắt máy · timer dừng',
  success: 'Đã tắt máy · đã xác nhận GPU và phiên đóng',
  successAlreadyStopped: 'Phiên đã đóng · đã xác nhận trên hệ thống',
  apiFailed:
    'Chưa xác nhận được máy đã tắt. GPU có thể vẫn đang chạy — vui lòng thử lại sau vài giây.',
  networkFailed: 'Lỗi mạng khi tắt máy. Chưa xác nhận được trạng thái — vui lòng thử lại.',
  postCheckFailed:
    'Chưa xác nhận được máy đã tắt trên GPU/DB. Máy có thể vẫn đang chạy và tính giờ — vui lòng thử lại.',
  backupChoiceTitle: 'Chưa lưu xong dữ liệu',
  backupChoiceBody:
    'Hệ thống chưa backup xong lên bộ nhớ trước khi tắt máy. Bạn muốn tắt ngay (có thể mất dữ liệu chưa sync) hay tiếp tục chờ lưu?',
  backupForceStop: 'Tắt ngay (không chờ backup)',
  backupWait: 'Tiếp tục chờ lưu dữ liệu',
  backupSaving: 'Đang lưu dữ liệu trước khi tắt máy…',
  backupWaitingLonger: 'Đang chờ lưu dữ liệu thêm (có thể mất tới ~90 giây)…',
});

/**
 * @param {{
 *   phase?: string | null;
 *   billingStarted?: boolean | null;
 * }} snapshot
 * @returns {StopPostCheckVerdict}
 */
export function evaluateStopPostCheckSnapshot(snapshot) {
  const phase = String(snapshot?.phase ?? '');
  const billingStarted = Boolean(snapshot?.billingStarted);

  if (phase === 'idle' && !billingStarted) return 'confirmed';
  if (
    phase === 'running' ||
    phase === 'opening' ||
    phase === 'disconnected' ||
    phase === 'error'
  ) {
    return 'still_active';
  }
  if (phase === 'stopping' || phase === 'loading' || phase === '') return 'pending';
  return 'pending';
}

/**
 * @param {{ alreadyStopped?: boolean; settlementStatus?: string | null }} [opts]
 */
export function formatStopPostCheckSuccessToast(opts = {}) {
  if (opts.alreadyStopped) return STOP_POST_CHECK_COPY.successAlreadyStopped;
  if (opts.settlementStatus) {
    return `${STOP_POST_CHECK_COPY.success} · settlement: ${opts.settlementStatus}`;
  }
  return STOP_POST_CHECK_COPY.success;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function waitStopPostCheckInterval(ms = STOP_POST_CHECK.intervalMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
