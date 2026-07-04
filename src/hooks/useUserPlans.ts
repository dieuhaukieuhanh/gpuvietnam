import { useCallback, useEffect, useState } from 'react';

export const USER_PLANS_CHANGED_EVENT = 'gpuvietnam:user-plans-changed';

export function notifyUserPlansChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(USER_PLANS_CHANGED_EVENT));
  }
}

export type UserInventoryPlan = {
  id: number;
  planType: 'combo' | 'hourly' | 'gift';
  planTypeLabel: string;
  planName: string;
  displayName: string;
  gpu: string;
  vram: string;
  hoursTotal: number;
  hoursRemaining: number;
  pricePerHour: number;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  status: string;
  source: string;
  billing: string | null;
  grantId: number | null;
  subscriptionId: string | null;
  usable: boolean;
  statusBadge: string;
};

type PlansResponse = {
  items: UserInventoryPlan[];
  usable: UserInventoryPlan[];
  inactive: UserInventoryPlan[];
  activePlan: UserInventoryPlan | null;
  count: number;
  error?: string;
};

export function resolveDisplayPlan(data: PlansResponse | null): UserInventoryPlan | null {
  if (!data) return null;
  if (data.activePlan) return data.activePlan;
  const withHours = data.usable.find((plan) => plan.hoursRemaining > 0);
  if (withHours) return withHours;
  return null;
}

export function getInventoryPlanBadge(plan: UserInventoryPlan): string {
  if (plan.planType === 'gift') return '🎁 Tặng';
  if (plan.planType === 'hourly') return 'Theo giờ';
  if (plan.billing === 'combo1') return 'Combo1';
  if (plan.billing === 'combo2') return 'Combo2';
  return plan.planTypeLabel.replace(/^[^\s]+\s/, '');
}

export function useUserPlans(accessToken: string | undefined) {
  const [displayPlan, setDisplayPlan] = useState<UserInventoryPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadPlans = useCallback(async (options?: { silent?: boolean }) => {
    if (!accessToken) {
      setDisplayPlan(null);
      setLoading(false);
      return;
    }

    if (!options?.silent) {
      setLoading(true);
    }
    setError('');

    try {
      const res = await fetch('/api/user/plans', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as PlansResponse;

      if (!res.ok) {
        setError(data.error ?? 'Không tải được gói.');
        setDisplayPlan(null);
        return;
      }

      setDisplayPlan(resolveDisplayPlan(data));
    } catch {
      setError('Không tải được gói.');
      setDisplayPlan(null);
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [accessToken]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (!accessToken) return undefined;

    const onPlansChanged = () => {
      void loadPlans();
    };

    const onFocus = () => {
      void loadPlans();
    };

    window.addEventListener(USER_PLANS_CHANGED_EVENT, onPlansChanged);
    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener(USER_PLANS_CHANGED_EVENT, onPlansChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [accessToken, loadPlans]);

  return { displayPlan, loading, error, reload: loadPlans };
}
