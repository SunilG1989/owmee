/**
 * Admin API client — Sprint 4 / Pass 3 (3c)
 *
 * Uses Vite dev proxy (/v1/*) so no CORS config needed in dev.
 * In production, set VITE_API_BASE on build.
 */

const BASE = (import.meta.env.VITE_API_BASE as string) || '';

function adminToken(): string | null {
  return localStorage.getItem('ow_admin_token');
}

async function req<T = any>(
  method: string,
  path: string,
  body?: any,
): Promise<T> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const tok = adminToken();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

export const AdminAuth = {
  login: (email: string, password: string) =>
    req('POST', '/v1/admin/auth/login', { email, password }),
  me: () => req('GET', '/v1/admin/auth/me'),
  bootstrap: (email: string, password: string, name: string, role = 'SUPER_ADMIN') =>
    req('POST', '/v1/admin/auth/dev/bootstrap', { email, password, name, role }),
};

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

// Exposed for convenience (read-only admin-only)
export const Listings = {
  categories: () => req('GET', '/v1/listings/categories'),
};

// Dev helper for promoting users → FE during pilot
export const Dev = {
  makeFE: (phone: string, city = 'Bengaluru') =>
    req('POST', `/v1/dev/make-fe/${encodeURIComponent(phone)}?city=${encodeURIComponent(city)}`),
};
