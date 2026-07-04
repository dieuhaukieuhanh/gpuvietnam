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

export type DashboardRemaining = {
  remainingHours: number | null;
  totalEntitlementHours: number | null;
  currentSessionElapsedHours: number | null;
  settledSessionUsageHours: number | null;
  primaryPlanType: string | null;
  walletBalance: number | null;
} | null;

export function useDashboard() {
  const { session, loading: authLoading } = useAuth();
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [subscription, setSubscription] = useState<DashboardSubscription | null>(null);
  const [billingType, setBillingType] = useState<BillingType>(null);
  const [remaining, setRemaining] = useState<DashboardRemaining>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!session?.access_token) {
      setUser(null);
      setSubscription(null);
      setBillingType(null);
      setRemaining(null);
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
      setRemaining(result.remaining ?? null);
    } catch {
      setError('Không tải được dữ liệu dashboard.');
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [session?.access_token]);

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

  return { user, subscription, billingType, remaining, loading: authLoading || loading, error, refresh, tryAutoRenew };
}
