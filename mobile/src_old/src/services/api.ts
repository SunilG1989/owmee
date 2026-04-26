/**
 * Owmee API Service
 * Typed wrapper over all backend endpoints.
 * Base URL configurable per environment.
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  message: string;
}

export interface User {
  user_id: string;
  tier: 'basic' | 'verified';
  kyc_status: string;
  phone_verified: boolean;
}

export interface Listing {
  id: string;
  title: string;
  price: string;
  condition: 'new' | 'like_new' | 'good' | 'fair';
  status: string;
  city: string;
  locality?: string;
  category_id: string;
  image_urls: string[];
  thumbnail_url?: string;
  view_count: number;
  seller_verified: boolean;
  is_kids_item: boolean;
  is_negotiable: boolean;
  age_suitability?: string;
  published_at?: string;
  created_at?: string;
  // detail-only
  description?: string;
  accessories?: string;
  warranty_info?: string;
  battery_health?: number;
  hygiene_status?: string;
  seller?: {
    id: string;
    kyc_verified: boolean;
    avg_rating?: number;
    deal_count: number;
    trust_score?: number;
    num_kids?: number;
    kids_age_range?: string;
  };
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  shipping_eligible: boolean;
  local_eligible: boolean;
  imei_required: boolean;
}

export interface Offer {
  id: string;
  listing_id: string;
  offered_price: string;
  counter_price?: string;
  status: string;
  expires_at: string;
  offer_note?: string;
}

export interface Transaction {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  status: string;
  transaction_type: 'local' | 'shipped';
  amount: string;
  gross_amount?: string;
  net_payout?: string;
  platform_fee?: string;
  gst_on_fee?: string;
  tds_withheld?: string;
  payment_method: 'upi' | 'cash';
  payment_link?: string;
  agreed_meetup_at?: string;
  meetup_deadline?: string;
  seller_response_deadline?: string;
  buyer_acceptance_deadline?: string;
  rate_available_at?: string;
  created_at: string;
}

export interface ActivityFeed {
  deals_completed_today: number;
  new_listings_24h: number;
  total_active_listings: number;
  city?: string;
  ticker_deals: string;
  ticker_listings: string;
}

export interface NotificationPrefs {
  transactions_enabled: boolean;
  messages_enabled: boolean;
  promotions_enabled: boolean;
}

export interface Reputation {
  current_step: string;
  next_step: string;
  deal_count: number;
  avg_rating?: number;
  kyc_verified: boolean;
  ladder: Array<{ step: string; label: string; achieved: boolean }>;
}

// ── Client setup ───────────────────────────────────────────────────────────────

import { API_BASE_URL as BASE_URL } from '../config';

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

const client: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/v1`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use(config => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

client.interceptors.response.use(
  res => res,
  (err: AxiosError<{ detail: ApiError }>) => {
    const detail = err.response?.data?.detail;
    const message = detail?.message ?? err.message ?? 'Something went wrong';
    const code = detail?.error ?? 'UNKNOWN_ERROR';
    const enhanced = Object.assign(new Error(message), { code, status: err.response?.status });
    return Promise.reject(enhanced);
  },
);

// ── Auth ───────────────────────────────────────────────────────────────────────

export const Auth = {
  sendOtp: (phone_number: string) =>
    client.post('/auth/otp/send', { phone_number }),

  verifyOtp: (phone_number: string, otp: string) =>
    client.post<{ access_token: string; refresh_token: string; tier: string; kyc_status: string }>(
      '/auth/otp/verify', { phone_number, otp }
    ),

  me: () => client.get<User>('/auth/me'),

  refresh: (refresh_token: string) =>
    client.post<{ access_token: string; refresh_token: string }>(
      '/auth/token/refresh', { refresh_token }
    ),

  logout: () => client.post('/auth/logout'),

  updateProfile: (params: { num_kids?: number; kids_age_range?: string }) =>
    client.patch('/auth/me/profile', null, { params }),
};

// ── KYC ───────────────────────────────────────────────────────────────────────

export const Kyc = {
  consent: (consent_type: string) =>
    client.post('/kyc/consent', { consent_type }),

  aadhaarInitiate: () =>
    client.post<{ request_id: string; expires_in_seconds: number }>('/kyc/aadhaar/initiate'),

  aadhaarVerify: (request_id: string, otp: string) =>
    client.post('/kyc/aadhaar/verify', { request_id, otp }),

  panVerify: (pan_number: string) =>
    client.post('/kyc/pan/verify', { pan_number }),

  livenessSession: () =>
    client.post<{ session_id: string; sdk_token: string }>('/kyc/liveness/session'),

  livenessVerify: (session_id: string) =>
    client.post('/kyc/liveness/verify', { session_id }),

  payoutVerify: (account_type: 'upi' | 'bank', account_value: string) =>
    client.post('/kyc/payout-account/verify', { account_type, account_value }),

  status: () =>
    client.get<{ kyc_status: string; steps: Record<string, boolean> }>('/kyc/status'),
};

// ── Listings ──────────────────────────────────────────────────────────────────

export const Listings = {
  categories: () =>
    client.get<{ categories: Category[] }>('/listings/categories'),

  browse: (params?: {
    city?: string; category_slug?: string; condition?: string;
    min_price?: number; max_price?: number; kids_only?: boolean;
    limit?: number; offset?: number;
  }) => client.get<{ listings: Listing[]; count: number }>('/listings', { params }),

  search: (q: string, params?: {
    city?: string; condition?: string; min_price?: number;
    max_price?: number; kids_only?: boolean; limit?: number; offset?: number;
  }) => client.get<{ listings: Listing[]; count: number; query: string }>(
    '/listings/search', { params: { q, ...params } }
  ),

  get: (id: string) => client.get<Listing>(`/listings/${id}`),

  create: (body: {
    category_id: string; title: string; description?: string;
    price: number; condition: string; city: string; state: string;
    locality?: string; imei?: string; accessories?: string;
    warranty_info?: string; battery_health?: number;
    age_suitability?: string; hygiene_status?: string;
    is_kids_item?: boolean; is_negotiable?: boolean;
  }) => client.post<{ listing_id: string; status: string }>('/listings', body),

  requestImageUpload: (listing_id: string, content_type = 'image/jpeg') =>
    client.post<{ upload_url: string; r2_key: string }>(`/listings/${listing_id}/images/request`, {
      content_type,
    }),

  confirmImageUpload: (listing_id: string, r2_key: string, is_primary = false) =>
    client.post(`/listings/${listing_id}/images/confirm`, { r2_key, is_primary }),

  publish: (listing_id: string) =>
    client.post(`/listings/${listing_id}/publish`),

  myListings: () =>
    client.get<{ listings: Listing[]; count: number }>('/listings/me/listings'),

  dashboard: () =>
    client.get('/listings/me'),

  activity: (city?: string) =>
    client.get<ActivityFeed>('/listings/activity', { params: { city } }),

  newSinceVisit: (city?: string) =>
    client.get<{ count: number; listings: Listing[]; label: string; since: string }>(
      '/listings/new-since-visit', { params: { city } }
    ),

  updatePrice: (listing_id: string, new_price: number) =>
    client.put(`/listings/${listing_id}/price`, { new_price }),

  markSold: (listing_id: string, sold_where: 'on_owmee' | 'elsewhere') =>
    client.post(`/listings/${listing_id}/mark-sold`, { sold_where }),
};

// ── Offers ────────────────────────────────────────────────────────────────────

export const Offers = {
  make: (listing_id: string, offered_price: number, offer_note?: string) =>
    client.post<{ offer: Offer }>('/offers', { listing_id, offered_price, offer_note }),

  received: () => client.get<{ offers: Offer[] }>('/offers/received'),
  sent: () => client.get<{ offers: Offer[] }>('/offers/sent'),

  counter: (offer_id: string, counter_price: number) =>
    client.post(`/offers/${offer_id}/counter`, { counter_price }),

  accept: (offer_id: string) =>
    client.post<{ transaction_id: string; payment_link: string }>(`/offers/${offer_id}/accept`),

  acceptCash: (offer_id: string) =>
    client.post<{ transaction_id: string }>(`/offers/${offer_id}/accept-cash`),

  reject: (offer_id: string, reason?: string) =>
    client.post(`/offers/${offer_id}/reject`, { reason }),

  withdraw: (offer_id: string) =>
    client.post(`/offers/${offer_id}/withdraw`),
};

// ── Transactions ──────────────────────────────────────────────────────────────

export const Transactions = {
  list: () => client.get<{ transactions: Transaction[] }>('/transactions'),
  get: (id: string) => client.get<Transaction>(`/transactions/${id}`),

  confirmMeetup: (id: string, meetup_at: string) =>
    client.post(`/transactions/${id}/meetup`, { meetup_at }),

  cancelAtMeetup: (id: string, reason: string) =>
    client.post(`/transactions/${id}/cancel-meetup`, { reason }),

  confirm: (id: string) => client.post(`/transactions/${id}/confirm`),

  rate: (id: string, stars: number, item_as_described: 'yes' | 'mostly' | 'no', comment?: string) =>
    client.post(`/transactions/${id}/rate`, { stars, item_as_described, comment }),
};

// ── Wishlist ──────────────────────────────────────────────────────────────────

export const Wishlist = {
  get: () => client.get<{ wishlist: Array<{ listing_id: string; saved_at: string }> }>('/wishlist'),
  add: (listing_id: string) => client.post(`/wishlist/${listing_id}`),
  remove: (listing_id: string) => client.delete(`/wishlist/${listing_id}`),
};

// ── Notifications ─────────────────────────────────────────────────────────────

export const Notifications = {
  list: (unread_only = false) =>
    client.get('/notifications', { params: { unread_only } }),

  unreadCount: () =>
    client.get<{ unread_count: number }>('/notifications/unread-count'),

  markRead: (id: string) =>
    client.post(`/notifications/${id}/read`),

  getPrefs: () =>
    client.get<NotificationPrefs>('/notifications/preferences'),

  updatePrefs: (prefs: NotificationPrefs) =>
    client.put('/notifications/preferences', prefs),
};

// ── Disputes & Reports ────────────────────────────────────────────────────────

export const Disputes = {
  raise: (transaction_id: string, reason: string, description: string) =>
    client.post('/disputes', { transaction_id, reason, description }),

  get: (id: string) => client.get(`/disputes/${id}`),
};

export const Reports = {
  listing: (listing_id: string, report_type: string, description?: string) =>
    client.post(`/reports/listing/${listing_id}`, { report_type, description }),

  user: (user_id: string, report_type: string, description?: string) =>
    client.post(`/reports/user/${user_id}`, { report_type, description }),
};

// ── User ──────────────────────────────────────────────────────────────────────

export const UserApi = {
  reputation: () => client.get<Reputation>('/users/me/reputation'),
};

// ── Chat ──────────────────────────────────────────────────────────────────────

export const Chat = {
  getToken: () =>
    client.get<{ token: string; user_id: string; api_key: string }>('/chat/token'),
};

// ── Devices ──────────────────────────────────────────────────────────────────

export const Devices = {
  registerFCM: (fcm_token: string) =>
    client.put('/devices/fcm', { fcm_token }),
};
