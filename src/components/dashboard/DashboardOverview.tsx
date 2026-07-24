import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import PlanSelectorModal, { type ActivePlan } from '@/components/dashboard/PlanSelectorModal';
import DashboardCurrentSessionCard from '@/components/dashboard/DashboardCurrentSessionCard';
import { type ProvisionProgressSnapshot } from '@/components/dashboard/DashboardSessionBootTimeline';
import DashboardRealtimePerfCard from '@/components/dashboard/DashboardRealtimePerfCard';
import DashboardStorageSummaryCard from '@/components/dashboard/DashboardStorageSummaryCard';
import DashboardRecentWorkflowsCard from '@/components/dashboard/DashboardRecentWorkflowsCard';
import DashboardRecentSessionsCard from '@/components/dashboard/DashboardRecentSessionsCard';
import DualRunSafetyCard from '@/components/dashboard/DualRunSafetyCard';
import DashboardRecentImagesMobile from '@/components/dashboard/DashboardRecentImagesMobile';
import {
  DashboardSupportActiveBanner,
  useSupportSessionStatus,
} from '@/components/dashboard/DashboardSupportCard';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useInterpolatedRemainingHours } from '@/hooks/useInterpolatedRemainingHours';
import { useSessionElapsedSeconds } from '@/hooks/useSessionElapsedSeconds';
import {
  getInventoryPlanBadge,
  notifyUserPlansChanged,
  useUserPlans,
  type UserInventoryPlan,
} from '@/hooks/useUserPlans';
import type {
  BillingSessionView,
  DashboardSubscription,
  DashboardUser,
  MachineSessionView,
} from '@/hooks/useDashboard';
import { formatCurrency } from '@/lib/gpu-pricing';
import { routes } from '@/lib/routes';
import {
  formatDisplayHours,
  formatRuntimeClock,
  resolveTimerDisplayMode,
} from '@/lib/dashboard-session-display';
import {
  STOP_POST_CHECK,
  STOP_POST_CHECK_COPY,
  evaluateStopPostCheckSnapshot,
  formatStopPostCheckSuccessToast,
  waitStopPostCheckInterval,
} from '@/lib/dashboard-stop-post-check';
import { clampPlanCardRemainingHours } from '@/lib/plan-card-display';
import {
  autostopToastMessage,
  buildIdleMachineSessionViewForUi,
  buildOptimisticOpeningMachineSessionView,
  buildOptimisticStoppingMachineSessionView,
  isComfyWorkspaceReady,
  resolveBootDisplayPhase,
  resolveServerCardPhase,
  serverCardStatusBadgeClass,
  serverCardStatusLabel,
} from '@/lib/scb-dashboard-machine-view';
import {
  pollIntervalMs,
  shouldPollInfra,
  useMachineInfraMetrics,
} from '@/hooks/useMachineInfraMetrics';
import { SupportCodeBlock } from '@/components/dashboard/SupportCodeBlock';
import { GPU_COMFY_WORKSTATION_IDS, resolveEnvName, workspaceDisplayFromEnvName } from '@/lib/workstation-env';
import { WORKSTATIONS, type Workstation } from '@/lib/workstations';

function extractRequestIdFromResponse(
  res: Response,
  data: { requestId?: string; supportCode?: string } | null,
): string | null {
  if (data?.requestId && typeof data.requestId === 'string') return data.requestId;
  const headerId = res.headers.get('x-request-id');
  if (headerId) return headerId;
  return null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN');
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function normalizePlanKey(planName: string): ActivePlan['plan'] | null {
  const key = String(planName ?? '')
    .trim()
    .toLowerCase();
  if (key === 'starter' || key === 'studio' || key === 'pro') return key;
  if (/\bstarter\b/i.test(planName) || /\brtx\s*3090\b/i.test(planName)) return 'starter';
  if (/\bstudio\b/i.test(planName) || /\b2\s*x\s*rtx\s*4090\b/i.test(planName)) return 'studio';
  if (/\bpro\b/i.test(planName) || /\brtx\s*4090\b/i.test(planName)) return 'pro';
  return null;
}

/** Workspace restore ticks that need UI attention while machine is already running. */
const WORKSPACE_PENDING_TICKS = new Set([
  'workspace_choice',
  'workspace_restoring',
  'workspace_failed',
]);

/** Copy for opening phase — never claim "ready" while card is still opening. */
function openingBootStatusMessage(
  progress: ProvisionProgressSnapshot | null | undefined,
): string {
  const stage = String(progress?.stage ?? '');
  const raw = progress?.message?.trim() || '';
  const eta = progress?.estimatedRemainingLabelVi?.trim() || '';

  let action = raw;
  if (
    !action ||
    stage === 'RUNNING' ||
    stage === 'OFFLINE' ||
    /^sẵn sàng$/i.test(action) ||
    /workspace sẵn sàng/i.test(action)
  ) {
    action =
      stage === 'RUNNING' || /^sẵn sàng$/i.test(raw)
        ? 'Đang hoàn tất khởi động'
        : 'Đang mở phiên làm việc';
  }

  if (!eta || stage === 'FAILED') {
    return action;
  }
  return `${action} · ${eta}`;
}

const WORKSPACE_PREFIX_LABELS: Record<string, string> = {
  workflows: 'Workflows',
  outputs: 'Outputs',
  settings: 'Cài đặt',
};

type WorkspaceClassification = {
  mode: 'empty' | 'auto' | 'choice';
  totalBytes: number;
  fileCount: number;
  byPrefix: Record<string, { bytes: number; count: number }>;
  thresholdBytes: number;
};

function formatWorkspaceBytes(bytes: number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / 1024 ** i;
  return `${value >= 10 || i === 0 ? value.toFixed(i >= 2 ? 1 : 0) : value.toFixed(1)} ${units[i]}`;
}

function formatWorkspaceBreakdown(classification: WorkspaceClassification | null): string {
  if (!classification || classification.fileCount <= 0) return '';
  const parts = Object.entries(classification.byPrefix)
    .filter(([, v]) => (v?.count ?? 0) > 0 || (v?.bytes ?? 0) > 0)
    .map(([prefix, v]) => {
      const label = WORKSPACE_PREFIX_LABELS[prefix] ?? prefix;
      return `${label} ${formatWorkspaceBytes(v.bytes)}`;
    });
  if (parts.length === 0) return '';
  return `${formatWorkspaceBytes(classification.totalBytes)} · ${classification.fileCount} mục · ${parts.join(' · ')}`;
}

function inventoryPlanToActivePlan(plan: UserInventoryPlan): ActivePlan | null {
  const planKey =
    plan.planKey === 'starter' || plan.planKey === 'pro' || plan.planKey === 'studio'
      ? plan.planKey
      : normalizePlanKey(plan.planName);
  if (!planKey) return null;
  return {
    id: String(plan.id),
    inventoryId: plan.id,
    subscriptionId: plan.subscriptionId,
    type: plan.planType === 'gift' ? 'gift' : 'main',
    plan_type: plan.planType,
    plan: planKey,
    gpu: plan.gpu,
    vram: plan.vram,
    hours_remaining: plan.hoursRemaining,
    price_per_hour: plan.pricePerHour,
    expires_at: plan.validUntil,
    label: `${plan.displayName} (${plan.gpu} · ${plan.vram})`,
    badge: getInventoryPlanBadge(plan),
  };
}

type PlanCardSnapshot = {
  displayName: string;
  gpu: string;
  vram: string;
  hoursTotal: number;
  hoursRemaining: number;
  validUntil: string | null;
  planType: UserInventoryPlan['planType'];
  billing: string | null;
};

function planCardFromSubscription(
  sub: DashboardSubscription,
  billing: BillingSessionView | null,
): PlanCardSnapshot {
  const planKey = normalizePlanKey(sub.plan);
  return {
    displayName: planKey
      ? planKey.charAt(0).toUpperCase() + planKey.slice(1)
      : String(sub.plan ?? 'Gói'),
    gpu: sub.gpu_label ?? 'GPU',
    vram: '',
    hoursTotal: sub.hours_total ?? billing?.planCardTotalHours ?? 0,
    hoursRemaining:
      billing?.planCardRemainingHours ??
      Math.max(0, Number(sub.hours_total ?? 0) - Number(sub.hours_used ?? 0)),
    validUntil: sub.expires_at,
    planType: sub.billing === 'hourly' ? 'hourly' : 'combo',
    billing: sub.billing,
  };
}

function planCardSnapshotFromInventory(plan: UserInventoryPlan): PlanCardSnapshot {
  return {
    displayName: plan.displayName,
    gpu: plan.gpu,
    vram: plan.vram,
    hoursTotal: plan.hoursTotal,
    hoursRemaining: plan.hoursRemaining,
    validUntil: plan.validUntil,
    planType: plan.planType,
    billing: plan.billing,
  };
}

type DashboardOverviewProps = {
  user: DashboardUser | null;
  subscription: DashboardSubscription | null;
  billingView: BillingSessionView | null;
  machineSessionView: MachineSessionView | null;
  loading: boolean;
  error: string;
  onRefresh: (options?: { silent?: boolean }) => void | Promise<void>;
  onMachineSessionView?: (view: MachineSessionView | null) => void;
  onBillingSessionView?: (view: BillingSessionView | null) => void;
};

export default function DashboardOverview({
  user,
  subscription,
  billingView,
  machineSessionView,
  loading,
  error,
  onRefresh,
  onMachineSessionView,
  onBillingSessionView,
}: DashboardOverviewProps) {
  const { session } = useAuth();
  const { isMobile, isTablet } = useIsMobile();
  const { displayPlan, usablePlans, loading: plansLoading, reload: reloadPlans } = useUserPlans(
    session?.access_token,
  );
  const [showPlanSelector, setShowPlanSelector] = useState(false);
  const [activePlans, setActivePlans] = useState<ActivePlan[]>([]);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showBackupChoice, setShowBackupChoice] = useState(false);
  const [backupChoiceMessage, setBackupChoiceMessage] = useState('');
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [stopPostCheckActive, setStopPostCheckActive] = useState(false);
  const [changingEnv, setChangingEnv] = useState(false);
  const [selectedEnvName, setSelectedEnvName] = useState('');
  const [sessionWorkspace, setSessionWorkspace] = useState<{ name: string; icon: string } | null>(
    null,
  );
  const [pendingStartPlan, setPendingStartPlan] = useState<ActivePlan | null>(null);
  const [loadingActivePlans, setLoadingActivePlans] = useState(false);
  const [isCancellingBoot, setIsCancellingBoot] = useState(false);
  const [startMessage, setStartMessage] = useState('');
  const [startSupportRequestId, setStartSupportRequestId] = useState<string | null>(null);
  const [provisionProgress, setProvisionProgress] = useState<ProvisionProgressSnapshot | null>(null);
  const [workspaceRestoreBusy, setWorkspaceRestoreBusy] = useState(false);
  const [workspaceClassification, setWorkspaceClassification] =
    useState<WorkspaceClassification | null>(null);
  const [toast, setToast] = useState('');
  const [showComfyMobileModal, setShowComfyMobileModal] = useState(false);
  const [comfyEnterUrl, setComfyEnterUrl] = useState<string | null>(null);
  const [isOpeningComfy, setIsOpeningComfy] = useState(false);
  const startMachineAbortRef = useRef<AbortController | null>(null);
  const cardHoursRemainingLiveRef = useRef<number | null>(null);
  const comfyEnterUrlRef = useRef<string | null>(null);

  const openComfyInNewTab = useCallback((url: string) => {
    // Real <a target=_blank> navigation — not window.open (popup policies).
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const handleAutostopRefresh = useCallback(async () => {
    notifyUserPlansChanged();
    await onRefresh({ silent: true });
    await reloadPlans({ silent: true });
  }, [onRefresh, reloadPlans]);

  const handleWorkspaceRestoreAction = useCallback(
    async (action: 'continue' | 'fresh') => {
      setWorkspaceRestoreBusy(true);
      if (action === 'continue') {
        setProvisionProgress((prev) =>
          prev
            ? {
                ...prev,
                tick: 'workspace_restoring',
                message: 'Đang khôi phục Workspace...',
              }
            : {
                stage: 'RUNNING',
                tick: 'workspace_restoring',
                message: 'Đang khôi phục Workspace...',
                progressPercent: 100,
              },
        );
      }
      try {
        const res = await fetch('/api/session/workspace-restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setToast(data.error ?? 'Không khôi phục được Workspace.');
          setProvisionProgress((prev) =>
            prev
              ? {
                  ...prev,
                  tick: 'workspace_failed',
                  message: 'Khôi phục Workspace thất bại — vẫn vào được ComfyUI',
                }
              : prev,
          );
          return;
        }
        if (data.action === 'failed') {
          setToast(
            data.message ??
              'Khôi phục Workspace thất bại. Bạn có thể thử lại hoặc mở ComfyUI ngay.',
          );
          setProvisionProgress((prev) =>
            prev
              ? {
                  ...prev,
                  tick: 'workspace_failed',
                  message: 'Khôi phục Workspace thất bại — vẫn vào được ComfyUI',
                }
              : prev,
          );
          return;
        }
        setToast(
          data.message ??
            (action === 'fresh'
              ? 'Đã mở phiên mới. Backup vẫn giữ trên cloud.'
              : 'Đã khôi phục Workspace.'),
        );
        setProvisionProgress((prev) =>
          prev
            ? {
                ...prev,
                tick: action === 'fresh' ? 'workspace_skipped' : 'workspace_ready',
                message:
                  action === 'fresh'
                    ? 'Đang dùng phiên mới (Backup vẫn giữ trên cloud)'
                    : 'Workspace sẵn sàng',
              }
            : prev,
        );
      } catch {
        setToast('Không khôi phục được Workspace.');
        setProvisionProgress((prev) =>
          prev
            ? {
                ...prev,
                tick: 'workspace_failed',
                message: 'Khôi phục Workspace thất bại — vẫn vào được ComfyUI',
              }
            : prev,
        );
      } finally {
        setWorkspaceRestoreBusy(false);
      }
    },
    [],
  );

  const router = useRouter();
  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.paid !== '1' && router.query.hoursAdded !== '1') return;
    void (async () => {
      notifyUserPlansChanged();
      await onRefresh({ silent: true });
      await reloadPlans({ silent: true });
      setToast('Đã cập nhật giờ gói.');
      const nextQuery = { ...router.query };
      delete nextQuery.paid;
      delete nextQuery.hoursAdded;
      void router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
    })();
  }, [router, onRefresh, reloadPlans]);

  const handleAutostopDetected = useCallback(
    async (message?: string | null) => {
      setToast(autostopToastMessage(message));
      await handleAutostopRefresh();
    },
    [handleAutostopRefresh],
  );

  const { metrics: machineMetrics, metricsLoaded, refreshMetrics } = useMachineInfraMetrics({
    accessToken: session?.access_token,
    phase: machineSessionView?.phase,
    onPollError: setStartMessage,
    onAutostopDetected: handleAutostopDetected,
  });

  const machineMetricsRef = useRef(machineMetrics);
  machineMetricsRef.current = machineMetrics;

  // Poll provision progress while opening, and while running if Workspace restore still needs UI.
  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    const phase = machineSessionView?.phase;
    if (phase !== 'opening' && phase !== 'running') return;

    let cancelled = false;
    let intervalId: number | null = null;

    const stopInterval = () => {
      if (intervalId == null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const pull = async () => {
      try {
        const res = await fetch('/api/user/provision-progress', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        if (data.progress) {
          setProvisionProgress(data.progress as ProvisionProgressSnapshot);
          const tick = String(data.progress.tick ?? '');
          // After refresh on a running machine: keep polling only while restore needs attention.
          if (phase === 'running' && tick && !WORKSPACE_PENDING_TICKS.has(tick)) {
            stopInterval();
          }
        } else if (phase === 'running') {
          stopInterval();
        }
      } catch {
        /* ignore transient poll errors */
      }
    };

    void pull();
    intervalId = window.setInterval(() => void pull(), 2500);
    return () => {
      cancelled = true;
      stopInterval();
    };
  }, [session?.access_token, machineSessionView?.phase]);

  // Load size breakdown for choice / failed restore UI (keep during restoring).
  useEffect(() => {
    const token = session?.access_token;
    const tick = provisionProgress?.tick;
    if (machineSessionView?.phase !== 'running') {
      setWorkspaceClassification(null);
      return;
    }
    if (tick === 'workspace_ready' || tick === 'workspace_skipped') {
      setWorkspaceClassification(null);
      return;
    }
    if (!token || (tick !== 'workspace_choice' && tick !== 'workspace_failed')) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/session/workspace-restore', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok || !data.classification) return;
        setWorkspaceClassification(data.classification as WorkspaceClassification);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.access_token, machineSessionView?.phase, provisionProgress?.tick]);

  useEffect(() => {
    if (subscription?.env_name && !changingEnv) {
      setSelectedEnvName(subscription.env_name);
    }
  }, [subscription?.env_name, changingEnv]);

  const effectiveEnvName = selectedEnvName || subscription?.env_name || '';

  useEffect(() => {
    if (machineSessionView?.phase === 'idle') {
      setSessionWorkspace(null);
    }
  }, [machineSessionView?.phase]);

  const { session: supportSession, reload: reloadSupportSession } = useSupportSessionStatus(
    session?.access_token,
  );

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    void fetch('/api/user/auto-renew/check', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [session?.access_token]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const syncDashboardAndInfra = useCallback(async () => {
    await Promise.all([onRefresh({ silent: true }), refreshMetrics()]);
  }, [onRefresh, refreshMetrics]);

  const syncDashboardAndInfraRef = useRef(syncDashboardAndInfra);
  syncDashboardAndInfraRef.current = syncDashboardAndInfra;
  const refreshMetricsRef = useRef(refreshMetrics);
  refreshMetricsRef.current = refreshMetrics;

  const lastFocusSyncRef = useRef(0);
  const viewPhaseRef = useRef(machineSessionView?.phase);
  viewPhaseRef.current = machineSessionView?.phase;
  const prevViewPhaseRef = useRef(machineSessionView?.phase);

  useEffect(() => {
    const prev = prevViewPhaseRef.current;
    const next = machineSessionView?.phase;
    if (prev !== 'running' && next === 'running') {
      void refreshMetricsRef.current();
    }
    if (prev === 'stopping' && next === 'idle') {
      void onRefresh({ silent: true });
      void reloadPlans({ silent: true });
      notifyUserPlansChanged();
    }
    prevViewPhaseRef.current = next;
  }, [machineSessionView?.phase, onRefresh, reloadPlans]);

  useEffect(() => {
    if (!session?.access_token) return undefined;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const phase = viewPhaseRef.current;
      const minGapMs = phase === 'opening' ? 3_000 : 1_500;
      const now = Date.now();
      if (now - lastFocusSyncRef.current < minGapMs) return;
      lastFocusSyncRef.current = now;
      void syncDashboardAndInfraRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [session?.access_token]);

  const infraPollActive = shouldPollInfra(machineSessionView?.phase);

  useEffect(() => {
    if (!session?.access_token || !infraPollActive) return undefined;

    let cancelled = false;

    const runPollLoop = async () => {
      while (!cancelled) {
        const waitMs = pollIntervalMs(
          viewPhaseRef.current,
          isComfyWorkspaceReady(machineMetricsRef.current),
        );
        await new Promise((resolve) => window.setTimeout(resolve, waitMs));
        if (cancelled) break;
        await syncDashboardAndInfraRef.current();
      }
    };

    void runPollLoop();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token, infraPollActive]);

  const viewPhase = machineSessionView?.phase;
  const billingStarted = Boolean(billingView?.billingStarted);
  // Keep ticking through optimistic "stopping" so a failed destroy does not zero the clock.
  // P0-B / P1: Runtime DEAD (disconnected/error) — wall-clock keeps ticking.
  const showLiveTimer =
    billingStarted &&
    (viewPhase === 'running' ||
      viewPhase === 'stopping' ||
      viewPhase === 'disconnected' ||
      viewPhase === 'error');

  const sessionActive =
    (viewPhase === 'running' ||
      viewPhase === 'disconnected' ||
      viewPhase === 'error' ||
      (viewPhase === 'opening' && billingStarted)) &&
    billingStarted;

  const planCardSessionActive =
    Boolean(billingView?.billingStarted) &&
    (viewPhase === 'running' ||
      viewPhase === 'disconnected' ||
      viewPhase === 'stopping' ||
      viewPhase === 'error');

  const sessionDurationSec = useSessionElapsedSeconds(
    billingView?.sessionDurationSeconds ?? 0,
    billingView?.billingStartedAt ?? null,
    billingView?.verifiedRunningAt ?? null,
    showLiveTimer,
  );

  const timerMode = resolveTimerDisplayMode(viewPhase, billingStarted);
  const serverDurationSec = billingView?.sessionDurationSeconds ?? 0;

  // Prefer API duration; if missing, pair remaining with the live elapsed so the
  // interpolator does not freeze at the last poll value (duration<=0 → no anchor).
  const remainingAnchorDurationSec =
    serverDurationSec > 0 ? serverDurationSec : Math.max(0, Math.floor(sessionDurationSec));

  const displaySessionRemainingHours = useInterpolatedRemainingHours(
    billingView?.planCardRemainingHours ?? billingView?.remainingHours ?? null,
    remainingAnchorDurationSec,
    sessionDurationSec,
    sessionActive,
  );

  const tierUsablePlans = (() => {
    // While a session is live, remaining must follow the applied GPU package
    // (Starter/Pro/Studio) — never mix hours from other packages.
    const sessionScopedKey =
      viewPhase === 'running' ||
      viewPhase === 'opening' ||
      viewPhase === 'disconnected' ||
      viewPhase === 'stopping'
        ? (billingView?.appliedPlanKey as 'starter' | 'pro' | 'studio' | null | undefined) ??
          normalizePlanKey(subscription?.plan ?? '') ??
          normalizePlanKey(subscription?.gpu_label ?? '')
        : null;
    const scopeKey =
      sessionScopedKey ??
      displayPlan?.planKey ??
      (displayPlan ? normalizePlanKey(displayPlan.planName) : null);
    if (!scopeKey) return [];
    return usablePlans.filter((p) => {
      const a = p.planKey ?? normalizePlanKey(p.planName);
      if (!a || a !== scopeKey) return false;
      // Include gift + combo + prepaid giờ lẻ; ví balance is not in inventory hours.
      return true;
    });
  })();
  const tierSumRemainingHours = tierUsablePlans.reduce((sum, p) => sum + Number(p.hoursRemaining ?? 0), 0);
  const tierSumTotalHours = tierUsablePlans.reduce((sum, p) => sum + Number(p.hoursTotal ?? 0), 0);
  const tierMaxDaysLeft = (() => {
    let maxDays: number | null = null;
    let maxValidUntil: string | null = null;
    for (const p of tierUsablePlans) {
      const until = p.validUntil ?? null;
      const d = daysUntil(until);
      if (d == null) continue;
      if (maxDays == null || d > maxDays) {
        maxDays = d;
        maxValidUntil = until;
      }
    }
    return { maxDays, maxValidUntil };
  })();
  const tierMaxDaysLeftValue = tierMaxDaysLeft.maxDays;
  const tierMaxValidUntil = tierMaxDaysLeft.maxValidUntil;

  const selectedPlanRemainingHours =
    // Live billable session: package pool remaining (gift+combo, no ví inflation).
    planCardSessionActive && billingView?.planCardRemainingHours != null
      ? Number(billingView.planCardRemainingHours)
      : planCardSessionActive && billingView?.remainingHours != null
        ? Number(billingView.remainingHours)
        : tierSumRemainingHours > 0
          ? tierSumRemainingHours
          : displayPlan?.hoursRemaining ??
            (subscription
              ? Math.max(0, Number(subscription?.hours_total ?? 0) - Number(subscription?.hours_used ?? 0))
              : null);

  // Inventory hours_remaining is post-settlement only (does not burn the live session).
  // While a billable session is active, prefer package-pool remaining (already − currentSessionElapsed)
  // so the plan card tracks the session clock; otherwise invent a burn from sessionDuration.
  const apiSessionDurationSec = Math.max(0, Math.floor(Number(billingView?.sessionDurationSeconds ?? 0)));
  const billingRemainingLive =
    billingView?.planCardRemainingHours != null
      ? Number(billingView.planCardRemainingHours)
      : billingView?.remainingHours != null
        ? Number(billingView.remainingHours)
        : null;
  const planRemainingForLive =
    planCardSessionActive && billingRemainingLive != null && Number.isFinite(billingRemainingLive)
      ? billingRemainingLive
      : planCardSessionActive &&
          selectedPlanRemainingHours != null &&
          Number.isFinite(selectedPlanRemainingHours) &&
          apiSessionDurationSec > 0
        ? Math.max(0, Number(selectedPlanRemainingHours) - apiSessionDurationSec / 3600)
        : selectedPlanRemainingHours;

  const cardHoursRemainingLive = useInterpolatedRemainingHours(
    planRemainingForLive,
    apiSessionDurationSec > 0
      ? apiSessionDurationSec
      : Math.max(0, Math.floor(sessionDurationSec)),
    sessionDurationSec,
    planCardSessionActive,
  );
  cardHoursRemainingLiveRef.current = cardHoursRemainingLive;

  const resolveComfyEnterUrl = useCallback(
    async (opts?: { silent?: boolean }): Promise<string | null> => {
      const silent = opts?.silent === true;
      if (comfyEnterUrlRef.current) return comfyEnterUrlRef.current;

      if (!isComfyWorkspaceReady(machineMetricsRef.current)) {
        await refreshMetrics();
      }

      const token = session?.access_token;
      // Brand proxy only — upstream host never exposed to the browser.
      if (token) {
        try {
          const res = await fetch('/api/session/comfy-access', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = (await res.json()) as {
            workUrl?: string;
            error?: string;
            code?: string;
          };
          if (res.ok && typeof data.workUrl === 'string' && data.workUrl) {
            comfyEnterUrlRef.current = data.workUrl;
            setComfyEnterUrl(data.workUrl);
            return data.workUrl;
          }
          if (!silent) {
            setToast(data.error ?? 'Không lấy được link phòng làm việc.');
          }
          return null;
        } catch {
          if (!silent) setToast('Không lấy được link phòng làm việc.');
          return null;
        }
      }

      if (!silent) setToast('ComfyUI đang khởi động — thử lại sau vài giây.');
      return null;
    },
    [refreshMetrics, session?.access_token],
  );

  // Prefetch so the launch control can be a real <a href> (one click, no popup).
  useEffect(() => {
    const running =
      machineSessionView?.phase === 'running' &&
      machineSessionView?.actions.canOpenComfy === true;
    if (!running) {
      comfyEnterUrlRef.current = null;
      setComfyEnterUrl(null);
      return;
    }
    if (!session?.access_token) return;
    if (comfyEnterUrlRef.current) return;
    void resolveComfyEnterUrl({ silent: true });
  }, [
    machineSessionView?.phase,
    machineSessionView?.actions.canOpenComfy,
    session?.access_token,
    resolveComfyEnterUrl,
    machineMetrics?.workReady,
    machineMetrics?.comfyUrl,
  ]);

  const openComfyUI = useCallback(async () => {
    if (!machineSessionView?.actions.canOpenComfy) return;

    if (isMobile) {
      setShowComfyMobileModal(true);
      return;
    }

    if (isTablet) {
      setToast('ComfyUI hoạt động tốt nhất trên màn hình lớn');
    }

    if (comfyEnterUrlRef.current) {
      openComfyInNewTab(comfyEnterUrlRef.current);
      return;
    }

    setIsOpeningComfy(true);
    try {
      const url = await resolveComfyEnterUrl();
      if (!url) return;
      openComfyInNewTab(url);
    } finally {
      setIsOpeningComfy(false);
    }
  }, [
    isMobile,
    isTablet,
    machineSessionView?.actions.canOpenComfy,
    openComfyInNewTab,
    resolveComfyEnterUrl,
  ]);

  const confirmOpenComfyOnMobile = useCallback(async () => {
    setShowComfyMobileModal(false);
    if (comfyEnterUrlRef.current) {
      openComfyInNewTab(comfyEnterUrlRef.current);
      return;
    }
    setIsOpeningComfy(true);
    try {
      const url = await resolveComfyEnterUrl();
      if (!url) return;
      openComfyInNewTab(url);
    } finally {
      setIsOpeningComfy(false);
    }
  }, [openComfyInNewTab, resolveComfyEnterUrl]);

  const startMachine = useCallback(
    async (plan: ActivePlan) => {
      const token = session?.access_token;
      if (!token || !subscription) return;
      if (machineSessionView?.actions.canStart === false) return;

      startMachineAbortRef.current?.abort();
      const controller = new AbortController();
      startMachineAbortRef.current = controller;

      setSessionWorkspace(workspaceDisplayFromEnvName(effectiveEnvName));
      setStartMessage('');
      setStartSupportRequestId(null);
      setShowStartConfirm(false);
      setShowPlanSelector(false);
      setPendingStartPlan(null);

      try {
        // Resume-first: never create a new claim/lease/order if a session is already in flight.
        const resumeRes = await fetch('/api/user/session-resume', {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const resumeData = await resumeRes.json();
        if (startMachineAbortRef.current !== controller) return;
        if (
          resumeRes.ok &&
          resumeData?.shouldResume === true &&
          resumeData?.allowNewProvision === false
        ) {
          if (resumeData.machineSessionView) {
            onMachineSessionView?.(resumeData.machineSessionView as MachineSessionView);
          } else {
            onMachineSessionView?.(buildOptimisticOpeningMachineSessionView(effectiveEnvName));
          }
          if (resumeData.billingView) {
            onBillingSessionView?.(resumeData.billingView as BillingSessionView);
          }
          if (resumeData.progress) {
            setProvisionProgress(resumeData.progress as ProvisionProgressSnapshot);
          }
          setStartMessage('');
          await onRefresh({ silent: true });
          void refreshMetrics();
          return;
        }

        onMachineSessionView?.(buildOptimisticOpeningMachineSessionView(effectiveEnvName));

        const res = await fetch('/api/user/start-machine', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            planId: plan.id,
            type: plan.type,
            plan: plan.plan,
            inventoryId: plan.inventoryId,
            subscriptionId: plan.subscriptionId,
            envName: effectiveEnvName,
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (startMachineAbortRef.current !== controller) return;
        if (!res.ok) {
          const requestId = extractRequestIdFromResponse(res, data);
          setStartSupportRequestId(requestId);
          setStartMessage(data.error ?? 'Không khởi động được máy.');
          setSessionWorkspace(null);
          onMachineSessionView?.(
            buildIdleMachineSessionViewForUi(subscription.env_name ?? effectiveEnvName),
          );
          return;
        }
        setStartSupportRequestId(null);
        if (data.machineSessionView) {
          const serverView = data.machineSessionView as MachineSessionView;
          // Never let a stale idle projection wipe the just-accepted Start.
          if (serverView.phase === 'idle') {
            onMachineSessionView?.(buildOptimisticOpeningMachineSessionView(effectiveEnvName));
          } else {
            onMachineSessionView?.({
              ...serverView,
              clientOptimistic:
                serverView.phase === 'opening' ? true : serverView.clientOptimistic,
            });
          }
        } else {
          onMachineSessionView?.(buildOptimisticOpeningMachineSessionView(effectiveEnvName));
        }
        if (data.billingView) {
          onBillingSessionView?.(data.billingView as BillingSessionView);
        }
        if (data.progress) {
          setProvisionProgress(data.progress as ProvisionProgressSnapshot);
        }
        setStartMessage('');
        // Defer refresh slightly so durable claim/op is visible; merge keeps opening.
        window.setTimeout(() => {
          void onRefresh({ silent: true });
          void reloadPlans({ silent: true });
          void refreshMetrics();
        }, 1200);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setStartMessage('Lỗi mạng khi khởi động máy.');
        setStartSupportRequestId(null);
        setSessionWorkspace(null);
        setProvisionProgress(null);
        onMachineSessionView?.(
          buildIdleMachineSessionViewForUi(subscription.env_name ?? effectiveEnvName),
        );
      } finally {
        if (startMachineAbortRef.current === controller) {
          startMachineAbortRef.current = null;
        }
      }
    },
    [
      session?.access_token,
      subscription,
      effectiveEnvName,
      machineSessionView?.actions.canStart,
      onRefresh,
      reloadPlans,
      onMachineSessionView,
      onBillingSessionView,
      refreshMetrics,
    ],
  );

  const openStartConfirm = useCallback(() => {
    setStartMessage('');
    if (displayPlan) {
      setShowStartConfirm(true);
      return;
    }

    const token = session?.access_token;
    if (!token) return;

    void (async () => {
      setLoadingActivePlans(true);
      try {
        const res = await fetch('/api/user/active-plans', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { plans?: ActivePlan[]; error?: string };
        if (!res.ok) {
          setStartMessage(data.error ?? 'Không kiểm tra được gói active.');
          return;
        }
        const plans = data.plans ?? [];
        if (plans.length === 0) {
          setStartMessage('Không có gói nào đủ điều kiện khởi động.');
          return;
        }
        if (plans.length === 1) {
          setShowStartConfirm(true);
          return;
        }
        setActivePlans(plans);
        setShowPlanSelector(true);
      } catch {
        setStartMessage('Lỗi mạng khi kiểm tra gói active.');
      } finally {
        setLoadingActivePlans(false);
      }
    })();
  }, [displayPlan, session?.access_token]);

  const confirmStartMachine = useCallback(async () => {
    if (machineSessionView?.actions.canStart === false) return;
    setShowStartConfirm(false);
    setShowPlanSelector(false);
    setPendingStartPlan(null);

    // Fresh active inventory = the tier the user currently selected.
    const latestPlan = (await reloadPlans({ silent: true })) ?? displayPlan;
    const active = latestPlan ? inventoryPlanToActivePlan(latestPlan) : null;
    if (active) {
      setSessionWorkspace(workspaceDisplayFromEnvName(effectiveEnvName));
      onMachineSessionView?.(buildOptimisticOpeningMachineSessionView(effectiveEnvName));
      await startMachine(active);
      return;
    }
    if (pendingStartPlan) {
      setSessionWorkspace(workspaceDisplayFromEnvName(effectiveEnvName));
      onMachineSessionView?.(buildOptimisticOpeningMachineSessionView(effectiveEnvName));
      await startMachine(pendingStartPlan);
      return;
    }
    if (activePlans.length === 1) {
      setSessionWorkspace(workspaceDisplayFromEnvName(effectiveEnvName));
      onMachineSessionView?.(buildOptimisticOpeningMachineSessionView(effectiveEnvName));
      await startMachine(activePlans[0]);
      return;
    }
    setStartMessage('Vui lòng chọn gói Starter / Pro / Studio trước khi mở máy.');
  }, [
    displayPlan,
    pendingStartPlan,
    activePlans,
    startMachine,
    machineSessionView?.actions.canStart,
    effectiveEnvName,
    onMachineSessionView,
    reloadPlans,
  ]);

  const cancelBoot = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;

    // Always abort in-flight Start fetch, then call cancel API so server/queue/UI stay aligned.
    if (startMachineAbortRef.current) {
      startMachineAbortRef.current.abort();
      startMachineAbortRef.current = null;
    }

    setIsCancellingBoot(true);
    setStartMessage('');
    setProvisionProgress(null);
    onMachineSessionView?.(
      buildIdleMachineSessionViewForUi(subscription?.env_name ?? effectiveEnvName),
    );
    setSessionWorkspace(null);

    try {
      const res = await fetch('/api/user/cancel-start-machine', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        machineSessionView?: MachineSessionView;
        billingView?: BillingSessionView;
        alreadyIdle?: boolean;
      };
      // 400 "not starting" is OK after abort — treat as idle.
      if (!res.ok && res.status !== 400) {
        setStartMessage(data.error ?? 'Không hủy được khởi tạo.');
        return;
      }
      if (data.machineSessionView) {
        onMachineSessionView?.(data.machineSessionView as MachineSessionView);
      } else {
        onMachineSessionView?.(
          buildIdleMachineSessionViewForUi(subscription?.env_name ?? effectiveEnvName),
        );
      }
      if (data.billingView) {
        onBillingSessionView?.(data.billingView);
      }
      setSessionWorkspace(null);
      setProvisionProgress(null);
      setToast('Đã hủy khởi tạo phiên làm việc');
      notifyUserPlansChanged();
      await onRefresh({ silent: true });
      await reloadPlans({ silent: true });
      void refreshMetrics();
    } catch {
      setStartMessage('Lỗi mạng khi hủy khởi tạo.');
    } finally {
      setIsCancellingBoot(false);
    }
  }, [
    session?.access_token,
    subscription?.env_name,
    effectiveEnvName,
    onRefresh,
    reloadPlans,
    refreshMetrics,
    onMachineSessionView,
    onBillingSessionView,
  ]);

  const stopMachine = useCallback(async (options?: { forceStop?: boolean; waitForBackup?: boolean }) => {
    const token = session?.access_token;
    const canStop =
      machineSessionView?.actions.canStop !== false || Boolean(billingView?.billingStarted);
    if (!token || !canStop) return;

    const forceStop = Boolean(options?.forceStop);
    const waitForBackup = Boolean(options?.waitForBackup);

    const rollbackToRunning = (message: string) => {
      setStopPostCheckActive(false);
      setStartMessage(message);
      setToast(message);
      onMachineSessionView?.({
        phase: 'running',
        lifecycleStatus: 'running',
        serverStatus: 'online',
        workspace: {
          name: machineSessionView?.workspace?.name ?? effectiveEnvName ?? null,
          locked: true,
        },
        machine: machineSessionView?.machine ?? null,
        actions: {
          canStart: false,
          canCancel: false,
          canStop: true,
          canOpenComfy: Boolean(machineSessionView?.actions?.canOpenComfy),
        },
        message,
        domainEvent: null,
        clientOptimistic: false,
      });
    };

    const pollDashboardForStopCheck = async () => {
      const res = await fetch('/api/dashboard/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) return null;
      if (data.machineSessionView) {
        onMachineSessionView?.(data.machineSessionView as MachineSessionView);
      }
      if (data.billingView) {
        onBillingSessionView?.(data.billingView as BillingSessionView);
      }
      return data as {
        machineSessionView?: MachineSessionView | null;
        billingView?: BillingSessionView | null;
      };
    };

    setShowBackupChoice(false);
    setStartMessage(
      waitForBackup
        ? STOP_POST_CHECK_COPY.backupWaitingLonger
        : forceStop
          ? 'Đang tắt máy (không chờ backup)…'
          : STOP_POST_CHECK_COPY.backupSaving,
    );
    setIsStoppingSession(true);
    setStopPostCheckActive(false);
    try {
      const clientRemainingHours = cardHoursRemainingLiveRef.current;
      const clientSessionDurationSeconds =
        billingView?.billingStarted && sessionDurationSec > 0 ? Math.floor(sessionDurationSec) : null;
      const res = await fetch('/api/machines/destroy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clientRemainingHours:
            clientRemainingHours != null && Number.isFinite(clientRemainingHours)
              ? Math.max(0, Number(clientRemainingHours))
              : null,
          clientSessionDurationSeconds,
          forceStop: forceStop || undefined,
          waitForBackup: waitForBackup || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.code === 'BACKUP_CHOICE_REQUIRED') {
          setShowBackupChoice(true);
          setBackupChoiceMessage(
            typeof data.error === 'string' && data.error.trim()
              ? data.error
              : STOP_POST_CHECK_COPY.backupChoiceBody,
          );
          setStartMessage(STOP_POST_CHECK_COPY.backupChoiceBody);
          setToast(STOP_POST_CHECK_COPY.backupChoiceTitle);
          if (data.machineSessionView) {
            onMachineSessionView?.(data.machineSessionView as MachineSessionView);
          } else {
            rollbackToRunning(STOP_POST_CHECK_COPY.backupChoiceBody);
          }
          if (data.billingView) {
            onBillingSessionView?.(data.billingView as BillingSessionView);
          }
          await onRefresh({ silent: true });
          void refreshMetrics();
          return;
        }
        rollbackToRunning(
          typeof data.error === 'string' && data.error.trim()
            ? data.error
            : STOP_POST_CHECK_COPY.apiFailed,
        );
        await onRefresh({ silent: true });
        void refreshMetrics();
        return;
      }

      // Destroy API returned success (server already verify-destroyed). Now
      // hậu kiểm: poll dashboard until UI/DB read path shows idle + no billing.
      setStopPostCheckActive(true);
      onMachineSessionView?.(
        buildOptimisticStoppingMachineSessionView(
          machineSessionView?.workspace?.name ?? effectiveEnvName,
          STOP_POST_CHECK_COPY.verifying,
        ),
      );
      setStartMessage(STOP_POST_CHECK_COPY.verifying);

      let confirmed = false;
      for (let attempt = 0; attempt < STOP_POST_CHECK.maxAttempts; attempt += 1) {
        if (attempt > 0) {
          await waitStopPostCheckInterval(STOP_POST_CHECK.intervalMs);
        }
        const snapshot = await pollDashboardForStopCheck();
        const verdict = evaluateStopPostCheckSnapshot({
          phase: snapshot?.machineSessionView?.phase ?? null,
          billingStarted: snapshot?.billingView?.billingStarted ?? null,
        });
        if (verdict === 'confirmed') {
          confirmed = true;
          break;
        }
        if (verdict === 'still_active' && attempt >= 2) {
          // Provider claimed destroyed but authoritative read still shows live session.
          break;
        }
      }

      if (!confirmed) {
        const last = await pollDashboardForStopCheck();
        const lastVerdict = evaluateStopPostCheckSnapshot({
          phase: last?.machineSessionView?.phase ?? null,
          billingStarted: last?.billingView?.billingStarted ?? null,
        });
        if (lastVerdict === 'confirmed') {
          confirmed = true;
        } else if (
          lastVerdict !== 'still_active' &&
          Boolean((data as { verifiedDestroyedAt?: string | null }).verifiedDestroyedAt)
        ) {
          // Server already verify-destroyed; dashboard read path lagging — trust provider verify.
          if (data.machineSessionView) {
            onMachineSessionView?.(data.machineSessionView as MachineSessionView);
          } else {
            onMachineSessionView?.(
              buildIdleMachineSessionViewForUi(
                machineSessionView?.workspace?.name ?? effectiveEnvName,
              ),
            );
          }
          if (data.billingView) {
            onBillingSessionView?.(data.billingView as BillingSessionView);
          }
          confirmed = true;
        } else {
          rollbackToRunning(STOP_POST_CHECK_COPY.postCheckFailed);
          void refreshMetrics();
          return;
        }
      }

      const settlementStatus =
        typeof data.settlementStatus === 'string' ? data.settlementStatus : null;
      const alreadyStopped = Boolean((data as { alreadyStopped?: boolean }).alreadyStopped);
      setSessionWorkspace(null);
      setStartMessage('');
      setStopPostCheckActive(false);
      setShowBackupChoice(false);
      await onRefresh({ silent: true });
      await reloadPlans({ silent: true });
      notifyUserPlansChanged();
      void refreshMetrics();
      setToast(
        formatStopPostCheckSuccessToast({
          alreadyStopped,
          settlementStatus,
        }),
      );
    } catch {
      rollbackToRunning(STOP_POST_CHECK_COPY.networkFailed);
      await onRefresh({ silent: true });
      void refreshMetrics();
    } finally {
      setIsStoppingSession(false);
      setStopPostCheckActive(false);
      setShowStopConfirm(false);
    }
  }, [
    session?.access_token,
    machineSessionView?.actions.canStop,
    machineSessionView?.actions?.canOpenComfy,
    machineSessionView?.workspace?.name,
    machineSessionView?.machine,
    effectiveEnvName,
    billingView?.billingStarted,
    sessionDurationSec,
    onRefresh,
    reloadPlans,
    refreshMetrics,
    onMachineSessionView,
    onBillingSessionView,
  ]);

  const confirmStopMachine = useCallback(async () => {
    setShowStopConfirm(false);
    setShowBackupChoice(false);
    onMachineSessionView?.(
      buildOptimisticStoppingMachineSessionView(
        machineSessionView?.workspace?.name ?? effectiveEnvName,
        STOP_POST_CHECK_COPY.backupSaving,
      ),
    );
    await stopMachine();
  }, [
    machineSessionView?.workspace?.name,
    effectiveEnvName,
    onMachineSessionView,
    stopMachine,
  ]);

  const forceStopWithoutBackup = useCallback(async () => {
    setShowBackupChoice(false);
    onMachineSessionView?.(
      buildOptimisticStoppingMachineSessionView(
        machineSessionView?.workspace?.name ?? effectiveEnvName,
        'Đang tắt máy ngay (không chờ backup)…',
      ),
    );
    await stopMachine({ forceStop: true });
  }, [
    machineSessionView?.workspace?.name,
    effectiveEnvName,
    onMachineSessionView,
    stopMachine,
  ]);

  const waitLongerForBackupThenStop = useCallback(async () => {
    setShowBackupChoice(false);
    onMachineSessionView?.(
      buildOptimisticStoppingMachineSessionView(
        machineSessionView?.workspace?.name ?? effectiveEnvName,
        STOP_POST_CHECK_COPY.backupWaitingLonger,
      ),
    );
    await stopMachine({ waitForBackup: true });
  }, [
    machineSessionView?.workspace?.name,
    effectiveEnvName,
    onMachineSessionView,
    stopMachine,
  ]);

  const changeEnvironment = useCallback(
    async (workstation: Workstation) => {
      const token = session?.access_token;
      if (!token) return;

      setChangingEnv(true);
      setStartMessage('');
      try {
        const res = await fetch('/api/user/change-environment', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            envName: workstation.name,
            envIcon: workstation.icon,
            envDesc: workstation.desc,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStartMessage(data.error ?? 'Không đổi được workspace.');
          setSelectedEnvName(subscription?.env_name ?? '');
          return;
        }
        setToast(data.message ?? 'Đã chọn workspace.');
        await onRefresh({ silent: true });
      } catch {
        setStartMessage('Lỗi mạng khi đổi môi trường.');
        setSelectedEnvName(subscription?.env_name ?? '');
      } finally {
        setChangingEnv(false);
      }
    },
    [session?.access_token, onRefresh, subscription?.env_name],
  );

  useEffect(() => {
    if (!subscription || !metricsLoaded) return;
    const phase = machineSessionView?.phase;
    if (phase === 'idle' || phase === 'stopping') {
      if (phase === 'idle') setSessionWorkspace(null);
      return;
    }
    if (machineMetrics.template) {
      const templateName = resolveEnvName(machineMetrics.template);
      const requestedName = effectiveEnvName ? resolveEnvName(effectiveEnvName) : null;
      if (machineSessionView?.phase === 'opening' && requestedName && templateName !== requestedName) {
        return;
      }
      setSessionWorkspace(workspaceDisplayFromEnvName(machineMetrics.template));
      return;
    }
    if (machineSessionView?.workspace?.name) {
      setSessionWorkspace(workspaceDisplayFromEnvName(machineSessionView.workspace.name));
      return;
    }
    if (phase === 'running') {
      setSessionWorkspace(
        (prev) => prev ?? workspaceDisplayFromEnvName(subscription.env_name),
      );
    }
  }, [
    subscription,
    machineMetrics,
    metricsLoaded,
    machineMetrics.template,
    machineSessionView?.phase,
    machineSessionView?.workspace?.name,
    effectiveEnvName,
  ]);

  const handleWorkspaceSelect = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const workstation = WORKSTATIONS.find((item) => item.name === event.target.value);
      if (!workstation || workstation.name === effectiveEnvName) return;
      setSelectedEnvName(workstation.name);
      void changeEnvironment(workstation);
    },
    [effectiveEnvName, changeEnvironment],
  );

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 48 }}>
        <p style={{ color: 'var(--text-muted)' }}>Đang tải dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 48 }}>
        <p className="error-msg" style={{ marginBottom: 16 }}>
          {error}
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onRefresh()}>
          Thử lại
        </button>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="card wide" style={{ textAlign: 'center', padding: 48 }}>
        <h2 style={{ fontSize: 22, marginBottom: 12 }}>Chưa có gói GPU active</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
          {user?.email && (
            <>
              Tài khoản: <strong>{user.email}</strong>
              <br />
            </>
          )}
          Hoàn tất thanh toán hoặc dùng thử 3 giờ để khởi tạo máy GPU.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href={routes.checkoutPlan} className="btn btn-primary">
            Chọn gói & thanh toán
          </Link>
          <Link href={routes.home} className="btn btn-secondary">
            Dùng thử 3 giờ miễn phí
          </Link>
        </div>
      </div>
    );
  }

  const isPending = subscription.status === 'pending_payment';
  const serverCardPhase = resolveBootDisplayPhase(
    resolveServerCardPhase(machineSessionView, {
      dashboardLoading: loading,
      metricsLoaded,
    }),
    billingStarted,
    machineSessionView,
  );
  const canPowerOn = !isPending && (machineSessionView?.actions.canStart ?? false);
  const canCancelBoot = machineSessionView?.actions.canCancel ?? false;
  const selectableWorkstations = WORKSTATIONS.filter((item) =>
    GPU_COMFY_WORKSTATION_IDS.includes(item.id),
  );
  const showWorkspaceDropdown =
    !isPending &&
    (serverCardPhase === 'idle' ||
      (serverCardPhase === 'error' && !sessionWorkspace));
  const lockedWorkspace = workspaceDisplayFromEnvName(
    serverCardPhase === 'opening' && effectiveEnvName
      ? effectiveEnvName
      : machineMetrics.template ?? sessionWorkspace?.name ?? effectiveEnvName,
  );
  const lockedWorkspaceName = lockedWorkspace.name;
  const lockedWorkspaceIcon = lockedWorkspace.icon;
  const sessionPhase = serverCardPhase;

  const sessionCardDurationSec = showLiveTimer ? sessionDurationSec : serverDurationSec;
  const sessionCardRemainingHours = sessionActive
    ? displaySessionRemainingHours
    : (billingView?.remainingHours ?? null);
  const canStopSession =
    serverCardPhase === 'opening' || serverCardPhase === 'stopping'
      ? false
      : (machineSessionView?.actions.canStop ?? false) || Boolean(billingView?.billingStarted);
  const showStopSessionButton =
    canStopSession &&
    (serverCardPhase === 'running' ||
      serverCardPhase === 'disconnected' ||
      serverCardPhase === 'error');
  const perfCardActive =
    serverCardPhase === 'running' ||
    (serverCardPhase === 'disconnected' && Boolean(machineMetrics?.metrics?.vram));

  const cardPlan = displayPlan
    ? planCardSnapshotFromInventory(displayPlan)
    : subscription
      ? planCardFromSubscription(subscription, billingView)
      : null;
  const showPlanLoading = plansLoading && !cardPlan;
  // Card = one pool for the active GPU tier (gift + combo + prepaid hourly), never a single line type.
  const cardHoursTotal =
    (tierSumTotalHours > 0
      ? tierSumTotalHours
      : billingView?.planCardTotalHours != null && billingView.planCardTotalHours > 0
        ? Number(billingView.planCardTotalHours)
        : cardPlan?.hoursTotal && cardPlan.hoursTotal > 0
          ? cardPlan.hoursTotal
          : subscription?.hours_total && subscription.hours_total > 0
            ? subscription.hours_total
            : 0) || 0;
  const cardHoursRemainingRaw = clampPlanCardRemainingHours(
    cardHoursRemainingLive ??
      (planCardSessionActive && billingView?.planCardRemainingHours != null
        ? Number(billingView.planCardRemainingHours)
        : tierSumRemainingHours > 0
          ? tierSumRemainingHours
          : billingView?.planCardRemainingHours ??
            billingView?.remainingHours ??
            cardPlan?.hoursRemaining ??
            0),
  );
  // Never show remaining > purchased package pool (wallet must not inflate the plan card).
  const cardHoursRemaining =
    cardHoursTotal > 0 ? Math.min(cardHoursRemainingRaw, cardHoursTotal) : cardHoursRemainingRaw;
  const cardHoursPct =
    cardHoursTotal > 0 ? Math.round((cardHoursRemaining / cardHoursTotal) * 100) : 0;
  const cardDaysLeft = tierMaxDaysLeftValue != null ? tierMaxDaysLeftValue : daysUntil(cardPlan?.validUntil ?? null);
  const confirmPlan =
    displayPlan ??
    pendingStartPlan ??
    (activePlans.length === 1 ? activePlans[0] : null);

  // Confirm modal must show the tier pool (gift + combo + prepaid), not a single inventory row.
  // Gift rows often show 10h / "Miễn phí" while the plan card correctly sums all Starter/Pro/Studio hours.
  const confirmPlanKey: 'starter' | 'pro' | 'studio' | null = (() => {
    if (!confirmPlan) return null;
    if ('planKey' in confirmPlan && confirmPlan.planKey) return confirmPlan.planKey;
    if ('planName' in confirmPlan) return normalizePlanKey(confirmPlan.planName);
    if ('plan' in confirmPlan) return confirmPlan.plan;
    return null;
  })();
  const confirmTierUsablePlans = confirmPlanKey
    ? usablePlans.filter((p) => (p.planKey ?? normalizePlanKey(p.planName)) === confirmPlanKey)
    : [];
  const confirmHoursRemaining = (() => {
    const tierSum = confirmTierUsablePlans.reduce(
      (sum, p) => sum + Number(p.hoursRemaining ?? 0),
      0,
    );
    if (tierSum > 0) return tierSum;
    if (confirmPlan && 'hoursRemaining' in confirmPlan) {
      return Number(confirmPlan.hoursRemaining ?? 0);
    }
    if (confirmPlan && 'hours_remaining' in confirmPlan) {
      return Number(confirmPlan.hours_remaining ?? 0);
    }
    return 0;
  })();
  const confirmPricePerHour = (() => {
    const paid = confirmTierUsablePlans.find((p) => Number(p.pricePerHour ?? 0) > 0);
    if (paid) return Number(paid.pricePerHour);
    if (confirmPlan && 'pricePerHour' in confirmPlan) {
      return Number(confirmPlan.pricePerHour ?? 0);
    }
    if (confirmPlan && 'price_per_hour' in confirmPlan) {
      return Number(confirmPlan.price_per_hour ?? 0);
    }
    return 0;
  })();

  const machineStatusLabel = serverCardStatusLabel(serverCardPhase, isPending);
  const serverCardLayoutStable =
    serverCardPhase === 'running' ||
    serverCardPhase === 'stopping' ||
    serverCardPhase === 'opening' ||
    serverCardPhase === 'disconnected' ||
    serverCardPhase === 'error';

  const planCard = (
    <div className="card dashboard-plan-card dashboard-plan-card--compact">
      <div className="card-header dashboard-plan-card-header">
        <span className="card-title">📦 GÓI & GIỜ</span>
        <Link
          href={routes.dashboardGoiCuaToi}
          style={{ fontSize: 12, color: 'var(--accent-blue)', textDecoration: 'none' }}
        >
          Đổi gói →
        </Link>
      </div>

      {showPlanLoading ? (
        <p className="dashboard-plan-loading">Đang tải gói...</p>
      ) : !cardPlan ? (
        <div className="dashboard-plan-card-content dashboard-plan-card-content--empty">
          <p className="dashboard-plan-empty-text">Chưa có gói</p>
          <Link href={routes.bangGia} className="btn btn-secondary btn-sm">
            Chọn gói
          </Link>
        </div>
      ) : (
        <div className="dashboard-plan-card-content">
          <div className="dashboard-plan-identity">
            <div className="dashboard-plan-name">{cardPlan.displayName}</div>
            <div className="dashboard-plan-spec">
              🖥️ {cardPlan.gpu}
              {cardPlan.vram ? ` · ${cardPlan.vram}` : ''}
            </div>
          </div>

          <div className="dashboard-plan-hours-block">
            {cardHoursTotal > 0 ? (
              <>
                <div className="dashboard-plan-hours-main">
                  <span className="dashboard-plan-hours-value">
                    {formatDisplayHours(cardHoursRemaining)}
                  </span>
                  <span className="dashboard-plan-hours-sep">/</span>
                  <span className="dashboard-plan-hours-total">{formatDisplayHours(cardHoursTotal)}</span>
                </div>
                <div className="dashboard-plan-hours-caption">
                  Tổng giờ gói · còn {cardHoursPct}%
                </div>
                <div className="progress-bar dashboard-plan-compact-progress">
                  <div className="progress-fill blue" style={{ width: `${cardHoursPct}%` }} />
                </div>
              </>
            ) : (
              <div className="dashboard-plan-hours-caption">—</div>
            )}
          </div>

          {(tierMaxValidUntil ?? cardPlan.validUntil) && (
            <div className="dashboard-plan-compact-expiry">
              📅 {formatDate(tierMaxValidUntil ?? cardPlan.validUntil)}
              {cardDaysLeft !== null && ` · ${cardDaysLeft} ngày`}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <PlanSelectorModal
        open={showPlanSelector}
        plans={activePlans}
        loading={loadingActivePlans}
        onClose={() => {
          if (!loadingActivePlans) setShowPlanSelector(false);
        }}
        onConfirm={(plan) => {
          setShowPlanSelector(false);
          setPendingStartPlan(plan);
          setShowStartConfirm(true);
        }}
      />

      <div className={`modal-overlay${showStartConfirm ? ' active' : ''}`}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="start-machine-title">
          <h3 id="start-machine-title">Xác nhận mở phòng làm việc</h3>
          {confirmPlan && 'displayName' in confirmPlan ? (
            <div className="machine-confirm-lines">
              <div>
                🖥️ Workspace:{' '}
                <strong>
                  {workspaceDisplayFromEnvName(effectiveEnvName).icon}{' '}
                  {workspaceDisplayFromEnvName(effectiveEnvName).name}
                </strong>
              </div>
              <div>
                📦 Gói:{' '}
                <strong>
                  {confirmPlan.displayName} · {confirmPlan.gpu} · {confirmPlan.vram}
                </strong>
              </div>
              <div>
                💰 Giá:{' '}
                <strong>
                  {confirmPricePerHour > 0
                    ? `${formatCurrency(confirmPricePerHour)}/giờ`
                    : 'Miễn phí'}
                </strong>
              </div>
              <div>
                ⏱️ Giờ còn lại: <strong>{formatDisplayHours(confirmHoursRemaining)}</strong>
              </div>
            </div>
          ) : confirmPlan ? (
            <div className="machine-confirm-lines">
              <div>
                🖥️ Workspace:{' '}
                <strong>
                  {workspaceDisplayFromEnvName(effectiveEnvName).icon}{' '}
                  {workspaceDisplayFromEnvName(effectiveEnvName).name}
                </strong>
              </div>
              <div>
                📦 Gói:{' '}
                <strong>
                  {confirmPlan.plan.charAt(0).toUpperCase()}
                  {confirmPlan.plan.slice(1)} · {confirmPlan.gpu} · {confirmPlan.vram}
                </strong>
              </div>
              <div>
                💰 Giá:{' '}
                <strong>
                  {confirmPricePerHour > 0
                    ? `${formatCurrency(confirmPricePerHour)}/giờ`
                    : 'Miễn phí'}
                </strong>
              </div>
              <div>
                ⏱️ Giờ còn lại: <strong>{formatDisplayHours(confirmHoursRemaining)}</strong>
              </div>
            </div>
          ) : (
            <p className="machine-confirm-note">Đang tải thông tin gói...</p>
          )}
          <p className="machine-confirm-note">⏱️ Máy sẽ sẵn sàng trong khoảng 2 phút</p>
          <div className="machine-confirm-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={loadingActivePlans}
              onClick={() => {
                setPendingStartPlan(null);
                setShowStartConfirm(false);
              }}
            >
              Hủy
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={
                !machineSessionView?.actions.canStart ||
                !confirmPlan ||
                changingEnv ||
                !effectiveEnvName
              }
              onClick={() => void confirmStartMachine()}
            >
              Mở phiên làm việc
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay${showStopConfirm ? ' active' : ''}`}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="stop-machine-title">
          <h3 id="stop-machine-title">Xác nhận đóng phiên làm việc</h3>
          <div className="machine-confirm-lines">
            <div>
              🖥️ Workspace:{' '}
              <strong>
                {lockedWorkspaceIcon} {lockedWorkspaceName}
              </strong>
            </div>
            {showLiveTimer && (
              <div>
                ⏱️ Thời gian phiên:{' '}
                <strong>{formatRuntimeClock(sessionCardDurationSec)}</strong>
              </div>
            )}
            {cardHoursRemaining > 0 && (
              <div>
                📦 Giờ còn lại: <strong>{formatDisplayHours(cardHoursRemaining)}</strong>
              </div>
            )}
          </div>
          <p className="machine-confirm-note">
            Hệ thống sẽ lưu dữ liệu lên bộ nhớ trước, rồi mới tắt máy. Workspace sẽ tắt — bạn có chắc
            muốn tiếp tục?
          </p>
          <div className="machine-confirm-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isStoppingSession}
              onClick={() => setShowStopConfirm(false)}
            >
              Hủy
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={isStoppingSession}
              onClick={() => void confirmStopMachine()}
            >
              {isStoppingSession ? 'Đang lưu dữ liệu...' : 'Đóng phiên làm việc'}
            </button>
          </div>
        </div>
      </div>

      <div className={`modal-overlay${showBackupChoice ? ' active' : ''}`}>
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="backup-choice-title"
        >
          <h3 id="backup-choice-title">{STOP_POST_CHECK_COPY.backupChoiceTitle}</h3>
          <p className="machine-confirm-note">
            {backupChoiceMessage || STOP_POST_CHECK_COPY.backupChoiceBody}
          </p>
          <p className="machine-confirm-note" style={{ opacity: 0.85 }}>
            Máy vẫn đang chạy và tính giờ cho đến khi bạn chọn tắt.
          </p>
          <div className="machine-confirm-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isStoppingSession}
              onClick={() => {
                setShowBackupChoice(false);
                setStartMessage('');
              }}
            >
              Để sau
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isStoppingSession}
              onClick={() => void waitLongerForBackupThenStop()}
            >
              {isStoppingSession
                ? STOP_POST_CHECK_COPY.backupWaitingLonger
                : STOP_POST_CHECK_COPY.backupWait}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={isStoppingSession}
              onClick={() => void forceStopWithoutBackup()}
            >
              {STOP_POST_CHECK_COPY.backupForceStop}
            </button>
          </div>
        </div>
      </div>

      {isPending && (
        <div className="alert-card warning" style={{ display: 'flex', marginBottom: 20 }}>
          <span className="alert-icon">⏳</span>
          <div className="alert-content">
            <div className="alert-title">Chờ Admin xác nhận thanh toán</div>
            <div className="alert-desc">
              Yêu cầu gói <strong>{subscription.plan}</strong> đã được ghi nhận. Admin sẽ kiểm tra
              chuyển khoản và kích hoạt GPU trong 5–10 phút. Nội dung CK:{' '}
              <em>{subscription.transfer_note ?? '—'}</em>
            </div>
          </div>
        </div>
      )}

      {metricsLoaded && serverCardPhase === 'error' && !isPending && (
        <div className="alert-card warning" style={{ display: 'flex', marginBottom: 20 }}>
          <span className="alert-icon">⚠️</span>
          <div className="alert-content">
            <div className="alert-title">Không khởi động được máy</div>
            <div className="alert-desc">
              {machineSessionView?.message ?? startMessage ?? 'Đã xảy ra lỗi khi khởi tạo máy GPU.'}
            </div>
            {startSupportRequestId && (
              <SupportCodeBlock requestId={startSupportRequestId} />
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 12 }}
              onClick={() => openStartConfirm()}
            >
              Thử lại
            </button>
          </div>
        </div>
      )}

      {metricsLoaded &&
        serverCardPhase === 'disconnected' &&
        !isPending &&
        !isStoppingSession &&
        !stopPostCheckActive && (
        <div className="alert-card warning" style={{ display: 'flex', marginBottom: 20 }}>
          <span className="alert-icon">📡</span>
          <div className="alert-content">
            <div className="alert-title">Mất kết nối</div>
            <div className="alert-desc">
              Không thể liên lạc với máy GPU. Hệ thống sẽ thử kết nối lại tự động.
            </div>
          </div>
        </div>
      )}

      {supportSession?.status === 'active' && (
        <DashboardSupportActiveBanner
          session={supportSession}
          accessToken={session?.access_token}
          onEnded={() => void reloadSupportSession()}
        />
      )}

      <div className="card-grid">
        <div className="dashboard-top-row">
          <div className="dashboard-server-column">
          <div
            className={`card dashboard-server-card${
              serverCardLayoutStable ? ' dashboard-server-card--session' : ''
            }${serverCardPhase === 'opening' ? ' dashboard-server-card--opening' : ''}`}
          >
          <div className="card-header">
            <span className="card-title">🖥️ MÁY CHỦ</span>
            <span className={`status-badge${serverCardStatusBadgeClass(serverCardPhase)}`}>
              <span className="status-dot" />
              {machineStatusLabel}
            </span>
          </div>
          <div className="dashboard-workspace-section">
            <div className="dashboard-workspace-label">Workspace</div>

            {serverCardPhase === 'loading' ? (
              <div className="dashboard-workspace-meta-slot">
                <p className="dashboard-workspace-hint">⏳ Đang đồng bộ trạng thái máy...</p>
              </div>
            ) : showWorkspaceDropdown ? (
              <>
                <div className="dashboard-workspace-select-wrap">
                  <select
                    className="dashboard-workspace-select"
                    value={effectiveEnvName}
                    disabled={changingEnv}
                    onChange={handleWorkspaceSelect}
                    aria-label="Chọn Workspace"
                  >
                    {selectableWorkstations.map((workstation) => (
                      <option key={workstation.id} value={workstation.name}>
                        {workstation.icon} {workstation.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="dashboard-workspace-meta-slot">
                  <p className="dashboard-workspace-hint">
                    {changingEnv
                      ? '⏳ Đang lưu workspace...'
                      : 'Workspace sẽ được áp dụng khi mở phiên làm việc.'}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="dashboard-workspace-locked">
                  {lockedWorkspaceIcon} {lockedWorkspaceName}
                </div>
                <div className="dashboard-workspace-meta-slot">
                  {serverCardPhase === 'opening' && (
                      <div className="dashboard-opening-status" aria-live="polite">
                        {provisionProgress?.stage === 'FAILED' ? (
                          <p className="dashboard-workspace-status dashboard-workspace-status--error">
                            ❌{' '}
                            {provisionProgress?.message?.trim() ||
                              'Mở máy thất bại — thử lại hoặc hủy phiên.'}
                          </p>
                        ) : (
                          <>
                            <div
                              className="machine-start-progress dashboard-opening-progress"
                              role="progressbar"
                              aria-valuetext={
                                openingBootStatusMessage(provisionProgress) || 'Đang mở phiên'
                              }
                              aria-busy="true"
                            >
                              <div className="machine-start-progress-fill" />
                            </div>
                            <p className="dashboard-workspace-status">
                              ⏳ {openingBootStatusMessage(provisionProgress)}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  {serverCardPhase === 'running' && (
                    <p className="dashboard-workspace-status">
                      🔒 Để đổi môi trường mới vui lòng đóng phiên làm việc và mở lại.
                    </p>
                  )}
                  {serverCardPhase === 'running' &&
                    provisionProgress?.tick === 'workspace_choice' && (
                      <div className="dashboard-workspace-restore-choice" style={{ marginTop: 10 }}>
                        <p className="dashboard-workspace-status" style={{ marginBottom: 6 }}>
                          Workspace lớn từ phiên trước — chọn cách mở phiên (máy đang tính giờ):
                        </p>
                        {formatWorkspaceBreakdown(workspaceClassification) && (
                          <p
                            className="dashboard-workspace-hint"
                            style={{ marginBottom: 8, fontSize: 12 }}
                          >
                            {formatWorkspaceBreakdown(workspaceClassification)}
                            {workspaceClassification
                              ? ` (ngưỡng tự động ${formatWorkspaceBytes(workspaceClassification.thresholdBytes)})`
                              : ''}
                          </p>
                        )}
                        <div className="btn-group-server" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-success"
                            disabled={workspaceRestoreBusy}
                            onClick={() => void handleWorkspaceRestoreAction('continue')}
                          >
                            {workspaceRestoreBusy
                              ? 'Đang khôi phục...'
                              : 'Tiếp tục công việc trước (~ vài phút)'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={workspaceRestoreBusy}
                            onClick={() => void handleWorkspaceRestoreAction('fresh')}
                          >
                            Bắt đầu phiên mới (ngay)
                          </button>
                        </div>
                      </div>
                    )}
                  {serverCardPhase === 'running' &&
                    provisionProgress?.tick === 'workspace_restoring' && (
                      <p className="dashboard-workspace-status" style={{ marginTop: 8 }}>
                        ⏳ Đang khôi phục Workspace
                        {formatWorkspaceBreakdown(workspaceClassification)
                          ? ` (${formatWorkspaceBytes(workspaceClassification?.totalBytes ?? 0)})`
                          : ''}
                        ...
                      </p>
                    )}
                  {serverCardPhase === 'running' &&
                    provisionProgress?.tick === 'workspace_failed' && (
                      <div className="dashboard-workspace-restore-failed" style={{ marginTop: 10 }}>
                        <p className="dashboard-workspace-status" style={{ marginBottom: 6 }}>
                          Khôi phục Workspace thất bại — vẫn mở được ComfyUI.
                        </p>
                        {formatWorkspaceBreakdown(workspaceClassification) && (
                          <p
                            className="dashboard-workspace-hint"
                            style={{ marginBottom: 8, fontSize: 12 }}
                          >
                            {formatWorkspaceBreakdown(workspaceClassification)}
                          </p>
                        )}
                        <div className="btn-group-server" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-success"
                            disabled={workspaceRestoreBusy}
                            onClick={() => void handleWorkspaceRestoreAction('continue')}
                          >
                            {workspaceRestoreBusy ? 'Đang thử lại...' : 'Thử lại khôi phục'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={workspaceRestoreBusy}
                            onClick={() => void handleWorkspaceRestoreAction('fresh')}
                          >
                            Bỏ qua, dùng phiên mới
                          </button>
                        </div>
                      </div>
                    )}
                  {serverCardPhase === 'stopping' && (
                    <p className="dashboard-workspace-status">
                      {stopPostCheckActive
                        ? `🔎 ${STOP_POST_CHECK_COPY.verifying}`
                        : '💾 Đang lưu dữ liệu của bạn trước khi tắt máy…'}
                      <span className="dashboard-workspace-status-hint">
                        {stopPostCheckActive
                          ? STOP_POST_CHECK_COPY.verifyingHint
                          : 'Có thể mất vài phút — vui lòng đợi.'}
                      </span>
                    </p>
                  )}
                  {serverCardPhase === 'disconnected' &&
                    !isStoppingSession &&
                    !stopPostCheckActive && (
                    <p className="dashboard-workspace-status">📡 Đang thử kết nối lại máy GPU...</p>
                  )}
                  {serverCardPhase === 'error' && (
                    <p className="dashboard-workspace-status">
                      ⚠️ {machineSessionView?.message ?? startMessage ?? 'Không khởi động được phiên làm việc.'}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {startMessage &&
            serverCardPhase === 'idle' && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--accent-blue)', marginBottom: startSupportRequestId ? 8 : 0 }}>
                {startMessage}
              </p>
              {startSupportRequestId && (
                <SupportCodeBlock requestId={startSupportRequestId} />
              )}
            </div>
          )}

          <div className="dashboard-server-badges-slot">
            {serverCardPhase === 'running' &&
              (machineMetrics?.metrics?.current_model ||
                (machineMetrics?.metrics?.loras?.length ?? 0) > 0) && (
                <div className="dashboard-server-badges">
                  {machineMetrics?.metrics?.current_model && (
                    <span className="status-badge online" style={{ fontSize: 11 }}>
                      🧩 {machineMetrics.metrics.current_model}
                    </span>
                  )}
                  {machineMetrics?.metrics?.loras?.map((lora) => (
                    <span key={lora} className="status-badge" style={{ fontSize: 11 }}>
                      🎨 LoRA: {lora}
                    </span>
                  ))}
                </div>
              )}
          </div>

          <div className="dashboard-server-actions-slot">
          {serverCardPhase !== 'loading' && (
          <div className="btn-group-server">
            {serverCardPhase === 'opening' && canCancelBoot && (
              <>
                <button type="button" className="btn btn-success btn-lg" disabled>
                  {isCancellingBoot ? 'Đang hủy...' : 'GPU đang khởi động...'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-lg"
                  disabled={isCancellingBoot}
                  onClick={() => void cancelBoot()}
                >
                  Hủy khởi tạo
                </button>
              </>
            )}

            {serverCardPhase === 'opening' && !canCancelBoot && (
              <button type="button" className="btn btn-success btn-lg" disabled>
                GPU đang khởi động...
              </button>
            )}

            {serverCardPhase === 'stopping' && (
              <button type="button" className="btn btn-danger btn-lg" disabled>
                {stopPostCheckActive
                  ? STOP_POST_CHECK_COPY.verifyingButton
                  : isStoppingSession
                    ? 'Đang tắt máy...'
                    : 'Đang lưu dữ liệu...'}
              </button>
            )}

            {serverCardPhase === 'running' && isMobile && (
              <p className="comfy-mobile-note">
                💻 Vui lòng dùng máy tính để vào phòng làm việc
                {isComfyWorkspaceReady(machineMetrics) && (
                  <button
                    type="button"
                    className="comfy-mobile-try-btn"
                    onClick={() => setShowComfyMobileModal(true)}
                  >
                    Mở dù sao
                  </button>
                )}
              </p>
            )}

            {serverCardPhase === 'running' && !isMobile && (
              comfyEnterUrl && machineSessionView?.actions.canOpenComfy ? (
                <a
                  className="btn-launch"
                  href={comfyEnterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Vào phòng làm việc"
                >
                  Vào phòng làm việc
                </a>
              ) : (
                <button
                  type="button"
                  className="btn-launch"
                  title="Vào phòng làm việc"
                  disabled={!machineSessionView?.actions.canOpenComfy || isOpeningComfy}
                  onClick={() => void openComfyUI()}
                >
                  {isOpeningComfy ? 'Đang mở ComfyUI...' : 'Vào phòng làm việc'}
                </button>
              )
            )}

            {serverCardPhase === 'idle' && (
              <button
                type="button"
                className="btn btn-success btn-lg"
                disabled={!canPowerOn || plansLoading || changingEnv}
                onClick={() => openStartConfirm()}
              >
                Mở phiên làm việc
              </button>
            )}

            {serverCardPhase === 'error' && (
              <button
                type="button"
                className="btn btn-secondary btn-lg"
                disabled={!canPowerOn || plansLoading || changingEnv}
                onClick={() => openStartConfirm()}
              >
                Thử lại
              </button>
            )}

            {showStopSessionButton && (
              <button
                type="button"
                className="btn btn-danger btn-lg"
                disabled={!canStopSession || isStoppingSession}
                onClick={() => setShowStopConfirm(true)}
              >
                {isStoppingSession ? 'Đang lưu dữ liệu...' : 'Đóng phiên làm việc'}
              </button>
            )}
          </div>
          )}
          </div>
          </div>

          <div className="dashboard-metrics-row">
            <DashboardCurrentSessionCard
              phase={sessionPhase}
              timerMode={timerMode}
              sessionDurationSec={sessionCardDurationSec}
              remainingHours={sessionCardRemainingHours}
              billingStarted={billingStarted}
              idleMinutes={machineMetrics?.idleMinutes ?? null}
              idleWarningActive={Boolean(machineMetrics?.idleWarningActive)}
              minutesUntilAutoStop={machineMetrics?.minutesUntilAutoStop ?? null}
              outputCount={machineMetrics?.metrics?.output_count ?? null}
              outOfHours={Boolean(billingView?.outOfHours)}
              lowCreditWarning={Boolean(billingView?.lowCreditWarning)}
              statusMessage={machineSessionView?.message ?? null}
              stopPostCheckActive={stopPostCheckActive}
            />
            <DashboardRealtimePerfCard
              active={perfCardActive}
              metrics={machineMetrics?.metrics ?? null}
              connectionPaused={serverCardPhase === 'disconnected'}
            />
          </div>
          </div>

          <div className="dashboard-sidebar-column">
            {planCard}
            <DualRunSafetyCard
              accessToken={session?.access_token}
              planKey={displayPlan?.planKey ?? normalizePlanKey(subscription?.plan ?? '')}
              activeGpuLine={
                (machineSessionView?.machine as { gpu_line?: string } | null | undefined)
                  ?.gpu_line ?? null
              }
            />
            <DashboardStorageSummaryCard
              accessToken={session?.access_token}
              machineRunning={serverCardPhase === 'running'}
              runtimeDisk={machineMetrics?.metrics?.disk ?? null}
            />
          </div>
        </div>

        <div className="dashboard-two-col">
          {/* JOB / ATTEMPT (CP) ẩn với KH — bật lại khi Generate qua Control Plane go-live */}
          <DashboardRecentSessionsCard accessToken={session?.access_token} />
        </div>

        <DashboardRecentWorkflowsCard />

        {isMobile && (
          <DashboardRecentImagesMobile machineRunning={serverCardPhase === 'running'} />
        )}

        <div className="card">
          <div className="card-header">
            <span className="card-title">👤 TÀI KHOẢN</span>
          </div>
          <div className="list-item">
            <span className="name">Email</span>
            <span className="meta">{user?.email ?? '—'}</span>
          </div>
          <div className="list-item">
            <span className="name">SĐT</span>
            <span className="meta">
              {user?.phone ?? '—'} {user?.phoneVerified ? '✅' : ''}
            </span>
          </div>
          <div className="list-item">
            <span className="name">Kích hoạt</span>
            <span className="meta">{formatDate(subscription.activated_at)}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">❓ HỖ TRỢ</span>
          </div>
          <div className="support-row">
            <span>📱 Zalo: 0961 862 141</span>
            <span>📧 hello@gpuvietnam.com</span>
            <Link
              href={routes.home}
              prefetch
              style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}
            >
              📖 Về trang chủ
            </Link>
          </div>
        </div>
      </div>

      {toast && <div className="machine-toast">{toast}</div>}

      <div className={`modal-overlay${showComfyMobileModal ? ' active' : ''}`}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="comfy-mobile-title">
          <h3 id="comfy-mobile-title">⚠️ ComfyUI được thiết kế cho máy tính</h3>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Trải nghiệm trên điện thoại sẽ không tốt.
          </p>
          <div className="machine-confirm-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowComfyMobileModal(false)}
            >
              Để sau
            </button>
            {comfyEnterUrl ? (
              <a
                className="btn btn-primary btn-sm"
                href={comfyEnterUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowComfyMobileModal(false)}
              >
                Mở dù sao
              </a>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!isComfyWorkspaceReady(machineMetrics) || isOpeningComfy}
                onClick={() => void confirmOpenComfyOnMobile()}
              >
                {isOpeningComfy ? 'Đang chuẩn bị...' : 'Mở dù sao'}
              </button>
            )}
          </div>
        </div>
      </div>

    </>
  );
}
