import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../store/authStore';

import { API_URL, REQUEST_TIMEOUT, UPLOAD_TIMEOUT } from '../config';
const BASE = API_URL;
const api = axios.create({ baseURL: BASE, timeout: REQUEST_TIMEOUT });

// ── Request interceptor: attach token ────────────────────────────────────────
api.interceptors.request.use((cfg) => {
  const token = useAuthStore.getState().accessToken;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ── Response interceptor: 401 → silent token refresh ─────────────────────────
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: any) => void; reject: (e: any) => void; config: InternalAxiosRequestConfig }> = [];

function processQueue(error: any, token: string | null) {
  failedQueue.forEach(({ resolve, reject, config }) => {
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      resolve(api(config));
    } else {
      reject(error);
    }
  });
  failedQueue = [];
}

/** Extract user_id (sub claim) from JWT payload */
function extractUserId(token: string): string {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.sub || '';
  } catch { return ''; }
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const orig = error.config;
    if (!orig || error.response?.status !== 401) return Promise.reject(error);
    if (orig.url?.includes('/auth/')) return Promise.reject(error);

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject, config: orig });
      });
    }

    isRefreshing = true;
    const { refreshToken, logout } = useAuthStore.getState();

    if (!refreshToken) {
      logout();
      isRefreshing = false;
      return Promise.reject(error);
    }

    try {
      const res = await axios.post(`${BASE}/v1/auth/token/refresh`, { refresh_token: refreshToken }, { timeout: REQUEST_TIMEOUT });
      const { access_token, refresh_token: newRefresh, tier, kyc_status } = res.data;
      const userId = extractUserId(access_token);
      useAuthStore.getState().setTokens(access_token, newRefresh, userId, tier, kyc_status);
      processQueue(null, access_token);
      orig.headers.Authorization = `Bearer ${access_token}`;
      return api(orig);
    } catch (refreshErr) {
      processQueue(refreshErr, null);
      logout();
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

// ── Upload client ────────────────────────────────────────────────────────────
const uploadApi = axios.create({ baseURL: BASE, timeout: UPLOAD_TIMEOUT });
uploadApi.interceptors.request.use((cfg) => {
  const token = useAuthStore.getState().accessToken;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ── Types ────────────────────────────────────────────────────────────────────

export interface Listing {
  id: string; title: string; description?: string; price: number; original_price?: number | null;
  condition: string; category_slug?: string; city: string; locality?: string;
  images: string[]; image_urls?: string[]; thumbnail_url?: string;
  seller_id: string; seller_verified?: boolean;
  is_negotiable?: boolean; is_kids_item?: boolean;
  accessories?: string; warranty_status?: string; battery_health?: string;
  imei?: string; view_count?: number; status: string;
  brand?: string; model?: string; storage?: string; ram?: string; color?: string;
  processor?: string; screen_size?: string; purchase_year?: number;
  screen_condition?: string; body_condition?: string; defects?: string[];
  serial_number?: string; original_price_str?: string;
  published_at?: string; created_at?: string; distance_km?: number;
  seller?: { kyc_verified?: boolean; avg_rating?: number; deal_count?: number; name?: string };
}

export interface Offer {
  id: string; listing_id: string; listing_title: string; listing_price: number;
  listing_thumbnail?: string; offered_price?: number; amount: number;
  note?: string; status: string; counter_price?: number;
  expires_at?: string; created_at: string;
}

export interface Transaction {
  id: string; listing_id: string; listing_title: string; buyer_id: string; seller_id: string;
  amount: number; status: string; created_at: string;
  payment_link?: string; payment_link_status?: string;
}

export interface BrowseParams {
  city?: string; category_slug?: string; condition?: string;
  min_price?: number; max_price?: number; kids_only?: boolean;
  lat?: number; lng?: number; radius_km?: number;
  sort?: string; limit?: number; offset?: number;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export const Auth = {
  requestOtp: (phone: string) => api.post('/v1/auth/otp/send', { phone_number: phone }),
  sendOTP: (phone: string) => api.post('/v1/auth/otp/send', { phone_number: phone }),
  verifyOtp: (phone: string, code: string) => api.post('/v1/auth/otp/verify', { phone_number: phone, otp: code }),
  me: () => api.get('/v1/auth/me'),
  updateProfile: (data: any) => api.patch('/v1/auth/me/profile', data),
  publicProfile: (userId: string) => api.get(`/v1/auth/users/${userId}/public`),
};

// ── KYC ──────────────────────────────────────────────────────────────────────
export const KYC = {
  status: () => api.get('/v1/kyc/status'),
  consent: (consentType: string) => api.post('/v1/kyc/consent', { consent_type: consentType }),
  initiateAadhaar: () => api.post('/v1/kyc/aadhaar/initiate'),
  verifyAadhaar: (otp: string, requestId: string) => api.post('/v1/kyc/aadhaar/verify', { request_id: requestId, otp }),
  verifyPan: (pan: string) => api.post('/v1/kyc/pan/verify', { pan_number: pan }),
  livenessSession: () => api.post('/v1/kyc/liveness/session'),
  livenessVerify: (sessionId: string) => api.post('/v1/kyc/liveness/verify', { session_id: sessionId }),
  confirmAddress: (addr: any) => api.post('/v1/kyc/address/confirm', addr),
  verifyPayout: (accountType: string, accountValue: string) =>
    api.post('/v1/kyc/payout-account/verify', { account_type: accountType, account_value: accountValue }),
};

// ── Listings ─────────────────────────────────────────────────────────────────
export const Listings = {
  browse: (p: BrowseParams = {}) => api.get('/v1/listings', { params: p }),
  search: (q: string, p: BrowseParams = {}) => api.get('/v1/listings/search', { params: { q, ...p } }),
  get: (id: string) => api.get(`/v1/listings/${id}`),
  create: (d: any) => api.post('/v1/listings', d),
  publish: (id: string) => api.post(`/v1/listings/${id}/publish`),
  categories: () => api.get('/v1/listings/categories'),
  delete: (id: string) => api.delete(`/v1/listings/${id}`),
  // FIX BUG-04: send correct values matching backend MarkSoldRequest regex
  markSold: (id: string, soldWhere: string = 'on_owmee') => api.post(`/v1/listings/${id}/mark-sold`, { sold_where: soldWhere }),

  // FIX BUG-01: Add presigned upload flow (3-step: request → PUT → confirm)
  requestImageUpload: (listingId: string, contentType: string = 'image/jpeg', sortOrder: number = 0) =>
    api.post(`/v1/listings/${listingId}/images/request`, { content_type: contentType, sort_order: sortOrder }),
  confirmImageUpload: (listingId: string, r2Key: string, isPrimary: boolean = false, sortOrder: number = 0) =>
    api.post(`/v1/listings/${listingId}/images/confirm`, { r2_key: r2Key, sort_order: sortOrder, is_primary: isPrimary }),

  // FIX BUG-03: Add my listings endpoint (returns all statuses including drafts)
  myListings: (statusFilter?: string) =>
    api.get('/v1/listings/me/listings', { params: statusFilter ? { status_filter: statusFilter } : {} }),

  // NOTE: PATCH /v1/listings/{id} does not exist in backend yet — removed Listings.update
  // Use markSold or delete instead. Pause functionality requires backend work.
};

// ── Offers ───────────────────────────────────────────────────────────────────
export const Offers = {
  // FIX BUG-11: include offer_note in request body
  create: (lid: string, amt: number, note?: string) =>
    api.post('/v1/offers', { listing_id: lid, offered_price: amt, offer_note: note || undefined }),
  accept: (id: string) => api.post(`/v1/offers/${id}/accept`),
  reject: (id: string, reason?: string) => api.post(`/v1/offers/${id}/reject`, { reason: reason || '' }),
  counter: (id: string, amt: number) => api.post(`/v1/offers/${id}/counter`, { counter_price: amt }),
  withdraw: (id: string) => api.post(`/v1/offers/${id}/withdraw`),
  received: () => api.get('/v1/offers/received'),
  sent: () => api.get('/v1/offers/sent'),
};

// ── Transactions ─────────────────────────────────────────────────────────────
export const Transactions = {
  list: () => api.get('/v1/transactions'),
  get: (id: string) => api.get(`/v1/transactions/${id}`),
  confirmMeetup: (id: string, meetupAt?: string) => api.post(`/v1/transactions/${id}/meetup`, { meetup_at: meetupAt || new Date(Date.now() + 86400000).toISOString() }),
  cancelAtMeetup: (id: string, reason: string) => api.post(`/v1/transactions/${id}/cancel-meetup`, { reason }),
  confirmDeal: (id: string) => api.post(`/v1/transactions/${id}/confirm`),
  // FIX BUG-06: map boolean to string for item_as_described
  rate: (id: string, stars: number, ok: boolean, note?: string) =>
    api.post(`/v1/transactions/${id}/rate`, { stars, item_as_described: ok ? 'yes' : 'no', comment: note }),
};

// ── Wishlist ─────────────────────────────────────────────────────────────────
export const Wishlist = {
  list: () => api.get('/v1/wishlist'),
  add: (lid: string) => api.post(`/v1/wishlist/${lid}`),
  remove: (lid: string) => api.delete(`/v1/wishlist/${lid}`),
};

// ── Notifications ────────────────────────────────────────────────────────────
export const Notifications = {
  list: (unreadOnly = false) => api.get('/v1/notifications', { params: { unread_only: unreadOnly } }),
  markRead: (id: string) => api.post(`/v1/notifications/${id}/read`),
  unreadCount: () => api.get('/v1/notifications/unread-count'),
  preferences: () => api.get('/v1/notifications/preferences'),
  updatePreferences: (prefs: any) => api.put('/v1/notifications/preferences', prefs),
};

// ── Orders (Buy Now) ──────────────────────────────────────────────────
export const Orders = {
  buyNow: (listingId: string) => api.post('/v1/orders/buy-now', { listing_id: listingId }),
};

// ── Disputes ──────────────────────────────────────────────────────────
export const Disputes = {
  raise: (transactionId: string, reason: string, description: string) =>
    api.post('/v1/disputes', { transaction_id: transactionId, reason, description }),
  get: (disputeId: string) => api.get(`/v1/disputes/${disputeId}`),
};

// ── Returns ──────────────────────────────────────────────────────────
export const Returns = {
  initiate: (transactionId: string, reason: string) =>
    api.post(`/v1/transactions/${transactionId}/return`, { reason }),
  getStatus: (transactionId: string) =>
    api.get(`/v1/transactions/${transactionId}/return`),
};

// ── Reports & Block ──────────────────────────────────────────────────
export const Reports = {
  reportListing: (listingId: string, reportType: string, description?: string) =>
    api.post(`/v1/reports/listing/${listingId}`, { report_type: reportType, description }),
  reportUser: (userId: string, reportType: string, description?: string) =>
    api.post(`/v1/reports/user/${userId}`, { report_type: reportType, description }),
  // Fix #17: blockUser — POST to backend (stores block, hides listings)
  blockUser: (userId: string) =>
    api.post(`/v1/reports/user/${userId}/block`),
};

// Stubs for endpoints not yet in backend (Phase 3+)
export const SellerDashboard = { stats: async () => ({ data: null }) };
export const ActivityFeed = { get: async () => ({ data: null }) };

// Dev tools
export const DevTools = {
  approveKyc: (phone: string) => api.post(`/v1/dev/kyc-approve/${phone}`),
  simulatePayment: (linkId: string) => api.get(`/v1/dev/pay/${linkId}`),
};


export const Reputation = { me: () => api.get('/v1/users/me/reputation') };
