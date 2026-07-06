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
import { clampPlanCardRemainingHours } from '@/lib/plan-card-display';
import {
  autostopToastMessage,
  buildIdleMachineSessionViewForUi,
  buildOptimisticOpeningMachineSessionView,
  buildOptimisticStoppingMachineSessionView,
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
import { GPU_COMFY_WORKSTATION_IDS, resolveEnvName, workspaceDisplayFromEnvName } from '@/lib/workstation-env';
import { WORKSTATIONS, type Workstation } from '@/lib/workstations';

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
    displayName: planKey.charAt(0).toUpperCase() + planKey.slice(1),
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
  const { displayPlan, loading: plansLoading, reload: reloadPlans } = useUserPlans(
    session?.access_token,
  );
  const [showPlanSelector, setShowPlanSelector] = useState(false);
  const [activePlans, setActivePlans] = useState<ActivePlan[]>([]);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [changingEnv, setChangingEnv] = useState(false);
  const [selectedEnvName, setSelectedEnvName] = useState('');
  const [sessionWorkspace, setSessionWorkspace] = useState<{ name: string; icon: string } | null>(
    null,
  );
  const [pendingStartPlan, setPendingStartPlan] = useState<ActivePlan | null>(null);
  const [loadingActivePlans, setLoadingActivePlans] = useState(false);
  const [isCancellingBoot, setIsCancellingBoot] = useState(false);
  const [startMessage, setStartMessage] = useState('');
  const [toast, setToast] = useState('');
  const [showComfyMobileModal, setShowComfyMobileModal] = useState(false);
  const [isOpeningComfy, setIsOpeningComfy] = useState(false);
  const startMachineAbortRef = useRef<AbortController | null>(null);
  const cardHoursRemainingLiveRef = useRef<number | null>(null);

  const handleAutostopRefresh = useCallback(async () => {
    notifyUserPlansChanged();
    await onRefresh({ silent: true });
    await reloadPlans({ silent: true });
  }, [onRefresh, reloadPlans]);

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
          Boolean(machineMetricsRef.current?.comfyUrl),
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
  const showLiveTimer = viewPhase === 'running' && billingStarted;

  const sessionActive =
    (viewPhase === 'running' ||
      viewPhase === 'disconnected' ||
      (viewPhase === 'opening' && billingStarted)) &&
    billingStarted;

  const planCardSessionActive =
    Boolean(billingView?.billingStarted) &&
    (viewPhase === 'running' || viewPhase === 'disconnected' || viewPhase === 'stopping');

  const sessionDurationSec = useSessionElapsedSeconds(
    billingView?.sessionDurationSeconds ?? 0,
    billingView?.billingStartedAt ?? null,
    billingView?.verifiedRunningAt ?? null,
    showLiveTimer,
  );

  const timerMode = resolveTimerDisplayMode(viewPhase, billingStarted);
  const serverDurationSec = billingView?.sessionDurationSeconds ?? 0;

  const displaySessionRemainingHours = useInterpolatedRemainingHours(
    billingView?.remainingHours ?? null,
    billingView?.sessionDurationSeconds ?? 0,
    sessionDurationSec,
    sessionActive,
  );

  const cardHoursRemainingLive = useInterpolatedRemainingHours(
    billingView?.planCardRemainingHours ?? null,
    billingView?.sessionDurationSeconds ?? 0,
    sessionDurationSec,
    planCardSessionActive,
  );
  cardHoursRemainingLiveRef.current = cardHoursRemainingLive;

  const openComfyUI = useCallback(async () => {
    if (!machineSessionView?.actions.canOpenComfy) return;

    setIsOpeningComfy(true);
    try {
      let url = machineMetrics?.comfyUrl ?? null;
      if (!url) {
        const snapshot = await refreshMetrics();
        url = snapshot?.comfyUrl ?? machineMetricsRef.current?.comfyUrl ?? null;
      }
      if (!url) {
        setToast('ComfyUI đang khởi động — thử lại sau vài giây.');
        return;
      }

      if (isMobile) {
        setShowComfyMobileModal(true);
        return;
      }

      if (isTablet) {
        setToast('ComfyUI hoạt động tốt nhất trên màn hình lớn');
      }

      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setIsOpeningComfy(false);
    }
  }, [
    isMobile,
    isTablet,
    machineMetrics?.comfyUrl,
    machineSessionView?.actions.canOpenComfy,
    refreshMetrics,
  ]);

  const confirmOpenComfyOnMobile = useCallback(() => {
    const url = machineMetrics?.comfyUrl;
    if (!url) return;
    setShowComfyMobileModal(false);
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [machineMetrics?.comfyUrl]);

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
      setShowStartConfirm(false);
      setShowPlanSelector(false);
      setPendingStartPlan(null);
      onMachineSessionView?.(buildOptimisticOpeningMachineSessionView(effectiveEnvName));

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
            envName: effectiveEnvName,
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (startMachineAbortRef.current !== controller) return;
        if (!res.ok) {
          setStartMessage(data.error ?? 'Không khởi động được máy.');
          setSessionWorkspace(null);
          onMachineSessionView?.(
            buildIdleMachineSessionViewForUi(subscription.env_name ?? effectiveEnvName),
          );
          return;
        }
        if (data.machineSessionView) {
          onMachineSessionView?.(data.machineSessionView as MachineSessionView);
        }
        if (data.billingView) {
          onBillingSessionView?.(data.billingView as BillingSessionView);
        }
        setStartMessage('');
        await onRefresh({ silent: true });
        await reloadPlans();
        void refreshMetrics();
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setStartMessage('Lỗi mạng khi khởi động máy.');
        setSessionWorkspace(null);
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
    setSessionWorkspace(workspaceDisplayFromEnvName(effectiveEnvName));
    onMachineSessionView?.(buildOptimisticOpeningMachineSessionView(effectiveEnvName));
    if (displayPlan) {
      await startMachine(inventoryPlanToActivePlan(displayPlan));
      return;
    }
    if (pendingStartPlan) {
      await startMachine(pendingStartPlan);
      return;
    }
    if (activePlans.length === 1) {
      await startMachine(activePlans[0]);
    }
  }, [
    displayPlan,
    pendingStartPlan,
    activePlans,
    startMachine,
    machineSessionView?.actions.canStart,
    effectiveEnvName,
    onMachineSessionView,
  ]);

  const cancelBoot = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;

    if (startMachineAbortRef.current) {
      startMachineAbortRef.current.abort();
      startMachineAbortRef.current = null;
      onMachineSessionView?.(
        buildIdleMachineSessionViewForUi(subscription?.env_name ?? effectiveEnvName),
      );
      setSessionWorkspace(null);
      setToast('Đã hủy khởi tạo phiên làm việc');
      return;
    }

    setIsCancellingBoot(true);
    setStartMessage('');
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
      };
      if (!res.ok) {
        setStartMessage(data.error ?? 'Không hủy được khởi tạo.');
        return;
      }
      if (data.machineSessionView) {
        onMachineSessionView?.(data.machineSessionView as MachineSessionView);
      }
      if (data.billingView) {
        onBillingSessionView?.(data.billingView);
      }
      setSessionWorkspace(null);
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

  const stopMachine = useCallback(async () => {
    const token = session?.access_token;
    const canStop =
      machineSessionView?.actions.canStop !== false || Boolean(billingView?.billingStarted);
    if (!token || !canStop) return;

    setStartMessage('');
    setIsStoppingSession(true);
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStartMessage(data.error ?? 'Không tắt được máy.');
        return;
      }
      const settlementStatus =
        typeof data.settlementStatus === 'string' ? data.settlementStatus : null;
      if (data.machineSessionView) {
        onMachineSessionView?.(data.machineSessionView as MachineSessionView);
      }
      if (data.billingView) {
        onBillingSessionView?.(data.billingView as BillingSessionView);
      }
      setSessionWorkspace(null);
      setStartMessage('');
      const alreadyStopped = Boolean((data as { alreadyStopped?: boolean }).alreadyStopped);
      await onRefresh({ silent: true });
      await reloadPlans({ silent: true });
      notifyUserPlansChanged();
      void refreshMetrics();
      setToast(
        alreadyStopped
          ? 'Đã đóng phiên làm việc'
          : settlementStatus
            ? `Đã đóng phiên · settlement: ${settlementStatus}`
            : 'Đã đóng phiên làm việc',
      );
    } catch {
      setStartMessage('Lỗi mạng khi tắt máy.');
    } finally {
      setIsStoppingSession(false);
      setShowStopConfirm(false);
    }
  }, [
    session?.access_token,
    machineSessionView?.actions.canStop,
    billingView?.billingStarted,
    billingView?.sessionDurationSeconds,
    sessionDurationSec,
    onRefresh,
    reloadPlans,
    refreshMetrics,
    onMachineSessionView,
    onBillingSessionView,
  ]);

  const confirmStopMachine = useCallback(async () => {
    setShowStopConfirm(false);
    onMachineSessionView?.(
      buildOptimisticStoppingMachineSessionView(
        machineSessionView?.workspace?.name ?? effectiveEnvName,
      ),
    );
    await stopMachine();
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
  const cardHoursRemaining = clampPlanCardRemainingHours(
    cardHoursRemainingLive ??
      billingView?.planCardRemainingHours ??
      billingView?.remainingHours ??
      cardPlan?.hoursRemaining ??
      0,
  );
  const cardHoursTotal =
    (cardPlan?.hoursTotal && cardPlan.hoursTotal > 0
      ? cardPlan.hoursTotal
      : subscription?.hours_total && subscription.hours_total > 0
        ? subscription.hours_total
        : billingView?.planCardTotalHours) ?? 0;
  const cardHoursPct =
    cardHoursTotal > 0 ? Math.round((cardHoursRemaining / cardHoursTotal) * 100) : 0;
  const cardDaysLeft = daysUntil(cardPlan?.validUntil ?? null);
  const cardPlanBadge = displayPlan ? getInventoryPlanBadge(displayPlan) : null;
  const confirmPlan =
    displayPlan ??
    pendingStartPlan ??
    (activePlans.length === 1 ? activePlans[0] : null);

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
            {cardPlanBadge && (
              <span className="dashboard-plan-type-badge">{cardPlanBadge}</span>
            )}
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
            GPU sẽ tắt và phiên làm việc hiện tại sẽ kết thúc. Bạn có chắc muốn tiếp tục?
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
              {isStoppingSession ? 'Đang đóng phiên...' : 'Đóng phiên làm việc'}
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

      {metricsLoaded && serverCardPhase === 'disconnected' && !isPending && (
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
          <div className={`card dashboard-server-card${serverCardLayoutStable ? ' dashboard-server-card--session' : ''}`}>
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
                    <>
                      <p className="dashboard-workspace-status">⏳ Đang khởi tạo phiên làm việc...</p>
                      <div className="dashboard-boot-progress" aria-hidden="true">
                        <div className="dashboard-boot-progress-fill" />
                      </div>
                    </>
                  )}
                  {serverCardPhase === 'running' && (
                    <p className="dashboard-workspace-status">
                      🔒 Để đổi môi trường mới vui lòng đóng phiên làm việc và mở lại.
                    </p>
                  )}
                  {serverCardPhase === 'stopping' && (
                    <p className="dashboard-workspace-status">⏳ Đang đóng phiên làm việc...</p>
                  )}
                  {serverCardPhase === 'disconnected' && (
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
            <p style={{ fontSize: 13, color: 'var(--accent-blue)', marginBottom: 12 }}>{startMessage}</p>
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
                  {isCancellingBoot ? 'Đang hủy...' : 'Đang khởi tạo...'}
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
                Đang khởi tạo...
              </button>
            )}

            {serverCardPhase === 'stopping' && (
              <button type="button" className="btn btn-danger btn-lg" disabled>
                Đang đóng phiên...
              </button>
            )}

            {serverCardPhase === 'running' && isMobile && (
              <p className="comfy-mobile-note">
                💻 Vui lòng dùng máy tính để vào phòng làm việc
                {machineMetrics?.comfyUrl && (
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
              <button
                type="button"
                className="btn-launch"
                title={
                  machineMetrics?.comfyUrl
                    ? `Vào phòng làm việc (${machineMetrics.comfyUrl})`
                    : 'Vào phòng làm việc'
                }
                disabled={!machineSessionView?.actions.canOpenComfy || isOpeningComfy}
                onClick={() => void openComfyUI()}
              >
                {isOpeningComfy ? 'Đang mở ComfyUI...' : 'Vào phòng làm việc'}
              </button>
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
                {isStoppingSession ? 'Đang đóng phiên...' : 'Đóng phiên làm việc'}
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
            <DashboardStorageSummaryCard
              accessToken={session?.access_token}
              machineRunning={serverCardPhase === 'running'}
              runtimeDisk={machineMetrics?.metrics?.disk ?? null}
            />
          </div>
        </div>

        <div className="dashboard-two-col">
          <DashboardRecentWorkflowsCard />
          <DashboardRecentSessionsCard accessToken={session?.access_token} />
        </div>

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
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!machineMetrics?.comfyUrl}
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
