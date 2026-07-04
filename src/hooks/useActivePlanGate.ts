import { useRouter } from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import {
  buildDashboardActivateUrl,
  fetchActivePlanSnapshot,
  type ActivePlanSnapshot,
} from '@/lib/active-plan-gate';
import { useAuth } from '@/contexts/AuthContext';

const EMPTY_SNAPSHOT: ActivePlanSnapshot = { hasActivePlan: false, planName: null };

export function useActivePlanGate() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [snapshot, setSnapshot] = useState<ActivePlanSnapshot>(EMPTY_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadSnapshot() {
      if (authLoading) return;

      if (!session?.access_token) {
        if (mounted) {
          setSnapshot(EMPTY_SNAPSHOT);
          setLoaded(true);
        }
        return;
      }

      const next = await fetchActivePlanSnapshot(session.access_token);
      if (mounted) {
        setSnapshot(next);
        setLoaded(true);
      }
    }

    void loadSnapshot();

    return () => {
      mounted = false;
    };
  }, [authLoading, session?.access_token]);

  const goToDashboard = useCallback(() => {
    void router.push(buildDashboardActivateUrl());
  }, [router]);

  const redirectIfActivePlan = useCallback(async (): Promise<boolean> => {
    const next = await fetchActivePlanSnapshot(session?.access_token);
    setSnapshot(next);
    setLoaded(true);

    if (next.hasActivePlan) {
      await router.push(buildDashboardActivateUrl());
      return true;
    }

    return false;
  }, [router, session?.access_token]);

  return {
    hasActivePlan: snapshot.hasActivePlan,
    planName: snapshot.planName,
    loaded: loaded && !authLoading,
    loading: authLoading || (Boolean(session?.access_token) && !loaded),
    goToDashboard,
    redirectIfActivePlan,
  };
}
