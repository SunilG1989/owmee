/**
 * Admin auth context — Sprint 4 / Pass 4a
 *
 * Changes from Pass 3:
 *   - Token management (read/write/clear) moved to api.ts which handles
 *     silent refresh. This context only tracks session state.
 *   - Listens for the SESSION_EXPIRED_EVENT fired by api.ts when a refresh
 *     token is confirmed dead (4xx on refresh). On that event, we clear
 *     the session so RequireAuth redirects to /login.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { AdminAuth, SESSION_EXPIRED_EVENT } from './api';

interface AdminSession {
  admin_id: string;
  email: string;
  name: string;
  admin_role: string;
}

interface AuthCtx {
  session: AdminSession | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

const SESSION_CACHE_KEY = 'ow_admin_session';
const ACCESS_TOKEN_KEY = 'ow_admin_token';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Boot: verify any cached token is still valid ───────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = localStorage.getItem(SESSION_CACHE_KEY);
      const token = localStorage.getItem(ACCESS_TOKEN_KEY);
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      if (cached) {
        try { if (!cancelled) setSession(JSON.parse(cached)); } catch { /* ignore */ }
      }
      try {
        const me: any = await AdminAuth.me();
        const s: AdminSession = {
          admin_id: me.admin_id,
          email: me.email,
          name: me.name,
          admin_role: me.admin_role,
        };
        if (!cancelled) {
          setSession(s);
          localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(s));
        }
      } catch (e: any) {
        // If /me fails with 401 AFTER refresh attempt, api.ts will have
        // fired SESSION_EXPIRED_EVENT which clears tokens. Sync state here.
        if (e?.status === 401) {
          if (!cancelled) setSession(null);
        }
        // Other errors (5xx, network) — keep cached session, don't force logout.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Listen for session-expired events from api.ts ─────────────────────────
  useEffect(() => {
    const handler = () => {
      localStorage.removeItem(SESSION_CACHE_KEY);
      setSession(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, []);

  // ── Login flow ────────────────────────────────────────────────────────────
  const login = async (email: string, password: string) => {
    const r: any = await AdminAuth.login(email, password);
    const s: AdminSession = {
      admin_id: r.admin_id,
      email: r.email,
      name: r.name,
      admin_role: r.admin_role,
    };
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(s));
    setSession(s);
  };

  // ── Logout: revoke server-side + clear local ──────────────────────────────
  const logout = async () => {
    await AdminAuth.logout();  // clears local tokens + revokes on server
    localStorage.removeItem(SESSION_CACHE_KEY);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
