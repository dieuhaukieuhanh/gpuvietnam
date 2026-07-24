import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  mergeBillingSessionViewOnPoll,
  mergeMachineSessionViewOnPoll,
} from '@/lib/scb-ui-view-model';

export type DashboardSubscription = {
  id: string;
  plan: string;
  billing: string;
  env_name: string;
  env_icon: string;
  env_desc: string | null;
  gpu_label: string | null;
  hours_total: number;
  hours_used: number;
  status: string;
  server_status: string;
  is_trial: boolean;
  transfer_note: string | null;
  expires_at: string | null;
  activated_at: string | null;
};

export type DashboardUser = {
  id: string;
  email: string;
  phone: string | null;
  phoneVerified: boolean;
  fullName: string | null;
  displayName: string;
  walletBalance: number;
};

export type BillingType = 'hourly' | 'combo' | null;

export type MachineSessionPhase =
  | 'idle'
  | 'opening'
  | 'running'
  | 'stopping'
  | 'disconnected'
  | 'error'
  | 'loading';

export type MachineSessionView = {
  phase: MachineSessionPhase;
  lifecycleStatus: string;
  serverStatus: string;
  workspace: { name: string | null; locked: boolean };
  machine: {
    id: string;
    instanceId: string | null;
    template: string | null;
    status: string;
  } | null;
  actions: {
    canStart: boolean;
    canCancel: boolean;
    canStop: boolean;
    canOpenComfy: boolean;
  };
  message: string | null;
  domainEvent: string | null;
  clientOptimistic?: boolean;
};

export type BillingSessionView = {
  phase: MachineSessionPhase;
  sessionDurationSeconds: number;
  billingStartedAt: string | null;
  remainingHours: number | null;
  totalEntitlementHours: number | null;
  currentSessionElapsedHours: number | null;
  settledSessionUsageHours: number | null;
  primaryPlanType: string | null;
  appliedPlanKey?: 'starter' | 'pro' | 'studio' | null;
  walletBalance: number | null;
  planCardRemainingHours: number | null;
  planCardTotalHours: number | null;
  sessionStatus: string | null;
  settlementStatus: string | null;
  verifiedRunningAt: string | null;
  verifiedDestroyedAt: string | null;
  outOfHours: boolean;
  lowCreditWarning: boolean;
  billingStarted: boolean;
};

export function useDashboard() {
  const { session, loading: authLoading } = useAuth();
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [subscription, setSubscription] = useState<DashboardSubscription | null>(null);
  const [billingType, setBillingType] = useState<BillingType>(null);
  const [billingView, setBillingView] = useState<BillingSessionView | null>(null);
  const [machineSessionView, setMachineSessionView] = useState<MachineSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dataLoaded, setDataLoaded] = useState(false);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const silentRefreshInFlightRef = useRef(false);
  const silentRefreshQueuedRef = useRef(false);
  const openingGuardUntilRef = useRef(0);

  const markOpeningBootGuard = useCallback(() => {
    openingGuardUntilRef.current = Date.now() + 45_000;
  }, []);

  const clearOpeningBootGuard = useCallback(() => {
    openingGuardUntilRef.current = 0;
  }, []);

  const mergeBillingView = useCallback(
    (prev: BillingSessionView | null, next: BillingSessionView | null) => {
      return mergeBillingSessionViewOnPoll(prev, next) as BillingSessionView | null;
    },
    [],
  );

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!session?.access_token) {
      setUser(null);
      setSubscription(null);
      setBillingType(null);
      setBillingView(null);
      setMachineSessionView(null);
      setDataLoaded(true);
      setLoading(false);
      return;
    }

    if (options?.silent) {
      if (silentRefreshInFlightRef.current) {
        silentRefreshQueuedRef.current = true;
        return;
      }
      silentRefreshInFlightRef.current = true;
    } else {
      refreshAbortRef.current?.abort();
    }

    const controller = new AbortController();
    // Hard cap — never leave Dashboard on "Đang tải..." forever (apex me is ~5s typically).
    const timeoutMs = options?.silent ? 45_000 : 30_000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    if (!options?.silent) {
      refreshAbortRef.current = controller;
    }

    if (!options?.silent) {
      setLoading(true);
    }
    setError('');

    try {
      const response = await fetch('/api/dashboard/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: controller.signal,
      });
      const result = await response.json();
      if (!options?.silent && refreshAbortRef.current !== controller) return;
      if (!response.ok) {
        if (!options?.silent) {
          setError(result.error ?? 'Không tải được dữ liệu.');
          setDataLoaded(true);
        }
        return;
      }
      setUser(result.user);
      setSubscription(result.subscription);
      setBillingType(result.billingType ?? null);
      setBillingView((prev) => mergeBillingView(prev, result.billingView ?? null));
      setMachineSessionView((prev) => {
        const merged = mergeMachineSessionViewOnPoll(
          prev,
          result.machineSessionView ?? null,
          {
            openingGuardUntilMs: openingGuardUntilRef.current,
            nowMs: Date.now(),
          },
        ) as MachineSessionView | null;
        // Resume-first: restore boot guard after refresh when a session is in flight / running
        const resume = result.sessionResume as
          | { shouldResume?: boolean; currentState?: string }
          | undefined;
        if (
          resume?.shouldResume ||
          merged?.phase === 'opening' ||
          merged?.phase === 'running' ||
          merged?.phase === 'disconnected'
        ) {
          markOpeningBootGuard();
        } else {
          clearOpeningBootGuard();
        }
        return merged;
      });
      setDataLoaded(true);
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      const replaced =
        !options?.silent && refreshAbortRef.current !== controller;
      // Replaced by a newer refresh — ignore. Timeout / real abort must unblock UI.
      if (aborted && replaced) return;
      if (!options?.silent && replaced) return;
      if (!options?.silent) {
        setError(
          aborted
            ? 'Tải dashboard quá lâu — thử lại.'
            : 'Không tải được dữ liệu dashboard.',
        );
      }
      setDataLoaded(true);
    } finally {
      clearTimeout(timeoutId);
      if (!options?.silent) {
        if (refreshAbortRef.current !== controller) return;
        refreshAbortRef.current = null;
        setLoading(false);
      } else {
        silentRefreshInFlightRef.current = false;
        if (silentRefreshQueuedRef.current) {
          silentRefreshQueuedRef.current = false;
          void refresh({ silent: true });
        }
      }
    }
  }, [session?.access_token, clearOpeningBootGuard, markOpeningBootGuard, mergeBillingView]);

  const applyMachineSessionView = useCallback((view: MachineSessionView | null) => {
    if (view?.phase === 'opening') {
      markOpeningBootGuard();
    } else if (view?.phase === 'stopping') {
      clearOpeningBootGuard();
    } else if (view?.phase === 'idle' || view?.phase === 'error') {
      clearOpeningBootGuard();
    }
    setMachineSessionView(view);
  }, [markOpeningBootGuard, clearOpeningBootGuard]);

  const applyBillingSessionView = useCallback(
    (view: BillingSessionView | null) => {
      setBillingView((prev) => mergeBillingView(prev, view));
    },
    [mergeBillingView],
  );

  const prevAccessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    const token = session?.access_token ?? null;
    if (!token) {
      prevAccessTokenRef.current = null;
      setDataLoaded(true);
      setLoading(false);
      return;
    }
    // Only reset loaded flag when the token actually changes (login / refresh),
    // not on every mount — that previously left the UI stuck on "Đang tải...".
    if (prevAccessTokenRef.current !== token) {
      prevAccessTokenRef.current = token;
      setDataLoaded(false);
    }
    void refresh();
  }, [authLoading, session?.access_token, refresh]);

  useEffect(() => {
    return () => {
      refreshAbortRef.current?.abort();
    };
  }, []);

  const tryAutoRenew = useCallback(async () => {
    if (!session?.access_token) return null;
    try {
      const res = await fetch('/api/user/auto-renew', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (res.ok && data.action === 'renewed') {
        await refresh();
      }
      return data;
    } catch {
      return null;
    }
  }, [session?.access_token, refresh]);

  useEffect(() => {
    if (authLoading || !session?.access_token || !dataLoaded) return;
    void tryAutoRenew();
  }, [authLoading, session?.access_token, dataLoaded, tryAutoRenew]);

  return {
    user,
    subscription,
    billingType,
    billingView,
    machineSessionView,
    loading: authLoading || loading || (Boolean(session?.access_token) && !dataLoaded),
    error,
    refresh,
    applyMachineSessionView,
    applyBillingSessionView,
    tryAutoRenew,
  };
}
