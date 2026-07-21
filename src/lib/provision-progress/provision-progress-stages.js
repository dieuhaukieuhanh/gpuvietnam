/**
 * Canonical provision progress stages (single active stage at a time).
 */

export const PROVISION_STAGE = {
  OFFLINE: 'OFFLINE',
  CHECKING_ACCOUNT: 'CHECKING_ACCOUNT',
  CHECKING_WALLET: 'CHECKING_WALLET',
  SEARCHING_GPU: 'SEARCHING_GPU',
  SELECTING_HOST: 'SELECTING_HOST',
  CREATING_ORDER: 'CREATING_ORDER',
  RECOVERING_ORDER_ID: 'RECOVERING_ORDER_ID',
  CREATING_MACHINE: 'CREATING_MACHINE',
  BOOTING_MACHINE: 'BOOTING_MACHINE',
  WAITING_FOR_NETWORK: 'WAITING_FOR_NETWORK',
  STARTING_COMFY: 'STARTING_COMFY',
  VERIFYING_HEALTH: 'VERIFYING_HEALTH',
  RUNNING: 'RUNNING',
  FAILED: 'FAILED',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
};

/** Ordered active boot path (for percent + timeline). */
export const PROVISION_STAGE_ORDER = [
  PROVISION_STAGE.CHECKING_ACCOUNT,
  PROVISION_STAGE.CHECKING_WALLET,
  PROVISION_STAGE.SEARCHING_GPU,
  PROVISION_STAGE.SELECTING_HOST,
  PROVISION_STAGE.CREATING_ORDER,
  PROVISION_STAGE.RECOVERING_ORDER_ID,
  PROVISION_STAGE.CREATING_MACHINE,
  PROVISION_STAGE.BOOTING_MACHINE,
  PROVISION_STAGE.WAITING_FOR_NETWORK,
  PROVISION_STAGE.STARTING_COMFY,
  PROVISION_STAGE.VERIFYING_HEALTH,
  PROVISION_STAGE.RUNNING,
];

/** User-facing timeline steps (subset shown in UI). */
export const PROVISION_TIMELINE_STEPS = [
  { stage: PROVISION_STAGE.CHECKING_ACCOUNT, label: 'Checking account' },
  { stage: PROVISION_STAGE.SEARCHING_GPU, label: 'Finding configuration' },
  { stage: PROVISION_STAGE.BOOTING_MACHINE, label: 'Booting machine' },
  { stage: PROVISION_STAGE.STARTING_COMFY, label: 'Starting ComfyUI' },
  { stage: PROVISION_STAGE.RUNNING, label: 'Ready' },
];

/** Vietnamese labels for dashboard. */
export const PROVISION_STAGE_LABELS_VI = {
  OFFLINE: 'Chưa mở phiên',
  CHECKING_ACCOUNT: 'Đang kiểm tra tài khoản',
  CHECKING_WALLET: 'Đang kiểm tra tài khoản',
  SEARCHING_GPU: 'Đang tìm cấu hình',
  SELECTING_HOST: 'Đang tìm cấu hình',
  CREATING_ORDER: 'Đang tìm cấu hình',
  RECOVERING_ORDER_ID: 'Đang tìm cấu hình',
  CREATING_MACHINE: 'Đang khởi động máy',
  BOOTING_MACHINE: 'Đang khởi động máy',
  WAITING_FOR_NETWORK: 'Đang khởi động máy',
  STARTING_COMFY: 'Đang khởi động ComfyUI',
  VERIFYING_HEALTH: 'Đang khởi động ComfyUI',
  RUNNING: 'Sẵn sàng',
  FAILED: 'Khởi tạo thất bại',
  STOPPING: 'Đang đóng phiên',
  STOPPED: 'Đã đóng',
};

/**
 * Typical remaining time from this stage to RUNNING (ms).
 * Used for estimates; refined as stages advance.
 */
export const PROVISION_STAGE_REMAINING_MS = {
  CHECKING_ACCOUNT: 180_000,
  CHECKING_WALLET: 170_000,
  SEARCHING_GPU: 150_000,
  SELECTING_HOST: 130_000,
  CREATING_ORDER: 120_000,
  RECOVERING_ORDER_ID: 90_000,
  CREATING_MACHINE: 75_000,
  BOOTING_MACHINE: 60_000,
  WAITING_FOR_NETWORK: 45_000,
  STARTING_COMFY: 30_000,
  VERIFYING_HEALTH: 15_000,
  RUNNING: 0,
  FAILED: 0,
  STOPPING: 20_000,
  STOPPED: 0,
  OFFLINE: 0,
};

/**
 * Map legacy onProgress tick strings → canonical stage.
 * @param {string} step
 * @returns {string}
 */
export function mapProgressTickToStage(step) {
  const s = String(step ?? '').toLowerCase();
  if (!s || s === 'provision_start' || s === 'start_accepted' || s === 'auto' || s === 'progress') {
    return PROVISION_STAGE.CHECKING_ACCOUNT;
  }
  if (s.includes('wallet')) return PROVISION_STAGE.CHECKING_WALLET;
  if (
    s.includes('marketplace') ||
    s.includes('search') ||
    s === 'marketplace_refetch'
  ) {
    return PROVISION_STAGE.SEARCHING_GPU;
  }
  if (
    s.includes('offer_selection') ||
    s.includes('select') ||
    s.includes('provider_attempt') ||
    s.includes('retry_host_switch') ||
    s.includes('retry_provider_switch')
  ) {
    return PROVISION_STAGE.SELECTING_HOST;
  }
  if (s.includes('order_id_recovery') || s === 'recover' || s.startsWith('recover_')) {
    return PROVISION_STAGE.RECOVERING_ORDER_ID;
  }
  if (
    s.includes('create_order') ||
    s.includes('rate_limit') ||
    s.includes('offer_retry') ||
    s.includes('retry_wait') ||
    s === 'retrying' ||
    (s.includes('retry') && !s.includes('recover'))
  ) {
    return PROVISION_STAGE.CREATING_ORDER;
  }
  if (s.includes('instance_rented') || s === 'machine_insert') {
    return PROVISION_STAGE.CREATING_MACHINE;
  }
  // Post-rent gate (SSH / ports / nvidia / comfy) — machine is already allocated.
  if (s.includes('provision_gate') || s === 'gate' || s.includes('gate_')) {
    return PROVISION_STAGE.BOOTING_MACHINE;
  }
  if (s.includes('machine_created') || s.includes('session_create')) {
    return PROVISION_STAGE.BOOTING_MACHINE;
  }
  if (s.includes('status_poll') || s.includes('network') || s.includes('endpoint')) {
    return PROVISION_STAGE.WAITING_FOR_NETWORK;
  }
  if (s.includes('comfy_ready') || s === 'ready') return PROVISION_STAGE.RUNNING;
  // Smart Restore ticks — machine already running; do not regress stage.
  if (s.startsWith('workspace_')) return PROVISION_STAGE.RUNNING;
  if (s.includes('health') || s.includes('comfy')) return PROVISION_STAGE.STARTING_COMFY;
  if (s.includes('fail') || s.includes('error')) return PROVISION_STAGE.FAILED;
  if (s.includes('destroy') || s.includes('stop')) return PROVISION_STAGE.STOPPING;
  return PROVISION_STAGE.CHECKING_ACCOUNT;
}

/**
 * User-facing progress copy for retry / wait ticks.
 * @param {string | null | undefined} step
 * @returns {{ message: string; messageVi: string } | null}
 */
export function messageForProgressTick(step) {
  const s = String(step ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('retry_wait') || s.includes('rate_limit_wait') || s.includes('waiting')) {
    return { message: 'Waiting for provider...', messageVi: 'Đang chờ provider...' };
  }
  if (s.includes('retry_host_switch') || s.includes('offer_retry')) {
    return { message: 'Trying another host...', messageVi: 'Đang thử host khác...' };
  }
  if (s.includes('marketplace_refetch') || s.includes('marketplace_refresh')) {
    return { message: 'Refreshing marketplace...', messageVi: 'Đang làm mới marketplace...' };
  }
  if (s.includes('retry_provider_switch')) {
    return { message: 'Trying another provider...', messageVi: 'Đang chuyển provider...' };
  }
  if (s === 'retrying' || s.includes('create_order_retry')) {
    return { message: 'Retrying...', messageVi: 'Đang thử lại...' };
  }
  if (s === 'workspace_restoring') {
    return {
      message: 'Restoring workspace...',
      messageVi: 'Đang khôi phục Workspace...',
    };
  }
  if (s === 'workspace_choice') {
    return {
      message: 'Workspace restore available',
      messageVi: 'Có thể khôi phục Workspace từ phiên trước',
    };
  }
  if (s === 'workspace_ready') {
    return { message: 'Workspace ready', messageVi: 'Workspace sẵn sàng' };
  }
  if (s === 'workspace_skipped') {
    return {
      message: 'Starting fresh session',
      messageVi: 'Đang dùng phiên mới (Backup vẫn giữ trên cloud)',
    };
  }
  if (s === 'workspace_failed') {
    return {
      message: 'Workspace restore failed',
      messageVi: 'Khôi phục Workspace thất bại — vẫn vào được ComfyUI',
    };
  }
  return null;
}

/**
 * Infer stage from Session Resume state when no progress record exists.
 * @param {string} resumeState
 */
export function mapResumeStateToStage(resumeState) {
  switch (String(resumeState ?? '')) {
    case 'PROVISIONING':
      return PROVISION_STAGE.CREATING_ORDER;
    case 'BOOTING':
      return PROVISION_STAGE.BOOTING_MACHINE;
    case 'STARTING_COMFY':
      return PROVISION_STAGE.STARTING_COMFY;
    case 'RUNNING':
      return PROVISION_STAGE.RUNNING;
    case 'STOPPING':
      return PROVISION_STAGE.STOPPING;
    case 'ERROR':
      return PROVISION_STAGE.FAILED;
    case 'RESUMING':
      return PROVISION_STAGE.CHECKING_ACCOUNT;
    default:
      return PROVISION_STAGE.OFFLINE;
  }
}

/**
 * @param {string} stage
 * @returns {number} 0–100
 */
export function progressPercentForStage(stage) {
  if (stage === PROVISION_STAGE.FAILED) return 0;
  if (stage === PROVISION_STAGE.STOPPING) return 90;
  if (stage === PROVISION_STAGE.STOPPED || stage === PROVISION_STAGE.OFFLINE) return 0;
  const idx = PROVISION_STAGE_ORDER.indexOf(stage);
  if (idx < 0) return 0;
  if (stage === PROVISION_STAGE.RUNNING) return 100;
  return Math.round((idx / (PROVISION_STAGE_ORDER.length - 1)) * 100);
}

/**
 * @param {number | null | undefined} ms
 * @returns {string}
 */
export function formatEstimatedRemaining(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return 'Almost ready';
  if (ms < 45_000) return 'About 30 seconds remaining';
  if (ms < 90_000) return 'About 1 minute remaining';
  if (ms < 150_000) return 'About 2 minutes remaining';
  return 'About 3 minutes remaining';
}

/**
 * @param {number | null | undefined} ms
 * @returns {string}
 */
export function formatEstimatedRemainingVi(ms) {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return 'sắp xong';
  if (ms < 45_000) return 'còn khoảng 30 giây';
  if (ms < 90_000) return 'còn khoảng 1 phút';
  if (ms < 150_000) return 'còn khoảng 2 phút';
  return 'còn khoảng 3 phút';
}