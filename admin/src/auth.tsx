import React, { createContext, useContext, useEffect, useState } from 'react';
import { AdminAuth } from './api';

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
  logout: () => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const cached = localStorage.getItem('ow_admin_session');
      const token = localStorage.getItem('ow_admin_token');
      if (!token) { setLoading(false); return; }
      if (cached) {
        try { setSession(JSON.parse(cached)); } catch {}
      }
      try {
        const me: any = await AdminAuth.me();
        const s: AdminSession = {
          admin_id: me.admin_id,
          email: me.email,
          name: me.name,
          admin_role: me.admin_role,
        };
        setSession(s);
        localStorage.setItem('ow_admin_session', JSON.stringify(s));
      } catch {
        // Token is stale/invalid — clear.
        localStorage.removeItem('ow_admin_token');
        localStorage.removeItem('ow_admin_session');
        setSession(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string) => {
    const r: any = await AdminAuth.login(email, password);
    localStorage.setItem('ow_admin_token', r.access_token);
    const s: AdminSession = {
      admin_id: r.admin_id,
      email: r.email,
      name: r.name,
      admin_role: r.admin_role,
    };
    localStorage.setItem('ow_admin_session', JSON.stringify(s));
    setSession(s);
  };

  const logout = () => {
    localStorage.removeItem('ow_admin_token');
    localStorage.removeItem('ow_admin_session');
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
