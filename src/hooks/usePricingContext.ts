import { useEffect, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

type PricingContext = {
  isLoggedIn: boolean;
  isReturningCustomer: boolean;
  eligibleForTrial: boolean;
  walletBalance: number;
  loading: boolean;
};

const DEFAULT_CONTEXT: PricingContext = {
  isLoggedIn: false,
  isReturningCustomer: false,
  eligibleForTrial: true,
  walletBalance: 0,
  loading: true,
};

export function usePricingContext(): PricingContext {
  const [context, setContext] = useState<PricingContext>(DEFAULT_CONTEXT);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const supabase = getSupabaseBrowser();
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;

        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch('/api/user/pricing-context', { headers });
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setContext({ ...DEFAULT_CONTEXT, loading: false });
          return;
        }

        setContext({
          isLoggedIn: Boolean(data.isLoggedIn),
          isReturningCustomer: Boolean(data.isReturningCustomer),
          eligibleForTrial: Boolean(data.eligibleForTrial),
          walletBalance: Number(data.walletBalance ?? 0),
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setContext({ ...DEFAULT_CONTEXT, loading: false });
        }
      }
    }

    load();

    const supabase = getSupabaseBrowser();
    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      setContext((prev) => ({ ...prev, loading: true }));
      load();
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return context;
}

export function getStarterPlanCta(isReturningCustomer: boolean): string {
  return isReturningCustomer ? 'Chọn Starter' : 'Dùng thử 3 giờ miễn phí';
}
