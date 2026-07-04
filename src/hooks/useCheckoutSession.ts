import type { Session, User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

type CheckoutSessionState = {
  session: Session | null;
  user: User | null;
  isLoggedIn: boolean;
  loading: boolean;
};

export function useCheckoutSession(): CheckoutSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return {
    session,
    user: session?.user ?? null,
    isLoggedIn: !!session?.user,
    loading,
  };
}
