import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

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

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!session?.access_token) {
      setUser(null);
      setSubscription(null);
      setBillingType(null);
      setBillingView(null);
      setMachineSessionView(null);
      setLoading(false);
      return;
    }

    if (!options?.silent) {
      setLoading(true);
    }
    setError('');

    try {
      const response = await fetch('/api/dashboard/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Không tải được dữ liệu.');
        return;
      }
      setUser(result.user);
      setSubscription(result.subscription);
      setBillingType(result.billingType ?? null);
      setBillingView(result.billingView ?? null);
      setMachineSessionView(result.machineSessionView ?? null);
    } catch {
      setError('Không tải được dữ liệu dashboard.');
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [session?.access_token]);

  const applyMachineSessionView = useCallback((view: MachineSessionView | null) => {
    setMachineSessionView(view);
  }, []);

  const applyBillingSessionView = useCallback((view: BillingSessionView | null) => {
    setBillingView(view);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    refresh();
  }, [authLoading, refresh]);

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
    if (authLoading || !session?.access_token) return;
    void tryAutoRenew();
  }, [authLoading, session?.access_token, tryAutoRenew]);

  return {
    user,
    subscription,
    billingType,
    billingView,
    machineSessionView,
    loading: authLoading || loading,
    error,
    refresh,
    applyMachineSessionView,
    applyBillingSessionView,
    tryAutoRenew,
  };
}
