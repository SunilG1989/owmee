/**
 * Admin API client — Sprint 4 / Pass 4 (final)
 *
 * Silent-refresh on 401 (Pass 4a):
 *   - Stores access + refresh token in localStorage
 *   - Coalesces concurrent refreshes
 *   - On 4xx refresh failure, clears tokens and fires SESSION_EXPIRED_EVENT
 *   - Transient failures (5xx, network) do NOT log out
 */

const BASE = (import.meta.env.VITE_API_BASE as string) || '';

// ── Token management ────────────────────────────────────────────────────────
const ACCESS_KEY = 'ow_admin_token';
const REFRESH_KEY = 'ow_admin_refresh';

function accessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}
function refreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem('ow_admin_session');
}

export const SESSION_EXPIRED_EVENT = 'ow-admin-session-expired';

function fireSessionExpired() {
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

// ── Refresh coalescing ──────────────────────────────────────────────────────
let refreshPromise: Promise<string | null> | null = null;

async function refreshOnce(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  const rt = refreshToken();
  if (!rt) return null;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${BASE}/v1/admin/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt }),
      });
      if (!res.ok) {
        if (res.status >= 400 && res.status < 500) {
          clearTokens();
          fireSessionExpired();
        }
        return null;
      }
      const data = await res.json();
      if (data.access_token && data.refresh_token) {
        setTokens(data.access_token, data.refresh_token);
        return data.access_token as string;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ── Core request wrapper ────────────────────────────────────────────────────
async function req<T = any>(
  method: string,
  path: string,
  body?: any,
  _retry: boolean = true,
): Promise<T> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const tok = accessToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && _retry && !path.startsWith('/v1/admin/auth/')) {
    const newToken = await refreshOnce();
    if (newToken) {
      return req<T>(method, path, body, false);
    }
  }

  let data: any = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const err: any = new Error(
      (data && data.detail && data.detail.message) ||
      (data && data.detail && data.detail.error) ||
      `HTTP ${res.status}`,
    );
    err.status = res.status;
    err.detail = data?.detail;
    throw err;
  }
  return data as T;
}

// ── Query-string builder ────────────────────────────────────────────────────
function qs(params: Record<string, string | number | undefined | null>): string {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== '' && v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return pairs.length ? '?' + pairs.join('&') : '';
}

// ── Auth ────────────────────────────────────────────────────────────────────

export const AdminAuth = {
  login: async (email: string, password: string) => {
    const r: any = await req('POST', '/v1/admin/auth/login', { email, password });
    if (r.access_token && r.refresh_token) {
      setTokens(r.access_token, r.refresh_token);
    }
    return r;
  },
  me: () => req('GET', '/v1/admin/auth/me'),
  bootstrap: async (email: string, password: string, name: string, role = 'SUPER_ADMIN') => {
    const r: any = await req('POST', '/v1/admin/auth/dev/bootstrap', {
      email, password, name, role,
    });
    if (r.access_token && r.refresh_token) {
      setTokens(r.access_token, r.refresh_token);
    }
    return r;
  },
  logout: async () => {
    const rt = refreshToken();
    if (rt) {
      try {
        await req('POST', '/v1/admin/auth/logout', { refresh_token: rt });
      } catch { /* ignore */ }
    }
    clearTokens();
  },
};

// ── Pass 3: FE + Listings ────────────────────────────────────────────────────

export const AdminFE = {
  listVisits: (statusFilter?: string) =>
    req('GET', `/v1/admin/fe-visits/${statusFilter ? `?status_filter=${statusFilter}` : ''}`),
  getVisit: (visitId: string) =>
    req('GET', `/v1/admin/fe-visits/${visitId}`),
  listFEs: (activeOnly = true) =>
    req('GET', `/v1/admin/fe-visits/fes?active_only=${activeOnly}`),
  createFE: (userId: string, city: string) =>
    req('POST', '/v1/admin/fe-visits/fes', { user_id: userId, city }),
  assign: (
    visitId: string,
    feId: string,
    scheduledStart: string,
    scheduledEnd: string,
    categoryId: string,
  ) =>
    req('POST', `/v1/admin/fe-visits/${visitId}/assign`, {
      fe_id: feId,
      scheduled_slot_start: scheduledStart,
      scheduled_slot_end: scheduledEnd,
      category_id: categoryId,
    }),
  reassign: (
    visitId: string,
    feId: string,
    scheduledStart?: string,
    scheduledEnd?: string,
    categoryId?: string,
  ) =>
    req('POST', `/v1/admin/fe-visits/${visitId}/reassign`, {
      fe_id: feId,
      scheduled_slot_start: scheduledStart,
      scheduled_slot_end: scheduledEnd,
      category_id: categoryId,
    }),
};

export const AdminListings = {
  queue: (source?: 'self_prep' | 'fe_assisted' | 'all') =>
    req('GET', `/v1/admin/listings/queue${source ? `?source=${source}` : ''}`),
  feAssisted: (statusFilter?: string) =>
    req('GET', `/v1/admin/listings/fe-assisted${statusFilter ? `?status_filter=${statusFilter}` : ''}`),
  approve: (listingId: string) =>
    req('POST', `/v1/admin/listings/${listingId}/approve`),
  reject: (listingId: string, flag: string, reason: string) =>
    req('POST', `/v1/admin/listings/${listingId}/reject`, { flag, reason }),
};

export const Listings = {
  categories: () => req('GET', '/v1/listings/categories'),
};

export const Dev = {
  makeFE: (phone: string, city = 'Bengaluru') =>
    req('POST', `/v1/dev/make-fe/${encodeURIComponent(phone)}?city=${encodeURIComponent(city)}`),
};

// ── Pass 4b: Stuck workflows ────────────────────────────────────────────────

export const AdminStuckWorkflows = {
  list: (filter: 'open' | 'resolved' | 'all' = 'open') =>
    req('GET', `/v1/admin/stuck-workflows/?status_filter=${filter}&limit=100`),
  summary: () => req('GET', '/v1/admin/stuck-workflows/summary'),
  resolve: (alertId: string, note: string) =>
    req('POST', `/v1/admin/stuck-workflows/${alertId}/resolve`, { note }),
  devReport: (body: {
    workflow_type: string; workflow_id: string; reason: string;
    severity?: string; description?: string;
    entity_type?: string; entity_id?: string;
  }) => req('POST', '/v1/admin/stuck-workflows/dev/report', body),
};

// ── Pass 4c: FE earnings ────────────────────────────────────────────────────

export const AdminFeEarnings = {
  monthly: (month?: string) =>
    req('GET', `/v1/admin/fe-earnings/monthly${month ? `?month=${month}` : ''}`),
  feDetail: (feId: string, limit = 100) =>
    req('GET', `/v1/admin/fe-earnings/fe/${feId}?limit=${limit}`),
};

// ── Pass 4e: Transaction snapshot ───────────────────────────────────────────

export const AdminTransactionSnapshot = {
  freeze: (txId: string) =>
    req('POST', `/v1/admin/transactions/${txId}/freeze-snapshot`),
  get: (txId: string) =>
    req('GET', `/v1/admin/transactions/${txId}/snapshot`),
};

// ── Pass 4f: Audit log ──────────────────────────────────────────────────────

export const AdminAuditLog = {
  list: (params: Record<string, string | number> = {}) =>
    req('GET', `/v1/admin/audit-log/${qs(params)}`),
  actions: () => req('GET', '/v1/admin/audit-log/actions'),
  devLog: (body: { action: string; entity_type?: string; entity_id?: string; reviewer_notes?: string }) =>
    req('POST', '/v1/admin/audit-log/dev/log', body),
};

// ── Pass 4g: Analytics ──────────────────────────────────────────────────────

export const AdminAnalytics = {
  summary: (sinceDays: number = 7) =>
    req('GET', `/v1/admin/analytics/summary?since_days=${sinceDays}`),
  events: (params: Record<string, string | number> = {}) =>
    req('GET', `/v1/admin/analytics/events${qs(params)}`),
};
