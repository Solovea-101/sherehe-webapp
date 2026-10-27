'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { components } from '@/types/api';
import { AUTH_CHANGED, api, getToken, setToken } from './api';

type User = components['schemas']['User'];
type AuthResult = components['schemas']['AuthResult'];

interface AuthState {
  user: User | null;
  /** False until we know whether the saved token is still good. */
  ready: boolean;
  signIn: (result: AuthResult) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // On load, and whenever the token changes, find out who (if anyone) the saved token belongs to.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (!getToken()) {
        if (!cancelled) {
          setUser(null);
          setReady(true);
        }
        return;
      }
      const me = await api<User>('/api/me');
      if (cancelled) return;
      setUser(me.ok ? me.data : null);
      setReady(true);
    };
    void check();
    const onChange = () => void check();
    window.addEventListener(AUTH_CHANGED, onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED, onChange);
    };
  }, []);

  const signIn = useCallback((result: AuthResult) => {
    setUser(result.user); // show the name straight away; the change event re-checks in the background
    setToken(result.token);
  }, []);

  const signOut = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }); // best effort: the token is forgotten here either way
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, signIn, signOut }), [user, ready, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** For pages only a logged-in organiser can use: sends everyone else to the login page and back again. */
export function useRequireLogin(): AuthState {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (auth.ready && !auth.user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.ready, auth.user, router, pathname]);
  return auth;
}
