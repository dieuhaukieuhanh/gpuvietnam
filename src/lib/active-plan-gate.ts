import { routes } from '@/lib/routes';

export type ActivePlanSnapshot = {
  hasActivePlan: boolean;
  planName: string | null;
};

export async function fetchActivePlanSnapshot(
  accessToken?: string | null,
): Promise<ActivePlanSnapshot> {
  if (!accessToken) {
    return { hasActivePlan: false, planName: null };
  }

  try {
    const response = await fetch('/api/dashboard/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const result = await response.json();

    if (!response.ok || result.subscription?.status !== 'active') {
      return { hasActivePlan: false, planName: null };
    }

    return {
      hasActivePlan: true,
      planName: typeof result.subscription.plan === 'string' ? result.subscription.plan : null,
    };
  } catch {
    return { hasActivePlan: false, planName: null };
  }
}

export function buildDashboardActivateUrl(): string {
  return `${routes.dashboard}?activated=1`;
}
