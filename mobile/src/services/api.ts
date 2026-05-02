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
      isRefreshing = false;
      return Promise.reject(error);
    }

    try {
      const res = await axios.post(`${BASE}/v1/auth/token/refresh`, { refresh_token: refreshToken }, { timeout: REQUEST_TIMEOUT });
      const {
        access_token,
        refresh_token: newRefresh,
        tier,
        kyc_status,
        auth_state,
        buyer_eligible,
        seller_tier,
        role,
      } = res.data;
      const userId = extractUserId(access_token);
      useAuthStore.getState().setTokens(
        access_token, newRefresh, userId,
        tier, kyc_status,
        auth_state, buyer_eligible, seller_tier, role,
      );
      processQueue(null, access_token);
      orig.headers.Authorization = `Bearer ${access_token}`;
      return api(orig);
    } catch (refreshErr) {
      // Only wipe the session for *definitive* auth failures (401/403 from
      // the refresh endpoint = the refresh token is genuinely dead).
      // Network errors, timeouts, 5xx, or "API restarting" must NOT log
      // the user out — they'd be forced through OTP again on the next
      // launch despite holding valid credentials. This bug was reported
      // by the user: close + reopen during a backend hot-reload window
      // would silently log them out.
      const status = (refreshErr as AxiosError)?.response?.status;
      const refreshTokenIsDead = status === 401 || status === 403;
      if (refreshTokenIsDead) {
        try { useAuthStore.getState().logout(); } catch {}
      }
      processQueue(refreshErr, null);
      return Promise.reject(refreshErr);
    } finally {
      isRefreshing = false;
    }
  }
);

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
  listing_source?: 'self_prep' | 'fe_assisted';
  fe_visit_id?: string;
  reviewed_by?: 'none' | 'fe' | 'ops' | 'fe_and_ops';
  // Returned by Sprint 8 ai_assistant flow when an IMEI passes CEIR check
  imei_verified?: boolean;
  // Sprint 4 / Pass 3 — set on listings published through the kids
  // category. Renders the safety checklist on detail.
  kids_safety_checklist?: { age_range?: string; cleaned?: boolean; sanitized?: boolean; defects?: string[] } | null;
  seller?: { kyc_verified?: boolean; avg_rating?: number; deal_count?: number; name?: string };
}

// Sprint 8: feed-specific listing shape (returned by /v1/feed/* endpoints).
// Differs from Listing by including precomputed seller_name, is_owmee_verified,
// distance_km. Other fields are a subset.
export interface FeedListing {
  id: string;
  title: string;
  description: string | null;
  price: number;
  original_price: number | null;
  discount_pct: number | null;
  image_urls: string[];
  thumbnail_url: string | null;
  city: string | null;
  state: string | null;
  category_slug: string | null;
  shipping_eligible: boolean;
  created_at: string | null;
  seller_id: string;
  seller_name: string;
  is_owmee_verified: boolean;
  distance_km: number | null;
}

export interface BlockbusterResponse {
  items: FeedListing[];
  count: number;
}

export interface ExploreFeedResponse {
  items: FeedListing[];
  next_cursor: string | null;
  current_radius_km: number;
  page: number;
}

// Sprint 8: geo proxy types
export interface ReverseGeocodeResponse {
  display_name: string;
  full_address: string;
  neighborhood: string | null;
  city: string;
  state: string;
  pincode: string | null;
  country: string;
}

export interface GeoSearchResult {
  display_name: string;
  full_address: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
}

export interface Offer {
  id: string; listing_id: string; listing_title: string; listing_price: number;
  listing_thumbnail?: string; offered_price?: number; amount: number;
  note?: string; status: string; counter_price?: number;
  expires_at?: string; created_at: string;
  // Sprint 6b — offer v2 mechanics. Optional because older API responses
  // (or older transactions returned alongside) may not include them.
  update_count?: number;
  updates_remaining?: number;
  counter_expires_at?: string | null;
  lockout_until?: string | null;
}

export interface Transaction {
  id: string; listing_id: string; listing_title: string; buyer_id: string; seller_id: string;
  amount: number; status: string; created_at: string;
  payment_link?: string; payment_link_status?: string;
  // gross_amount is what the buyer actually paid (= amount + delivery_fee
  // if the category has a delivery fee — see Sprint pricing-rewrite).
  // Returned by /v1/transactions/{id} but legacy code reads `amount`.
  gross_amount?: number;
  delivery_fee?: number;
  net_payout?: number;
  tds_withheld?: number;
}

export interface BrowseParams {
  city?: string; category_slug?: string; condition?: string;
  min_price?: number; max_price?: number; kids_only?: boolean;
  lat?: number; lng?: number; radius_km?: number;
  sort?: string; limit?: number; offset?: number;
}

export interface FEVisit {
  id: string;
  seller_id: string;
  fe_id: string | null;
  fe_code: string | null;
  status: 'requested' | 'scheduled' | 'in_progress' | 'completed' | 'postponed' | 'cancelled' | 'no_show';
  outcome: string | null;
  outcome_reason: string | null;
  category_hint: string;
  item_notes: string | null;
  notes_tags: string[];
  /** Concierge Phase 2: 4-digit code shared at the door. Null until generated. */
  arrival_verification_code: string | null;
  arrival_confirmed_by_seller_at: string | null;
  address: any;
  requested_slot_start: string;
  requested_slot_end: string;
  scheduled_slot_start: string | null;
  scheduled_slot_end: string | null;
  listing_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/** Concierge Phase 1 booking request — replaces the legacy embedded address payload. */
export interface ConciergeBookingRequest {
  requested_slot_start: string;  // ISO
  requested_slot_end: string;    // ISO
  address_id: string;
  notes?: string | null;
  notes_tags?: string[];
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
  markSold: (id: string, soldWhere: string = 'on_owmee') => api.post(`/v1/listings/${id}/mark-sold`, { sold_where: soldWhere }),
  requestImageUpload: (listingId: string, contentType: string = 'image/jpeg', sortOrder: number = 0) =>
    api.post(`/v1/listings/${listingId}/images/request`, { content_type: contentType, sort_order: sortOrder }),
  confirmImageUpload: (listingId: string, r2Key: string, isPrimary: boolean = false, sortOrder: number = 0) =>
    api.post(`/v1/listings/${listingId}/images/confirm`, { r2_key: r2Key, sort_order: sortOrder, is_primary: isPrimary }),
  myListings: (statusFilter?: string) =>
    api.get('/v1/listings/me/listings', { params: statusFilter ? { status_filter: statusFilter } : {} }),
};

// ── Sprint 8: Feed (blockbuster deals + explore) ────────────────────────────
export const Feed = {
  /** GET /v1/feed/blockbuster-deals — top discounted listings in user's state */
  blockbusterDeals: () => api.get<BlockbusterResponse>('/v1/feed/blockbuster-deals'),

  /** GET /v1/feed/explore — infinite explore feed with exponential radius */
  explore: (page: number = 0, cursor?: string | null) => {
    const params: any = { page };
    if (cursor) params.cursor = cursor;
    return api.get<ExploreFeedResponse>('/v1/feed/explore', { params });
  },
};

// ── Sprint 8: Geo (Nominatim proxy with backend caching) ────────────────────
export const Geo = {
  /** GET /v1/geo/reverse?lat=&lng= — legacy Nominatim flat shape (used by old LocationPickerScreen). */
  reverse: (lat: number, lng: number) =>
    api.get<ReverseGeocodeResponse>('/v1/geo/reverse', { params: { lat, lng } }),

  /** GET /v1/geo/search?q= — forward search, India-biased. */
  search: (q: string) =>
    api.get<{ results: GeoSearchResult[] }>('/v1/geo/search', { params: { q } }),

  /**
   * GET /v1/geo/reverse-geocode?lat=&lng=
   * Address-PRD shape used by the new 3-screen address flow.
   * Backed by Photon, cached 1h. Returns 503 if reverse-geocoding fails;
   * caller should handle that by showing the map without auto-fill.
   */
  reverseGeocodeStructured: (lat: number, lng: number) =>
    api.get<PhotonReverseResponse>('/v1/geo/reverse-geocode', {
      params: { lat, lng },
    }),
};

/** Response shape for /v1/geo/reverse-geocode (Photon-backed). */
export interface PhotonReverseResponse {
  approximate_address: string;
  address_line_1: string | null;
  locality: string | null;
  city: string;
  state: string;
  country: string;
  pincode: string | null;
  in_service_area: boolean;
  raw_provider_response?: unknown;
}

// ── Address-PRD: saved-address CRUD ─────────────────────────────────────────

/** A saved address row, as returned by /v1/users/me/addresses. */
export interface UserAddress {
  id: string;
  label: 'home' | 'work' | 'other';
  custom_label: string | null;
  lat: number;
  lng: number;
  flat_house_number: string;
  building_name: string | null;
  floor: string | null;
  landmark: string | null;
  address_line_1: string | null;
  locality: string | null;
  city: string;
  state: string;
  pincode: string | null;
  is_default: boolean;
  source: 'gps_detected' | 'manual' | 'imported_from_profile';
}

export interface CreateAddressRequest {
  label: 'home' | 'work' | 'other';
  custom_label?: string | null;
  lat: number;
  lng: number;
  flat_house_number: string;
  building_name?: string | null;
  floor?: string | null;
  landmark?: string | null;
  address_line_1?: string | null;
  locality?: string | null;
  city: string;
  state: string;
  pincode?: string | null;
  is_default?: boolean;
  source?: 'gps_detected' | 'manual';
}

export const Addresses = {
  /** GET /v1/users/me/addresses — default first, then created_at desc. */
  list: () => api.get<UserAddress[]>('/v1/users/me/addresses'),

  /** POST /v1/users/me/addresses — auto-defaults if user has none yet. */
  create: (body: CreateAddressRequest) =>
    api.post<UserAddress>('/v1/users/me/addresses', body),

  /** PATCH /v1/users/me/addresses/{id} — partial update; flipping is_default
   *  to true atomically demotes other defaults. */
  update: (id: string, body: Partial<CreateAddressRequest>) =>
    api.patch<UserAddress>(`/v1/users/me/addresses/${id}`, body),

  /** DELETE /v1/users/me/addresses/{id} — promotes most-recent remaining
   *  address to default if the deleted row was default. 204 on success. */
  delete: (id: string) =>
    api.delete<void>(`/v1/users/me/addresses/${id}`),
};

// ── Sprint 8: Profile location ──────────────────────────────────────────────
export const Profile = {
  /** POST /v1/users/me/location — save user's exact location to backend */
  setLocation: (data: {
    lat: number;
    lng: number;
    display_name: string;
    full_address: string;
    city: string;
    state: string;
    pincode?: string;
    source?: string;
  }) => api.post<{ ok: boolean; display_name: string }>('/v1/users/me/location', data),
};

// ── Offers ───────────────────────────────────────────────────────────────────
export const Offers = {
  create: (lid: string, amt: number, note?: string) =>
    api.post('/v1/offers', { listing_id: lid, offered_price: amt, offer_note: note || undefined }),
  accept: (id: string) => api.post(`/v1/offers/${id}/accept`),
  reject: (id: string, reason?: string) => api.post(`/v1/offers/${id}/reject`, { reason: reason || '' }),
  counter: (id: string, amt: number) => api.post(`/v1/offers/${id}/counter`, { counter_price: amt }),
  withdraw: (id: string) => api.post(`/v1/offers/${id}/withdraw`),
  received: () => api.get('/v1/offers/received'),
  sent: () => api.get('/v1/offers/sent'),
  // Sprint 6b — buyer revises their own offer. Capped at 3 updates server-side.
  updatePrice: (id: string, newPrice: number) =>
    api.post(`/v1/offers/${id}/update-price`, { new_price: newPrice }),
};

// ── Transactions ─────────────────────────────────────────────────────────────
// Sprint 6c: meetup endpoints removed (confirmMeetup, cancelAtMeetup);
// logistics is fully managed. Tracking endpoint added for the new flow.
export const Transactions = {
  list: () => api.get('/v1/transactions'),
  get: (id: string) => api.get(`/v1/transactions/${id}`),
  tracking: (id: string) => api.get<TrackingResponse>(`/v1/transactions/${id}/tracking`),
  confirmDeal: (id: string) => api.post(`/v1/transactions/${id}/confirm`),
  rate: (id: string, stars: number, ok: boolean, note?: string) =>
    api.post(`/v1/transactions/${id}/rate`, { stars, item_as_described: ok ? 'yes' : 'no', comment: note }),
};

export interface TrackingStep {
  step: 'payment_captured' | 'fe_pickup' | 'at_hub' | 'routed_for_delivery' | 'delivered';
  at: string | null;
  label: string;
  done: boolean;
}

export interface TrackingResponse {
  transaction_id: string;
  status: string;
  timeline: TrackingStep[];
  delivery_mode: 'fe' | 'courier' | null;
  courier_name: string | null;
  courier_tracking_url: string | null;
  ack_code: string | null;
  refund_status: 'none' | 'requested' | 'processing' | 'completed' | 'failed';
  refund_amount: string | null;
  refund_reason: string | null;
  refund_completed_at: string | null;
  return_eligible: boolean;
  return_status: 'none' | 'requested' | 'approved' | 'rejected' | 'pickup_scheduled' | 'picked_up' | 'completed';
  return_reason: string | null;
  return_decision_note: string | null;
  return_requested_at: string | null;
}

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

// ── Reports & Block ──────────────────────────────────────────────────
export const Reports = {
  reportListing: (listingId: string, reportType: string, description?: string) =>
    api.post(`/v1/reports/listing/${listingId}`, { report_type: reportType, description }),
  reportUser: (userId: string, reportType: string, description?: string) =>
    api.post(`/v1/reports/user/${userId}`, { report_type: reportType, description }),
  blockUser: (userId: string) =>
    api.post(`/v1/reports/user/${userId}/block`),
};

// ── Sprint 4 / v3: Seller Tier ───────────────────────────────────────
export const SellerTier = {
  get: () => api.get('/v1/sellers/me/tier'),
  threshold: () => api.get('/v1/sellers/me/tier/threshold'),
  upgrade: () => api.post('/v1/sellers/me/tier/upgrade'),
};

// ── Sprint 4 / Pass 2: FE Visits (seller-facing) ─────────────────────
export interface SpecialistProfile {
  specialist_id: string;
  name: string;
  photo_url: string | null;
  rating_avg: number;
  visit_count_total: number;
  joined_year: number;
  verified: boolean;
  background_checked: boolean;
}

export const FEVisits = {
  /**
   * Concierge Phase 1 booking. address_id resolves to a saved
   * UserAddress; backend snapshots it into address_snapshot. notes_tags
   * is a subset of phone|laptop|audio|appliance|kids|multiple.
   */
  request: (body: ConciergeBookingRequest) =>
    api.post<FEVisit>('/v1/fe-visits/request', body),
  mine: () => api.get<FEVisit[]>('/v1/fe-visits/me'),
  get: (id: string) => api.get<FEVisit>(`/v1/fe-visits/${id}`),
  cancel: (id: string) => api.post(`/v1/fe-visits/${id}/cancel`),

  // Concierge Phase 2: trust theater
  specialistProfile: (visitId: string) =>
    api.get<SpecialistProfile>(`/v1/fe-visits/${visitId}/specialist-profile`),
  sellerConfirmArrival: (visitId: string, codeMatched: boolean) =>
    api.post<{ confirmed: boolean; alerted: boolean }>(
      `/v1/fe-visits/${visitId}/seller-confirm-arrival`,
      { code_matched: codeMatched },
    ),
};

// ── Sprint 4 / Pass 2: FE-role endpoints ─────────────────────────────
export const FE = {
  assignedVisits: () => api.get('/v1/fe/visits/assigned'),
  getVisit: (id: string) => api.get(`/v1/fe/visits/${id}`),
  startVisit: (id: string) => api.post(`/v1/fe/visits/${id}/start`),
  enforceAadhaar: (id: string) => api.post(`/v1/fe/visits/${id}/enforce-aadhaar`),
  submitListing: (id: string, payload: any) => api.post(`/v1/fe/visits/${id}/submit-listing`, payload),
  submitOutcome: (
    id: string,
    outcome: 'listed' | 'rejected_item' | 'seller_missing_verification' | 'pickup_not_ready' | 'postponed',
    outcome_reason?: string,
    listing_id?: string,
  ) => api.post(`/v1/fe/visits/${id}/outcome`, { outcome, outcome_reason, listing_id }),
  requestVisitImage: (visitId: string, contentType: string = 'image/jpeg', sortOrder: number = 0) =>
    api.post(`/v1/fe/visits/${visitId}/images/request`, { content_type: contentType, sort_order: sortOrder }),
  confirmVisitImage: (visitId: string, r2Key: string, sortOrder: number = 0) =>
    api.post(`/v1/fe/visits/${visitId}/images/confirm`, { r2_key: r2Key, sort_order: sortOrder }),

  // ── Sprint 6c: post-purchase logistics (pickups + deliveries) ──────────
  myPickups: () => api.get<{ pickups: FePickup[] }>('/v1/fe/pickups'),
  completePickup: (txnId: string, payload: {
    inspection_passed: boolean;
    inspection_notes: string;
    inspection_photo_keys: string[];
  }) => api.post(`/v1/fe/pickups/${txnId}/complete`, payload),
  myDeliveries: () => api.get<{ deliveries: FePickup[] }>('/v1/fe/deliveries'),
  completeDelivery: (txnId: string, payload: {
    handover_photo_key: string;
    ack_code: string;
  }) => api.post(`/v1/fe/deliveries/${txnId}/complete`, payload),
  // Sprint return flow — FE picks up returned items
  myReturnPickups: () => api.get<{ return_pickups: FePickup[] }>('/v1/fe/return-pickups'),
  completeReturnPickup: (txnId: string) =>
    api.post(`/v1/fe/return-pickups/${txnId}/complete`),
};

// ── Returns ──────────────────────────────────────────────────────────────────
// KYC-gated server-side. Mobile catches 403 and routes to KycRequiredForAction.
export const Returns = {
  request: (transactionId: string, reason: string, description: string) =>
    api.post(`/v1/transactions/${transactionId}/return`, { reason, description }),
};

export interface FePickup {
  transaction_id: string;
  status: string;
  listing_title: string | null;
  gross_amount: string;
  delivery_fee: string;
  delivery_mode: 'fe' | 'courier' | null;
  pickup_fe_id: string | null;
  delivery_fe_id: string | null;
  courier_name: string | null;
  courier_booking_id: string | null;
  courier_tracking_url: string | null;
  pickup_inspection_passed: boolean | null;
  pickup_inspection_notes: string | null;
  delivery_handover_photo_key: string | null;
  at_hub_at: string | null;
  routed_at: string | null;
  delivered_at: string | null;
}

// Stubs for endpoints not yet in backend (Phase 3+)
export const SellerDashboard = { stats: async () => ({ data: null }) };
export const ActivityFeed = { get: async () => ({ data: null }) };

// Dev tools
export const DevTools = {
  approveKyc: (phone: string) => api.post(`/v1/dev/kyc-approve/${phone}`),
  simulatePayment: (linkId: string) => api.get(`/v1/dev/pay/${linkId}`),
  makeFE: (phone: string, city: string = 'Bengaluru') =>
    api.post(`/v1/dev/make-fe/${phone}`, null, { params: { city } }),
};

export const Reputation = { me: () => api.get('/v1/users/me/reputation') };

// ── Sprint 7 / Phase 1: Community ────────────────────────────────────────────
export const Community = {
  me: () => api.get('/v1/community/me'),
  validateReferral: (code: string) =>
    api.post('/v1/community/referral/validate', { code }),
  joinByReferral: (code: string) =>
    api.post('/v1/community/join-by-referral', { code }),
  requestProofUpload: (contentType: string = 'image/jpeg') =>
    api.post('/v1/community/verify/upload/request', { content_type: contentType }),
  submitVerification: (data: {
    community_id?: string;
    requested_community_name?: string;
    proof_r2_key?: string;
    notes?: string;
  }) => api.post('/v1/community/verify/submit', data),
  safeMeetupPoints: () => api.get('/v1/community/safe-meetup-points'),
  list: (city?: string) =>
    api.get('/v1/community/list', { params: city ? { city } : undefined }),
};

// ── Sprint 8 Phase 2: AI-Assisted Listing ────────────────────────────────  // SPRINT8_PHASE2_AI
// Added by the Phase 2 mobile bundle. Provides multipart upload helpers
// for the photo-first listing flow and JSON helpers for the rest.

export interface AIDetectedFields {
  category_slug: string | null;
  category_confidence: number;
  brand: string | null;
  model: string | null;
  storage: string | null;
  color: string | null;
  condition_guess: string | null;
  title_suggestion: string | null;
  description_suggestion: string | null;
  flags: string[];
}

export interface AIComparable {
  title: string;
  price: number;
  days_ago: number;
  city: string | null;
  image_url: string | null;
}

export interface AIDraftResponse {
  draft_id: string;
  photo_url: string;
  detected: AIDetectedFields;
  suggested_price: number | null;
  price_source: 'comparables' | 'ai' | 'none';
  comparables: AIComparable[];
  expires_at: string;
  needs_identifier: boolean;
  fallback_reason: string | null;
}

export interface AIExtractIMEIResponse {
  imei: string | null;
  confidence: number;
  luhn_valid: boolean;
  ceir_status: string | null;
  extracted_text: string | null;
  suggest_manual: boolean;
}

export interface AICreateFromDraftRequest {
  draft_id: string;
  title: string;
  price: number;
  condition: string;
  category_slug: string;
  brand?: string | null;
  model?: string | null;
  storage?: string | null;
  color?: string | null;
  description?: string | null;
  imei_1?: string | null;
  imei_2?: string | null;
  serial_number?: string | null;
  image_urls?: string[];
  video_url?: string | null;
}

export interface AICreateFromDraftResponse {
  listing_id: string;
  listing_state: string;
  status: string;
  title: string;
  price: number;
}

export interface AISellerInfoNeededResponse {
  pickup_address_needed: boolean;
  accessories_needed: boolean;
  payout_kyc_needed: boolean;
  listing_state: string;
}

export const AIListing = {
  // SPRINT8_PHASE2_GEMINI_V2 — multi-image upload (1-6 photos)
  /** Upload multiple photos. AI sees all angles in one Gemini call. */
  draftFromImages: (imageUris: string[]) => {
    const form = new FormData();
    imageUris.forEach((uri, i) => {
      const name = uri.split('/').pop() || `photo_${i}.jpg`;
      form.append('images', {
        uri,
        type: 'image/jpeg',
        name,
      } as any);
    });
    return api.post<AIDraftResponse>('/v1/listings/draft/from-images', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT,
    });
  },

  /** Upload a photo to create a draft. AI returns category/brand/model/price. */
  draftFromImage: (imageUri: string, fileName: string = 'photo.jpg') => {
    const form = new FormData();
    // RN-specific: must pass {uri, type, name} object, not Blob
    form.append('image', {
      uri: imageUri,
      type: 'image/jpeg',
      name: fileName,
    } as any);
    return api.post<AIDraftResponse>('/v1/listings/draft/from-image', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT,
    });
  },

  /** Photo of IMEI sticker → OCR + Luhn + CEIR check. */
  extractIMEI: (draftId: string, imageUri: string) => {
    const form = new FormData();
    form.append('image', {
      uri: imageUri,
      type: 'image/jpeg',
      name: 'imei.jpg',
    } as any);
    return api.post<AIExtractIMEIResponse>(
      `/v1/listings/draft/${draftId}/extract-imei`,
      form,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: UPLOAD_TIMEOUT,
      },
    );
  },

  /** Convert a draft + final fields into a real listing in pending_buyer state. */
  createFromDraft: (body: AICreateFromDraftRequest) =>
    api.post<AICreateFromDraftResponse>('/v1/listings/from-draft', body),

  /** What info do we still need from the seller for this listing? */
  sellerInfoNeeded: (listingId: string) =>
    api.get<AISellerInfoNeededResponse>(`/v1/listings/${listingId}/seller-info-needed`),

  /** Progressive collection (pickup address, accessories). */
  updateSellerInfo: (listingId: string, info: {
    pickup_address?: string;
    pickup_pincode?: string;
    accessories?: string;
    available_slots?: string[];
  }) => api.post(`/v1/listings/${listingId}/seller-info`, info),

  /** State-locked field edits. Note path uses /ai suffix to avoid collision
   *  with the existing GET /v1/listings/{id} endpoint. */
  edit: (listingId: string, fields: {
    title?: string;
    description?: string;
    price?: number;
    condition?: string;
    brand?: string;
    model?: string;
    storage?: string;
    color?: string;
    accessories?: string;
  }) => api.patch(`/v1/listings/${listingId}/ai`, fields),

  /** Re-run Claude haiku to regenerate the description from current fields. */
  regenerateDescription: (listingId: string) =>
    api.post<{ description: string; ai_model: string }>(
      `/v1/listings/${listingId}/regenerate-description`,
    ),
};

