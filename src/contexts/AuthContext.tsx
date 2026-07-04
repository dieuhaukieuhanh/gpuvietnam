import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { isAdminRole } from '@/lib/post-login-redirect';

type UserRole = 'admin' | 'user';

const ROLE_STORAGE_KEY = 'gpuvietnam-user-role';

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  role: UserRole | null;
  isAdmin: boolean;
  loading: boolean;
  roleLoading: boolean;
  applySession: (
    session: {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    },
    options?: { role?: string | null },
  ) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function setAuthCookie(expiresIn = 3600) {
  if (typeof document === 'undefined') return;
  document.cookie = `gpuvietnam-auth=1; path=/; max-age=${expiresIn}; SameSite=Lax`;
}

function clearAuthCookie() {
  if (typeof document === 'undefined') return;
  document.cookie = 'gpuvietnam-auth=; path=/; max-age=0; SameSite=Lax';
}

function normalizeRole(role?: string | null): UserRole {
  return role === 'admin' ? 'admin' : 'user';
}

function readStoredRole(): UserRole | null {
  if (typeof window === 'undefined') return null;
  const value = sessionStorage.getItem(ROLE_STORAGE_KEY);
  if (value === 'admin' || value === 'user') return value;
  return null;
}

function storeRole(role: UserRole) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(ROLE_STORAGE_KEY, role);
}

function clearStoredRole() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(ROLE_STORAGE_KEY);
}

async function fetchUserRole(accessToken: string): Promise<UserRole> {
  try {
    const [meRes, adminRes] = await Promise.all([
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch('/api/admin/check', { headers: { Authorization: `Bearer ${accessToken}` } }),
    ]);

    if (adminRes.ok) return 'admin';

    if (meRes.ok) {
      const data = await meRes.json();
      return normalizeRole(data.role);
    }
  } catch {
    /* fallback below */
  }

  return readStoredRole() ?? 'user';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<UserRole | null>(() => readStoredRole());
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(true);
  const roleHintUntilRef = useRef(0);

  const applyRole = useCallback((nextRole: UserRole, { lockMs = 0 } = {}) => {
    setRole(nextRole);
    storeRole(nextRole);
    if (lockMs > 0) {
      roleHintUntilRef.current = Date.now() + lockMs;
    }
    setRoleLoading(false);
  }, []);

  const syncRole = useCallback(
    async (accessToken: string | undefined, hint?: string | null) => {
      if (hint !== undefined && hint !== null) {
        applyRole(normalizeRole(hint), { lockMs: 5000 });
        return;
      }

      if (!accessToken) {
        setRole(null);
        clearStoredRole();
        setRoleLoading(false);
        return;
      }

      if (Date.now() < roleHintUntilRef.current) {
        setRoleLoading(false);
        return;
      }

      setRoleLoading(true);
      const nextRole = await fetchUserRole(accessToken);

      if (Date.now() < roleHintUntilRef.current) {
        setRoleLoading(false);
        return;
      }

      applyRole(nextRole);
    },
    [applyRole],
  );

  const refreshSession = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setUser(data.session?.user ?? null);
    if (data.session) {
      setAuthCookie(data.session.expires_in ?? 3600);
      await syncRole(data.session.access_token);
    } else {
      clearAuthCookie();
      setRole(null);
      clearStoredRole();
      setRoleLoading(false);
    }
  }, [syncRole]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const supabase = getSupabaseBrowser();
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        if (data.session) {
          setAuthCookie(data.session.expires_in ?? 3600);
          await syncRole(data.session.access_token);
        } else {
          setRole(null);
          clearStoredRole();
          setRoleLoading(false);
        }
      } catch {
        if (mounted) {
          setSession(null);
          setUser(null);
          setRole(null);
          clearStoredRole();
          setRoleLoading(false);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    init();

    const supabase = getSupabaseBrowser();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession) {
        clearAuthCookie();
        setRole(null);
        clearStoredRole();
        setRoleLoading(false);
        setLoading(false);
        return;
      }

      setAuthCookie(nextSession.expires_in ?? 3600);

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void syncRole(nextSession.access_token);
      }

      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [syncRole]);

  const applySession = useCallback(
    async (
      nextSession: { access_token: string; refresh_token: string; expires_in?: number },
      options?: { role?: string | null },
    ) => {
      const supabase = getSupabaseBrowser();
      const { data, error } = await supabase.auth.setSession({
        access_token: nextSession.access_token,
        refresh_token: nextSession.refresh_token,
      });
      if (error) throw error;

      setSession(data.session);
      setUser(data.session?.user ?? null);
      setAuthCookie(nextSession.expires_in ?? data.session?.expires_in ?? 3600);

      if (options?.role !== undefined && options?.role !== null) {
        applyRole(normalizeRole(options.role), { lockMs: 5000 });
        return;
      }

      await syncRole(nextSession.access_token);
    },
    [applyRole, syncRole],
  );

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setRole(null);
    roleHintUntilRef.current = 0;
    clearStoredRole();
    setRoleLoading(false);
    clearAuthCookie();
  }, []);

  const value = useMemo(
    () => ({
      user,
      session,
      role,
      isAdmin: isAdminRole(role),
      loading,
      roleLoading,
      applySession,
      signOut,
      refreshSession,
    }),
    [user, session, role, loading, roleLoading, applySession, signOut, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export function useOptionalAuth() {
  return useContext(AuthContext);
}
