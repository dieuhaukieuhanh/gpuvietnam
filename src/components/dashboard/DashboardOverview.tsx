import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import PlanSelectorModal, { type ActivePlan } from '@/components/dashboard/PlanSelectorModal';
import DashboardCurrentSessionCard from '@/components/dashboard/DashboardCurrentSessionCard';
import DashboardRealtimePerfCard from '@/components/dashboard/DashboardRealtimePerfCard';
import DashboardStorageSummaryCard from '@/components/dashboard/DashboardStorageSummaryCard';
import DashboardRecentWorkflowsCard from '@/components/dashboard/DashboardRecentWorkflowsCard';
import DashboardRecentSessionsCard from '@/components/dashboard/DashboardRecentSessionsCard';
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
import type { DashboardRemaining, DashboardSubscription, DashboardUser } from '@/hooks/useDashboard';
import { formatCurrency } from '@/lib/gpu-pricing';
import { routes } from '@/lib/routes';
import {
  mapDestroyApiToScbView,
  mapMachineStatusApiToScbView,
  pickPlanCardRemainingHours,
  pickPlanCardTotalHours,
  pickSessionRemainingHours,
} from '@/lib/scb-ui-view-model';
import { GPU_COMFY_WORKSTATION_IDS } from '@/lib/workstation-env';
import { WORKSTATIONS, type Workstation } from '@/lib/workstations';

type ScbDbgPhase = 'loading' | 'idle' | 'opening' | 'running' | 'stopping' | 'unknown';

function scbDbg(label: string, payload: unknown): void {
  console.log('[SCB-DBG][dashboard]', label, payload);
}

function phaseFromDisplayState(
  state: MachineUiState | null,
  loaded: boolean,
): ScbDbgPhase {
  if (!loaded) return 'loading';
  if (state === 'creating' || state === 'starting') return 'opening';
  if (state === 'stopping') return 'stopping';
  if (state === 'running') return 'running';
  if (state === 'offline') return 'idle';
  return 'unknown';
}

type MachineUiState =
  | 'offline'
  | 'creating'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error'
  | 'disconnected';

type MachineLiveMetrics = {
  vram?: { used_gb: number; total_gb: number; percent: number } | null;
  gpu_usage_percent?: number | null;
  temperature?: number | null;
  disk?: { used_gb: number; total_gb: number; percent: number } | null;
  current_model?: string | null;
  loras?: string[];
  output_count?: number;
};

type MachineStatusResponse = {
  status: MachineUiState | 'offline';
  machineId?: string | null;
  instanceId?: string | null;
  ip?: string | null;
  port?: number | null;
  comfyUrl?: string | null;
  message?: string | null;
  sessionDurationSeconds?: number;
  billingStartedAt?: string | null;
  remainingHours?: number | null;
  totalEntitlementHours?: number | null;
  sessionStatus?: string | null;
  settlementStatus?: string | null;
  verifiedRunningAt?: string | null;
  verifiedDestroyedAt?: string | null;
  verifyStatus?: string | null;
  planType?: string | null;
  outOfHours?: boolean;
  lowCreditWarning?: boolean;
  idleMinutes?: number | null;
  lastActivity?: string | null;
  minutesUntilAutoStop?: number | null;
  idleWarningActive?: boolean;
  walletBalance?: number | null;
  metrics?: MachineLiveMetrics | null;
};

const STATUS_POLL_BOOT_MS = 10_000;
const STATUS_POLL_RUNNING_MS = 30_000;

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
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

function normalizePlanKey(planName: string): ActivePlan['plan'] {
  const key = planName.toLowerCase();
  if (key === 'starter' || key === 'studio' || key === 'pro') return key;
  return 'pro';
}

function inventoryPlanToActivePlan(plan: UserInventoryPlan): ActivePlan {
  const planKey = normalizePlanKey(plan.planName);
  return {
    id: String(plan.id),
    inventoryId: plan.id,
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

function getMachineUiState(
  subscription: DashboardSubscription,
  isStoppingMachine: boolean,
  apiStatus: MachineStatusResponse | null,
): MachineUiState {
  if (isStoppingMachine || subscription.server_status === 'stopping') return 'stopping';

  const hasMachine = Boolean(apiStatus?.machineId ?? apiStatus?.instanceId);

  // Chỉ coi là đang mở phiên khi API xác nhận có máy đang boot/chạy.
  if (!hasMachine) {
    if (apiStatus?.status === 'error') return 'error';
    if (subscription.server_status === 'stopping') return 'stopping';
    return 'offline';
  }

  if (apiStatus?.status === 'offline') {
    return 'offline';
  }

  if (subscription.server_status === 'offline' && apiStatus?.status !== 'running') {
    return 'offline';
  }

  if (apiStatus?.status === 'disconnected') {
    const bootMessage =
      apiStatus.message?.includes('khởi động') || apiStatus.message?.includes('ComfyUI');
    if (
      bootMessage &&
      (subscription.server_status === 'provisioning' || subscription.server_status === 'online')
    ) {
      return 'starting';
    }
    return 'disconnected';
  }
  if (apiStatus?.status === 'error') return 'error';
  if (apiStatus?.status === 'running') return 'running';
  if (apiStatus?.status === 'starting') return 'starting';
  if (apiStatus?.status === 'creating') return 'creating';

  return 'offline';
}

type DashboardOverviewProps = {
  user: DashboardUser | null;
  subscription: DashboardSubscription | null;
  dashboardRemaining: DashboardRemaining;
  loading: boolean;
  error: string;
  onRefresh: (options?: { silent?: boolean }) => void | Promise<void>;
};

export default function DashboardOverview({
  user,
  subscription,
  dashboardRemaining,
  loading,
  error,
  onRefresh,
}: DashboardOverviewProps) {
  const { session } = useAuth();
  const { isMobile, isTablet } = useIsMobile();
  const { displayPlan, loading: plansLoading, reload: reloadPlans } = useUserPlans(
    session?.access_token,
  );
  const [showPlanSelector, setShowPlanSelector] = useState(false);
  const [activePlans, setActivePlans] = useState<ActivePlan[]>([]);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [changingEnv, setChangingEnv] = useState(false);
  const [sessionWorkspace, setSessionWorkspace] = useState<{ name: string; icon: string } | null>(
    null,
  );
  const [pendingStartPlan, setPendingStartPlan] = useState<ActivePlan | null>(null);
  const [starting, setStarting] = useState(false);
  const [isStoppingMachine, setIsStoppingMachine] = useState(false);
  const [machineStatus, setMachineStatus] = useState<MachineStatusResponse>({ status: 'offline' });
  const [machineStatusLoaded, setMachineStatusLoaded] = useState(false);
  const [hoursExhaustedWarning, setHoursExhaustedWarning] = useState(false);
  const autoDestroyTriggeredRef = useRef(false);
  const lastMachineStatusRef = useRef<MachineUiState>('offline');
  const [startMessage, setStartMessage] = useState('');
  const [toast, setToast] = useState('');
  const [showComfyMobileModal, setShowComfyMobileModal] = useState(false);
  const subscriptionServerStatusRef = useRef(subscription?.server_status);
  useEffect(() => {
    subscriptionServerStatusRef.current = subscription?.server_status;
  }, [subscription?.server_status]);

  // Refs mirror committed state for use inside fetchMachineStatus debug logs
  // without adding them to the callback's dependency array (preserves original deps).
  const isStoppingMachineRef = useRef(isStoppingMachine);
  const subscriptionRef = useRef(subscription);
  useEffect(() => {
    isStoppingMachineRef.current = isStoppingMachine;
  }, [isStoppingMachine]);
  useEffect(() => {
    subscriptionRef.current = subscription;
  }, [subscription]);

  // ── SCB debug: Dashboard state machine transition logger ─────────────────
  const scbPrevPhaseRef = useRef<ScbDbgPhase | null>(null);
  const scbPrevDisplayStateRef = useRef<MachineUiState | null>(null);
  const scbPrevMachineStatusRef = useRef<MachineStatusResponse | null>(null);
  const scbPrevLoadedRef = useRef<boolean | null>(null);
  const scbPrevStoppingRef = useRef<boolean | null>(null);
  const scbPrevServerStatusRef = useRef<string | null | undefined>(null);
  useEffect(() => {
    if (subscription?.server_status != null) {
      scbPrevServerStatusRef.current = subscription.server_status;
    }
  }, [subscription?.server_status]);

  useEffect(() => {
    const loaded = machineStatusLoaded;
    const stopping = isStoppingMachine;
    const apiStatus = machineStatus.status;
    const apiMachineId = machineStatus.machineId ?? machineStatus.instanceId ?? null;
    const serverStatus = subscription?.server_status ?? null;

    // Raw machineStatus change log (every update)
    const prevMs = scbPrevMachineStatusRef.current;
    const msChanged =
      !prevMs ||
      prevMs.status !== apiStatus ||
      (prevMs.machineId ?? null) !== (machineStatus.machineId ?? null) ||
      (prevMs.instanceId ?? null) !== (machineStatus.instanceId ?? null) ||
      prevMs.sessionDurationSeconds !== machineStatus.sessionDurationSeconds ||
      prevMs.remainingHours !== machineStatus.remainingHours ||
      prevMs.billingStartedAt !== machineStatus.billingStartedAt;
    if (msChanged) {
      scbDbg('machineStatus changed', {
        status: apiStatus,
        machineId: apiMachineId,
        sessionDurationSeconds: machineStatus.sessionDurationSeconds,
        billingStartedAt: machineStatus.billingStartedAt,
        remainingHours: machineStatus.remainingHours,
        sessionStatus: machineStatus.sessionStatus,
        settlementStatus: machineStatus.settlementStatus,
      });
      scbPrevMachineStatusRef.current = { ...machineStatus };
    }

    if (!loaded || !subscription) {
      scbDbg('state-machine (not ready)', {
        loaded,
        hasSubscription: Boolean(subscription),
        stopping,
        apiStatus,
      });
      return;
    }

    const displayState = getMachineUiState(subscription, stopping, machineStatus);
    const phase = phaseFromDisplayState(displayState, loaded);
    const prevDisplay = scbPrevDisplayStateRef.current;
    const prevPhase = scbPrevPhaseRef.current;
    const prevStopping = scbPrevStoppingRef.current;
    const prevServer = scbPrevServerStatusRef.current;
    const prevLoaded = scbPrevLoadedRef.current;

    const transitionStr =
      prevDisplay == null && prevLoaded == null
        ? `INIT → ${displayState}`
        : `${prevDisplay} → ${displayState}`;

    const suspicious =
      (prevDisplay === 'running' && displayState === 'stopping' && phase === 'idle'
        ? false
        : prevDisplay === 'running' &&
          displayState === 'offline' &&
          // immediately going running → offline with no stopping in between
          prevStopping !== true
        ? false
        : (prevDisplay === 'running' && displayState === 'starting') ||
          (prevDisplay === 'running' && displayState === 'creating') ||
          (prevDisplay === 'stopping' && displayState === 'starting') ||
          (prevDisplay === 'stopping' && displayState === 'creating'));

    scbDbg('state-machine transition', {
      transition: transitionStr,
      prevPhase,
      phase,
      apiStatus,
      apiMachineId,
      serverStatus,
      prevServer,
      stopping,
      prevStopping,
      loaded,
      prevLoaded,
      suspicious: suspicious ? '⚠️ SUSPICIOUS' : null,
    });

    // Detect specific bug-2 pattern: running → (creating|starting) → idle
    if (prevDisplay === 'running' && (displayState === 'creating' || displayState === 'starting')) {
      scbDbg('state-machine ⚠️ BUG2 PATTERN: running → opening detected', {
        apiStatus,
        serverStatus,
        stopping,
      });
    }
    // Detect bug-1 pattern: running → offline with timer reset (sessionDurationSeconds drops to 0/undefined)
    if (
      prevDisplay === 'running' &&
      displayState === 'offline' &&
      (machineStatus.sessionDurationSeconds == null || machineStatus.sessionDurationSeconds === 0)
    ) {
      scbDbg('state-machine ⚠️ BUG1 PATTERN: running → offline with timer reset', {
        sessionDurationSeconds: machineStatus.sessionDurationSeconds,
        billingStartedAt: machineStatus.billingStartedAt,
      });
    }

    scbPrevDisplayStateRef.current = displayState;
    scbPrevPhaseRef.current = phase;
    scbPrevStoppingRef.current = stopping;
    scbPrevLoadedRef.current = loaded;
  }, [
    machineStatusLoaded,
    isStoppingMachine,
    machineStatus,
    subscription,
  ]);
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

  const fetchMachineStatus = useCallback(async () => {
    const token = session?.access_token;
    if (!token) {
      setMachineStatusLoaded(true);
      return;
    }

    try {
      const res = await fetch('/api/machines/status', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as MachineStatusResponse & { error?: string };
      const machineId = data.machineId ?? data.instanceId ?? null;
      const rawScbView = mapMachineStatusApiToScbView(data);
      scbDbg('fetch raw API response', {
        httpOk: res.ok,
        data,
      });
      scbDbg('fetch normalized scb view', {
        machineId,
        rawScbView,
        subscriptionServerStatus: subscriptionServerStatusRef.current,
        isStoppingMachine: isStoppingMachineRef.current,
      });

      if (!res.ok) {
        if (data.error) setStartMessage(data.error);
        setMachineStatus((prev) => {
          if (prev.status === 'creating' || prev.status === 'starting') {
            return {
              ...prev,
              status: prev.status,
              message: data.error ?? 'Đang khởi động máy GPU...',
            };
          }
          if (
            prev.status === 'running' ||
            prev.instanceId ||
            prev.machineId
          ) {
            return {
              ...prev,
              status: 'disconnected',
              message: data.error ?? 'Mất kết nối tạm thời',
            };
          }
          return { status: 'offline' };
        });
        return;
      }

      if (!machineId) {
        if (data.status === 'creating' || data.status === 'starting') {
          lastMachineStatusRef.current = 'offline';
          scbDbg('fetch branch: no-machineId + creating/starting → offline', {
            apiStatus: data.status,
            predictedNext: 'offline',
          });
          setMachineStatus({
            status: 'offline',
            message: data.message ?? 'Máy chưa bật',
          });
          await onRefresh({ silent: true });
          return;
        }

        if (data.status === 'error') {
          lastMachineStatusRef.current = 'error';
          scbDbg('fetch branch: no-machineId + error → error', {
            apiStatus: data.status,
            predictedNext: 'error',
          });
          setMachineStatus({
            status: 'error',
            message: data.message ?? 'Khởi tạo máy thất bại',
          });
          await onRefresh({ silent: true });
          return;
        }

        lastMachineStatusRef.current = 'offline';
        scbDbg('fetch branch: no-machineId → offline', {
          apiStatus: data.status,
          predictedNext: 'offline',
        });
        setMachineStatus({
          status: 'offline',
          message: data.message ?? 'Máy chưa bật',
        });
        await onRefresh({ silent: true });
        return;
      }

      if (
        subscriptionServerStatusRef.current === 'offline' &&
        data.status !== 'running' &&
        data.status !== 'creating' &&
        data.status !== 'starting'
      ) {
        scbDbg('fetch branch: subscription offline + non-running → offline', {
          apiStatus: data.status,
          subscriptionServerStatus: subscriptionServerStatusRef.current,
          predictedNext: 'offline',
        });
        setMachineStatus({
          status: 'offline',
          message: 'Máy chưa bật',
        });
        await onRefresh({ silent: true });
        return;
      }

      const prevStatus = lastMachineStatusRef.current;
      lastMachineStatusRef.current = data.status as MachineUiState;

      const nextMachineStatus = {
        ...data,
        machineId,
        instanceId: data.instanceId ?? machineId,
      };
      const subSnap = subscriptionRef.current;
      const predictedState = subSnap
        ? getMachineUiState(
            { ...subSnap, server_status: subscriptionServerStatusRef.current ?? subSnap.server_status },
            isStoppingMachineRef.current,
            nextMachineStatus,
          )
        : null;
      scbDbg('fetch branch: set machineStatus', {
        prevStatus,
        apiStatus: data.status,
        machineId,
        subscriptionPresent: Boolean(subSnap),
        subscriptionServerStatus: subscriptionServerStatusRef.current,
        predictedDisplayState: predictedState,
      });

      setMachineStatus(nextMachineStatus);

      if (data.status === 'creating' || data.status === 'starting' || data.status === 'running') {
        setStartMessage('');
      }

      if (data.status === 'running' && prevStatus !== 'running') {
        await reloadPlans({ silent: true });
      }

      if (data.outOfHours) {
        setHoursExhaustedWarning(true);
        if (!autoDestroyTriggeredRef.current) {
          autoDestroyTriggeredRef.current = true;
          const destroyRes = await fetch('/api/machines/destroy', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ interrupted: true }),
          });
          if (destroyRes.ok) {
            setMachineStatus({ status: 'offline' });
            setToast('⏰ Bạn đã hết giờ sử dụng. Máy sẽ tự động tắt.');
            notifyUserPlansChanged();
            await onRefresh();
            await reloadPlans();
          }
        }
        return;
      }

      setHoursExhaustedWarning(false);
      autoDestroyTriggeredRef.current = false;

      if (data.status === 'offline') {
        lastMachineStatusRef.current = 'offline';
        await onRefresh({ silent: true });
        await reloadPlans({ silent: true });
      }
    } catch {
      setMachineStatus((prev) => {
        if (prev.status === 'creating' || prev.status === 'starting') {
          return { ...prev, message: 'Đang khởi động máy GPU...' };
        }
        if (prev.machineId ?? prev.instanceId) {
          return { ...prev, status: 'disconnected', message: 'Mất kết nối' };
        }
        return { status: 'offline' };
      });
    } finally {
      setMachineStatusLoaded(true);
    }
  }, [session?.access_token, onRefresh, reloadPlans, user?.id]);

  useEffect(() => {
    if (!session?.access_token) {
      setMachineStatus({ status: 'offline' });
      setMachineStatusLoaded(false);
      return;
    }
    void fetchMachineStatus();
  }, [session?.access_token, fetchMachineStatus]);

  const activeMachineId = machineStatus.machineId ?? machineStatus.instanceId ?? null;
  const shouldPollStatus =
    Boolean(activeMachineId) ||
    machineStatus.status === 'creating' ||
    machineStatus.status === 'starting' ||
    machineStatus.status === 'running' ||
    subscription?.server_status === 'online' ||
    subscription?.server_status === 'provisioning';

  useEffect(() => {
    if (!session?.access_token || !shouldPollStatus) return undefined;

    const pollMs =
      machineStatus.status === 'running' ? STATUS_POLL_RUNNING_MS : STATUS_POLL_BOOT_MS;
    const id = window.setInterval(() => void fetchMachineStatus(), pollMs);
    return () => window.clearInterval(id);
  }, [session?.access_token, shouldPollStatus, machineStatus.status, fetchMachineStatus]);

  const statusScbView = mapMachineStatusApiToScbView(machineStatus);
  const sessionActive =
    machineStatusLoaded && machineStatus.status === 'running' && !isStoppingMachine;
  const apiRemainingHours = pickSessionRemainingHours(statusScbView);
  const canInterpolateApiRemaining = sessionActive && apiRemainingHours != null;

  const sessionDurationSec = useSessionElapsedSeconds(
    statusScbView.sessionDurationSeconds,
    statusScbView.billingStartedAt != null ? String(statusScbView.billingStartedAt) : null,
    sessionActive,
  );

  const displaySessionRemainingHours = useInterpolatedRemainingHours(
    apiRemainingHours,
    statusScbView.sessionDurationSeconds,
    sessionDurationSec,
    sessionActive,
  );

  const displayCardRemainingFromApi = useInterpolatedRemainingHours(
    canInterpolateApiRemaining ? apiRemainingHours : null,
    statusScbView.sessionDurationSeconds,
    sessionDurationSec,
    canInterpolateApiRemaining,
  );

  const openComfyUI = useCallback(() => {
    const url = machineStatus?.comfyUrl;
    if (!url) return;

    if (isMobile) {
      setShowComfyMobileModal(true);
      return;
    }

    if (isTablet) {
      setToast('ComfyUI hoạt động tốt nhất trên màn hình lớn');
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }, [isMobile, isTablet, machineStatus?.comfyUrl]);

  const confirmOpenComfyOnMobile = useCallback(() => {
    const url = machineStatus?.comfyUrl;
    if (!url) return;
    setShowComfyMobileModal(false);
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [machineStatus?.comfyUrl]);

  const startMachine = useCallback(
    async (plan: ActivePlan) => {
      const token = session?.access_token;
      if (!token || !subscription) return;

      setSessionWorkspace({
        name: subscription.env_name,
        icon: subscription.env_icon,
      });
      setStarting(true);
      setStartMessage('');
      try {
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
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStartMessage(data.error ?? 'Không khởi động được máy.');
          setSessionWorkspace(null);
          return;
        }
        if (data.machine) {
          const machine = data.machine as MachineStatusResponse;
          const machineId = machine.machineId ?? machine.instanceId ?? null;
          lastMachineStatusRef.current = 'starting';
          setMachineStatus(
            machineId
              ? { ...machine, machineId, instanceId: machine.instanceId ?? machineId, status: machine.status ?? 'starting' }
              : { ...machine, status: 'starting' },
          );
        } else {
          lastMachineStatusRef.current = 'starting';
          setMachineStatus({ status: 'starting' });
        }
        setShowPlanSelector(false);
        setShowStartConfirm(false);
        setStartMessage('');
        await onRefresh({ silent: true });
        await reloadPlans();
      } catch {
        setStartMessage('Lỗi mạng khi khởi động máy.');
        setSessionWorkspace(null);
      } finally {
        setStarting(false);
      }
    },
    [session?.access_token, subscription, onRefresh, reloadPlans, user?.id],
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
      setStarting(true);
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
        setStarting(false);
      }
    })();
  }, [displayPlan, session?.access_token]);

  const confirmStartMachine = useCallback(async () => {
    if (displayPlan) {
      await startMachine(inventoryPlanToActivePlan(displayPlan));
      return;
    }
    if (pendingStartPlan) {
      await startMachine(pendingStartPlan);
      setPendingStartPlan(null);
      return;
    }
    if (activePlans.length === 1) {
      await startMachine(activePlans[0]);
    }
  }, [displayPlan, pendingStartPlan, activePlans, startMachine]);

  const stopMachine = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;

    scbDbg('destroy: user pressed Đóng phiên → setIsStoppingMachine(true)', {
      prevMachineStatus: machineStatus,
    });
    setIsStoppingMachine(true);
    setStartMessage('');
    try {
      const res = await fetch('/api/machines/destroy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      scbDbg('destroy: API response', { httpOk: res.ok, data });
      if (!res.ok) {
        setStartMessage(data.error ?? 'Không tắt được máy.');
        scbDbg('destroy: API failed → keep stopping flag, await user/state machine', {
          error: data.error,
        });
        return;
      }
      const destroyView = mapDestroyApiToScbView(data);
      scbDbg('destroy: setting machineStatus=offline', { destroyView });
      setMachineStatus({ status: 'offline' });
      setToast(
        destroyView.settlementStatus
          ? `Đã đóng phiên · settlement: ${destroyView.settlementStatus}`
          : 'Đã đóng phiên làm việc',
      );
      notifyUserPlansChanged();
      scbDbg('destroy: calling onRefresh + reloadPlans', {});
      await onRefresh();
      await reloadPlans();
      scbDbg('destroy: refresh done', {
        subscriptionServerStatus: subscriptionServerStatusRef.current,
      });
    } catch {
      setStartMessage('Lỗi mạng khi tắt máy.');
    } finally {
      scbDbg('destroy: finally → setIsStoppingMachine(false)', {});
      setIsStoppingMachine(false);
    }
  }, [session?.access_token, onRefresh, reloadPlans, machineStatus]);

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
          return;
        }
        setToast(data.message ?? 'Đã chọn workspace.');
        await onRefresh({ silent: true });
      } catch {
        setStartMessage('Lỗi mạng khi đổi môi trường.');
      } finally {
        setChangingEnv(false);
      }
    },
    [session?.access_token, onRefresh],
  );

  useEffect(() => {
    if (!subscription || !machineStatusLoaded) return;
    const state = getMachineUiState(subscription, isStoppingMachine, machineStatus);
    if (state === 'offline') {
      setSessionWorkspace(null);
    }
  }, [subscription, isStoppingMachine, machineStatus, machineStatusLoaded]);

  useEffect(() => {
    if (!subscription || subscription.server_status !== 'online') return;
    setSessionWorkspace(
      (prev) => prev ?? { name: subscription.env_name, icon: subscription.env_icon },
    );
  }, [subscription?.server_status, subscription?.env_name, subscription?.env_icon]);

  const handleWorkspaceSelect = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const workstation = WORKSTATIONS.find((item) => item.name === event.target.value);
      if (!workstation || workstation.name === subscription?.env_name) return;
      void changeEnvironment(workstation);
    },
    [subscription?.env_name, changeEnvironment],
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
  const displayMachineState = machineStatusLoaded
    ? getMachineUiState(subscription, isStoppingMachine, machineStatus)
    : null;
  const isMachineBootstrapLoading = !machineStatusLoaded;
  const canPowerOn = !isPending && displayMachineState === 'offline';
  const selectableWorkstations = WORKSTATIONS.filter((item) =>
    GPU_COMFY_WORKSTATION_IDS.includes(item.id),
  );
  const showWorkspaceDropdown =
    !isPending &&
    !isMachineBootstrapLoading &&
    (displayMachineState === 'offline' ||
      (displayMachineState === 'error' && !sessionWorkspace));
  const lockedWorkspaceName = sessionWorkspace?.name ?? subscription.env_name;
  const lockedWorkspaceIcon = sessionWorkspace?.icon ?? subscription.env_icon;
  const isSessionOpening =
    displayMachineState === 'creating' || displayMachineState === 'starting';
  const sessionPhase: 'loading' | 'idle' | 'opening' | 'running' | 'stopping' =
    isMachineBootstrapLoading
      ? 'loading'
      : isSessionOpening
        ? 'opening'
        : displayMachineState === 'stopping'
          ? 'stopping'
          : displayMachineState === 'running'
            ? 'running'
            : 'idle';

  const cardPlan = displayPlan;
  const isMachineRunning = displayMachineState === 'running';
  const cardHoursRemainingStatic = pickPlanCardRemainingHours(
    isMachineRunning,
    statusScbView,
    dashboardRemaining,
    cardPlan?.hoursRemaining,
  );
  const cardHoursRemaining =
    canInterpolateApiRemaining && displayCardRemainingFromApi != null
      ? displayCardRemainingFromApi
      : cardHoursRemainingStatic;
  const cardHoursTotal = pickPlanCardTotalHours(
    statusScbView,
    dashboardRemaining,
    cardPlan?.hoursTotal,
  );
  const sessionRemainingHours = displaySessionRemainingHours;
  const cardHoursPct =
    cardHoursTotal > 0 ? Math.round((cardHoursRemaining / cardHoursTotal) * 100) : 0;
  const cardDaysLeft = daysUntil(cardPlan?.validUntil ?? null);
  const cardPlanBadge = cardPlan ? getInventoryPlanBadge(cardPlan) : null;
  const confirmPlan =
    cardPlan ??
    pendingStartPlan ??
    (activePlans.length === 1 ? activePlans[0] : null);

  const machineStatusLabel =
    isPending
      ? 'Chờ xác nhận'
      : isMachineBootstrapLoading
        ? 'Đang đồng bộ'
        : displayMachineState === 'running'
        ? 'Đang chạy'
        : isSessionOpening
          ? 'Đang mở phiên'
          : displayMachineState === 'stopping'
            ? 'Đang đóng phiên'
            : displayMachineState === 'error'
              ? 'Lỗi'
              : displayMachineState === 'disconnected'
                ? 'Mất kết nối'
                : 'Chưa mở phiên';

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

      {plansLoading ? (
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
            {cardPlanBadge && (
              <span className="dashboard-plan-type-badge">{cardPlanBadge}</span>
            )}
          </div>

          <div className="dashboard-plan-hours-block">
            {cardHoursTotal > 0 ? (
              <>
                <div className="dashboard-plan-hours-main">
                  <span className="dashboard-plan-hours-value">
                    {roundHours(cardHoursRemaining).toFixed(2)}
                  </span>
                  <span className="dashboard-plan-hours-sep">/</span>
                  <span className="dashboard-plan-hours-total">{cardHoursTotal}</span>
                </div>
                <div className="dashboard-plan-hours-caption">Giờ còn lại · {cardHoursPct}%</div>
                <div className="progress-bar dashboard-plan-compact-progress">
                  <div className="progress-fill blue" style={{ width: `${cardHoursPct}%` }} />
                </div>
              </>
            ) : (
              <div className="dashboard-plan-hours-caption">
                {cardPlan.planType === 'hourly' ? '⏱️ Thanh toán theo giờ sử dụng' : '—'}
              </div>
            )}
          </div>

          {cardPlan.validUntil && (
            <div className="dashboard-plan-compact-expiry">
              📅 {formatDate(cardPlan.validUntil)}
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
        loading={starting}
        onClose={() => {
          if (!starting) setShowPlanSelector(false);
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
                📦 Gói:{' '}
                <strong>
                  {confirmPlan.displayName} · {confirmPlan.gpu} · {confirmPlan.vram}
                </strong>
              </div>
              <div>
                💰 Giá:{' '}
                <strong>
                  {confirmPlan.pricePerHour > 0
                    ? `${formatCurrency(confirmPlan.pricePerHour)}/giờ`
                    : 'Miễn phí'}
                </strong>
              </div>
              <div>
                ⏱️ Giờ còn lại: <strong>{confirmPlan.hoursRemaining}h</strong>
              </div>
            </div>
          ) : confirmPlan ? (
            <div className="machine-confirm-lines">
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
                  {confirmPlan.price_per_hour > 0
                    ? `${formatCurrency(confirmPlan.price_per_hour)}/giờ`
                    : 'Miễn phí'}
                </strong>
              </div>
              <div>
                ⏱️ Giờ còn lại: <strong>{confirmPlan.hours_remaining}h</strong>
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
              disabled={starting}
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
              disabled={starting || !confirmPlan}
              onClick={() => void confirmStartMachine()}
            >
              {starting ? 'Đang xử lý...' : 'Mở phiên làm việc'}
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

      {hoursExhaustedWarning && !isPending && (
        <div className="alert-card warning" style={{ display: 'flex', marginBottom: 20 }}>
          <span className="alert-icon">⏰</span>
          <div className="alert-content">
            <div className="alert-title">Hết giờ sử dụng</div>
            <div className="alert-desc">⏰ Bạn đã hết giờ sử dụng. Máy sẽ tự động tắt.</div>
          </div>
        </div>
      )}

      {machineStatusLoaded && displayMachineState === 'error' && !isPending && (
        <div className="alert-card warning" style={{ display: 'flex', marginBottom: 20 }}>
          <span className="alert-icon">⚠️</span>
          <div className="alert-content">
            <div className="alert-title">Không khởi động được máy</div>
            <div className="alert-desc">
              {machineStatus?.message ?? startMessage ?? 'Đã xảy ra lỗi khi khởi tạo máy GPU.'}
            </div>
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

      {machineStatusLoaded && displayMachineState === 'disconnected' && !isPending && (
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
          <div className="card dashboard-server-card">
          <div className="card-header">
            <span className="card-title">🖥️ MÁY CHỦ</span>
            <span className={`status-badge${displayMachineState === 'running' ? ' online' : ''}`}>
              <span className="status-dot" />
              {machineStatusLabel}
            </span>
          </div>
          <div className="dashboard-workspace-section">
            <div className="dashboard-workspace-label">Workspace</div>

            {isMachineBootstrapLoading ? (
              <div className="dashboard-workspace-meta-slot">
                <p className="dashboard-workspace-hint">⏳ Đang đồng bộ trạng thái máy...</p>
              </div>
            ) : showWorkspaceDropdown ? (
              <>
                <div className="dashboard-workspace-select-wrap">
                  <select
                    className="dashboard-workspace-select"
                    value={subscription.env_name}
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
                    Workspace sẽ được áp dụng khi mở phiên làm việc.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="dashboard-workspace-locked">
                  {lockedWorkspaceIcon} {lockedWorkspaceName}
                </div>
                <div className="dashboard-workspace-meta-slot">
                  {isSessionOpening && (
                    <p className="dashboard-workspace-status">⏳ Đang khởi tạo phiên làm việc...</p>
                  )}
                  {displayMachineState === 'running' && (
                    <p className="dashboard-workspace-status">
                      🔒 Để đổi môi trường mới vui lòng đóng phiên làm việc và mở lại.
                    </p>
                  )}
                  {displayMachineState === 'stopping' && (
                    <p className="dashboard-workspace-status">⏳ Đang đóng phiên làm việc...</p>
                  )}
                </div>
              </>
            )}
          </div>

          {startMessage &&
            displayMachineState !== 'creating' &&
            displayMachineState !== 'starting' &&
            displayMachineState !== 'running' && (
            <p style={{ fontSize: 13, color: 'var(--accent-blue)', marginBottom: 12 }}>{startMessage}</p>
          )}

          <div className="dashboard-server-progress-slot">
            {isSessionOpening && (
              <div className="machine-start-panel">
                <div className="machine-start-progress" aria-hidden="true">
                  <div className="machine-start-progress-fill" />
                </div>
              </div>
            )}
          </div>

          <div className="dashboard-server-badges-slot">
            {displayMachineState === 'running' &&
              (machineStatus?.metrics?.current_model ||
                (machineStatus?.metrics?.loras?.length ?? 0) > 0) && (
                <div className="dashboard-server-badges">
                  {machineStatus?.metrics?.current_model && (
                    <span className="status-badge online" style={{ fontSize: 11 }}>
                      🧩 {machineStatus.metrics.current_model}
                    </span>
                  )}
                  {machineStatus?.metrics?.loras?.map((lora) => (
                    <span key={lora} className="status-badge" style={{ fontSize: 11 }}>
                      🎨 LoRA: {lora}
                    </span>
                  ))}
                </div>
              )}
          </div>

          <div className="dashboard-server-actions-slot">
          {!isMachineBootstrapLoading &&
            (displayMachineState === 'offline' || displayMachineState === 'running') && (
          <div className="btn-group-server">
            {displayMachineState === 'running' && isMobile && (
              <p className="comfy-mobile-note">
                💻 Vui lòng dùng máy tính để vào phòng làm việc
                {machineStatus?.comfyUrl && (
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

            {displayMachineState === 'running' && !isMobile && (
              <button
                type="button"
                className="btn-launch"
                title={
                  machineStatus?.comfyUrl
                    ? `Vào phòng làm việc (${machineStatus.comfyUrl})`
                    : 'Vào phòng làm việc'
                }
                disabled={!machineStatus?.comfyUrl}
                onClick={openComfyUI}
              >
                Vào phòng làm việc
              </button>
            )}

            {displayMachineState === 'offline' && (
              <button
                type="button"
                className="btn btn-success btn-lg"
                disabled={!canPowerOn || starting || plansLoading || changingEnv}
                onClick={() => openStartConfirm()}
              >
                {starting ? 'Đang xử lý...' : 'Mở phiên làm việc'}
              </button>
            )}

            {displayMachineState === 'running' && (
              <button
                type="button"
                className="btn btn-danger btn-lg"
                disabled={isStoppingMachine}
                onClick={() => void stopMachine()}
              >
                Đóng phiên làm việc
              </button>
            )}
          </div>
          )}
          </div>
          </div>

          <div className="dashboard-metrics-row">
            <DashboardCurrentSessionCard
              phase={sessionPhase}
              sessionDurationSec={sessionDurationSec}
              remainingHours={sessionRemainingHours}
              sessionStatus={
                statusScbView.sessionStatus != null ? String(statusScbView.sessionStatus) : null
              }
              settlementStatus={
                statusScbView.settlementStatus != null
                  ? String(statusScbView.settlementStatus)
                  : null
              }
              verifiedRunningAt={
                statusScbView.verifiedRunningAt != null
                  ? String(statusScbView.verifiedRunningAt)
                  : null
              }
              idleMinutes={machineStatus?.idleMinutes ?? null}
              idleWarningActive={Boolean(machineStatus?.idleWarningActive)}
              minutesUntilAutoStop={machineStatus?.minutesUntilAutoStop ?? null}
              outputCount={machineStatus?.metrics?.output_count ?? null}
              outOfHours={Boolean(machineStatus?.outOfHours)}
              lowCreditWarning={Boolean(machineStatus?.lowCreditWarning)}
            />
            <DashboardRealtimePerfCard
              active={displayMachineState === 'running'}
              metrics={machineStatus?.metrics ?? null}
            />
          </div>
          </div>

          <div className="dashboard-sidebar-column">
            {planCard}
            <DashboardStorageSummaryCard
              accessToken={session?.access_token}
              machineRunning={displayMachineState === 'running'}
              runtimeDisk={machineStatus?.metrics?.disk ?? null}
            />
          </div>
        </div>

        <div className="dashboard-two-col">
          <DashboardRecentWorkflowsCard accessToken={session?.access_token} />
          <DashboardRecentSessionsCard accessToken={session?.access_token} />
        </div>

        {isMobile && (
          <DashboardRecentImagesMobile machineRunning={displayMachineState === 'running'} />
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
            <Link href={routes.home} style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
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
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!machineStatus?.comfyUrl}
              onClick={confirmOpenComfyOnMobile}
            >
              Mở dù sao
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
