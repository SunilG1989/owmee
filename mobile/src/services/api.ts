import axios, {
  AxiosError,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { ensureAuthHydrated, useAuthStore } from '../store/authStore';
import { decodeJwtSub } from '../utils/jwt';

import { API_URL, REQUEST_TIMEOUT, UPLOAD_TIMEOUT } from '../config';
const BASE = API_URL;
const api = axios.create({ baseURL: BASE, timeout: REQUEST_TIMEOUT });

type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

type CacheEntry<T = any> = {
  expiresAt: number;
  response: AxiosResponse<T>;
};

const getCache = new Map<string, CacheEntry>();
const inFlightGets = new Map<string, Promise<AxiosResponse<any>>>();
let cacheVersion = 0;

function stableStringify(value: any): string {
  if (!value) return '';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${key}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return String(value);
}

function getCacheKey(url: string, config?: AxiosRequestConfig): string {
  const uid = useAuthStore.getState().userId || 'guest';
  return `GET ${uid}:${url}|${stableStringify(config?.params)}`;
}

function cloneResponse<T>(res: AxiosResponse<T>): AxiosResponse<T> {
  return {
    ...res,
    headers: { ...res.headers },
    data: res.data,
  };
}

function cachedGet<T = any>(
  url: string,
  config?: AxiosRequestConfig,
  ttlMs: number = 15_000,
): Promise<AxiosResponse<T>> {
  const key = getCacheKey(url, config);
  const now = Date.now();
  const cached = getCache.get(key);
  if (cached && cached.expiresAt > now) {
    return Promise.resolve(cloneResponse(cached.response as AxiosResponse<T>));
  }

  const existing = inFlightGets.get(key);
  if (existing) return existing as Promise<AxiosResponse<T>>;

  const requestVersion = cacheVersion;
  const req = api.get<T>(url, config).then((res) => {
    if (requestVersion === cacheVersion) {
      getCache.set(key, { expiresAt: Date.now() + ttlMs, response: cloneResponse(res) });
    }
    return res;
  }).finally(() => {
    inFlightGets.delete(key);
  });
  inFlightGets.set(key, req);
  return req;
}

function peekCachedGet<T = any>(
  url: string,
  config?: AxiosRequestConfig,
  includeExpired: boolean = false,
): AxiosResponse<T> | null {
  const cached = getCache.get(getCacheKey(url, config));
  if (!cached) return null;
  if (!includeExpired && cached.expiresAt <= Date.now()) return null;
  return cloneResponse(cached.response as AxiosResponse<T>);
}

export function clearApiCache(prefix?: string) {
  cacheVersion += 1;
  if (!prefix) {
    getCache.clear();
    inFlightGets.clear();
    return;
  }
  const keyPrefix = `GET `;
  for (const key of Array.from(getCache.keys())) {
    if (key.startsWith(keyPrefix) && key.includes(`:${prefix}`)) getCache.delete(key);
  }
  for (const key of Array.from(inFlightGets.keys())) {
    if (key.startsWith(keyPrefix) && key.includes(`:${prefix}`)) inFlightGets.delete(key);
  }
}

function clearApiCaches(prefixes: string[]) {
  prefixes.forEach(clearApiCache);
}

function clearListingCaches() {
  clearApiCaches(['/v1/listings', '/v1/feed']);
}

// ── Request interceptor: attach token ────────────────────────────────────────
api.interceptors.request.use(async (cfg) => {
  await ensureAuthHydrated();
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

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const orig = error.config as RetriableRequestConfig | undefined;
    if (!orig || error.response?.status !== 401) return Promise.reject(error);
    const url = orig.url || '';
    if (url.includes('/auth/otp/') || url.includes('/auth/token/refresh')) {
      return Promise.reject(error);
    }
    if (orig._retry) return Promise.reject(error);
    orig._retry = true;

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject, config: orig });
      });
    }

    isRefreshing = true;
    await ensureAuthHydrated();
    const { refreshToken } = useAuthStore.getState();

    if (!refreshToken) {
      isRefreshing = false;
      return Promise.reject(error);
    }

    try {
      const res = await axios.post(`${BASE}/v1/auth/token/refresh`, { refresh_token: refreshToken }, { timeout: REQUEST_TIMEOUT });
      const {
        access_token,
        refresh_token: newRefresh,
        user_id,
        tier,
        kyc_status,
        auth_state,
        buyer_eligible,
        seller_tier,
        role,
      } = res.data;
      const userId = user_id || decodeJwtSub(access_token);
      await useAuthStore.getState().setTokens(
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
  accessories?: string; warranty_info?: string; warranty_status?: string; battery_health?: string | number;
  age_suitability?: string; hygiene_status?: string;
  imei?: string; view_count?: number; status: string;
  listing_state?: string | null; verification_status?: string | null; video_url?: string | null;
  brand?: string; model?: string; storage?: string; ram?: string; color?: string;
  processor?: string; screen_size?: string; purchase_year?: number;
  has_box?: boolean | null; has_bill?: boolean | null; has_charger?: boolean | null; has_earphones?: boolean | null;
  water_damage_history?: boolean | null; seller_functional_attestation?: boolean | null;
  screen_condition?: string; body_condition?: string; defects?: string[];
  serial_number?: string; original_price_str?: string;
  published_at?: string; created_at?: string; distance_km?: number;
  listing_source?: 'self_prep' | 'fe_assisted';
  fe_visit_id?: string;
  reviewed_by?: 'none' | 'fe' | 'ops' | 'fe_and_ops';
  seller_trust_label?: string;
  listing_verified?: boolean;
  listing_trust_label?: string;
  trust_tier?: 'owmee_reviewed' | 'ai_assisted' | 'seller_confirmed' | 'limited' | string;
  ai_assisted?: boolean;
  seller_inventory_status?: string | null;
  seller_inventory_label?: string | null;
  seller_inventory_detail?: string | null;
  seller_next_action?: 'manage_listing' | 'open_order' | 'confirm_pickup' | 'none' | string | null;
  active_transaction_id?: string | null;
  active_transaction_status?: string | null;
  seller_readiness_status?: string | null;
  sold_at?: string | null;
  category_family?: 'device' | 'appliance' | 'toy' | 'book' | 'other' | string | null;
  category_specifics?: Record<string, any> | null;
  // Returned by Sprint 8 ai_assistant flow when an IMEI passes CEIR check
  imei_verified?: boolean;
  // Sprint 4 / Pass 3 — set on listings published through the kids
  // category. Renders the safety checklist on detail.
  kids_safety_checklist?: Record<string, boolean> | null;
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
  condition?: string | null;
  original_price: number | null;
  discount_pct: number | null;
  image_urls: string[];
  thumbnail_url: string | null;
  city: string | null;
  state: string | null;
  category_slug: string | null;
  brand?: string | null;
  model?: string | null;
  storage?: string | null;
  ram?: string | null;
  color?: string | null;
  processor?: string | null;
  screen_size?: string | null;
  purchase_year?: number | null;
  accessories?: string | null;
  warranty_info?: string | null;
  battery_health?: number | null;
  age_suitability?: string | null;
  hygiene_status?: string | null;
  has_charger?: boolean | null;
  has_earphones?: boolean | null;
  seller_functional_attestation?: boolean | null;
  shipping_eligible: boolean;
  created_at: string | null;
  seller_id: string;
  seller_name: string;
  seller_member_since?: string | null;
  seller_completed_deals?: number;
  is_owmee_verified: boolean;
  seller_verified?: boolean;
  listing_verified?: boolean;
  listing_trust_label?: string;
  seller_trust_label?: string;
  trust_tier?: 'owmee_reviewed' | 'ai_assisted' | 'seller_confirmed' | 'limited' | string;
  ai_assisted?: boolean;
  listing_source?: 'self_prep' | 'fe_assisted' | string | null;
  reviewed_by?: 'none' | 'fe' | 'ops' | 'fe_and_ops' | string | null;
  distance_km: number | null;

  // ── 2026-05-03: trust attributes for Indian-marketplace cards ─────
  // All optional. Backend can add any subset incrementally; the home
  // FeedCard renders a corresponding pill the moment a flag turns true.
  // Until then these are undefined and the pills don't render.
  // BACKEND TICKET: surface these in /v1/feed/* responses, derived from
  // the listing's seller-supplied fields + KYC + warranty registry.
  bill_available?: boolean;
  box_available?: boolean;
  warranty_active?: boolean;
  warranty_months_left?: number | null;
  is_negotiable?: boolean;
  returns_eligible?: boolean;
  cod_available?: boolean;
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
  status: string; counter_price?: number;
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
  payment_checkout?: PaymentCheckout | null;
  payment_link?: string; payment_link_status?: string;
  payment_link_expires_at?: string | null;
  seller_readiness_status?: 'pending' | 'confirmed' | 'declined' | 'expired' | string;
  seller_readiness_reason?: string | null;
  pickup_readiness_deadline?: string | null;
  seller_responded_at?: string | null;
  pickup_ready_at?: string | null;
  cancelled_at?: string | null;
  cancelled_reason?: string | null;
  refund_status?: 'none' | 'requested' | 'processing' | 'completed' | 'failed' | string;
  refund_amount?: string | null;
  refund_reason?: string | null;
  refund_completed_at?: string | null;
  seller_pickup_address?: {
    full_name?: string | null;
    phone_number?: string | null;
    full_address?: string | null;
    locality?: string | null;
    city?: string | null;
    pincode?: string | null;
  } | null;
  buyer_delivery_address?: {
    full_name?: string | null;
    phone_number?: string | null;
    full_address?: string | null;
    locality?: string | null;
    city?: string | null;
    pincode?: string | null;
  } | null;
  // gross_amount is what the buyer actually paid (= amount + delivery_fee
  // if the category has a delivery fee — see Sprint pricing-rewrite).
  // Returned by /v1/transactions/{id} but legacy code reads `amount`.
  gross_amount?: number;
  delivery_fee?: number;
  net_payout?: number;
  tds_withheld?: number;
}

export interface PaymentCheckout {
  provider: 'razorpay' | string;
  key_id: string;
  order_id: string;
  amount_paise: number;
  currency: string;
  name: string;
  description?: string;
  expires_at?: string | null;
  checkout_timeout_seconds?: number | null;
  prefill?: {
    contact?: string;
    email?: string;
    name?: string;
  };
}

export interface CheckoutPaymentSuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface CheckoutPaymentFailure {
  razorpay_order_id: string;
  razorpay_payment_id?: string | null;
  code?: string | null;
  description?: string | null;
  source?: string | null;
  step?: string | null;
  reason?: string | null;
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

export type DirectBookingStatus =
  | 'pending_fe_assignment'
  | 'assigned_to_fe'
  | 'fe_en_route'
  | 'fe_arrived'
  | 'seller_verified'
  | 'pickup_qc_in_progress'
  | 'seller_final_acceptance'
  | 'payout_ready'
  | 'payout_completed'
  | 'booking_completed'
  | 'seller_cancelled_before_visit'
  | 'seller_no_show'
  | 'fe_no_show'
  | 'item_rejected_by_fe'
  | 'seller_rejected_revised_offer'
  | 'payout_failed'
  | 'admin_cancelled'
  | 'fraud_review'
  | 'listing_draft_required'
  | string;

export interface DirectLocationPayload {
  lat: number;
  lng: number;
  accuracy_meters?: number;
  source?: string;
}

export interface DirectAcquisitionItem {
  id: string;
  category: 'toys' | 'books' | string;
  item_type: string;
  item_title: string;
  seller_photos: string[];
  pickup_photos: string[];
  seller_check_answers: Record<string, any>;
  ai_detected_type: string;
  policy_status: string;
  direct_eligibility_status: string;
  blocked_item_warnings: string[];
  qc_checklist_template_id: string;
  required_pickup_photos: string[];
  owmee_suggested_offer_inr: number;
  fe_final_offer_inr: number | null;
  price_change_percent: number | null;
  price_change_reason_code: string | null;
  approval_required: boolean;
  approval_status: string;
  qc_status: string;
  qc_answers: Record<string, any>;
  qc_evidence_manifest?: Record<string, any>;
  qc_notes: string | null;
  reject_evidence_photos?: string[];
  custody_seal_code?: string | null;
  warehouse_status?: string;
  warehouse_notes?: string | null;
  item_status: string;
}

export interface DirectAcquisitionBooking {
  id: string;
  booking_code: string;
  seller_user_id: string;
  seller_account_id: string;
  pickup_address_id: string;
  pickup_address: any;
  pickup_locality: string;
  pickup_pincode: string;
  slot_start: string;
  slot_end: string;
  status: DirectBookingStatus;
  assigned_fe_id: string | null;
  fe_code: string | null;
  assignment_method: string | null;
  item_count: number;
  estimated_total_offer_inr: number;
  final_total_payout_inr: number | null;
  fe_started_at?: string | null;
  fe_arrived_at?: string | null;
  fe_start_location?: Record<string, any>;
  fe_arrival_location?: Record<string, any>;
  seller_verified_location?: Record<string, any>;
  seller_final_acceptance_location?: Record<string, any>;
  verified_at?: string | null;
  seller_final_accepted_at?: string | null;
  payout_ready_at?: string | null;
  payout_status?: string | null;
  payout_reference_id?: string | null;
  payout_failure_reason?: string | null;
  payout_completed_at?: string | null;
  handover_completed_at?: string | null;
  warehouse_inbound_id: string | null;
  warehouse_received_at?: string | null;
  warehouse_receipt_code?: string | null;
  warehouse_receipt_notes?: string | null;
  risk_flags?: Array<string | Record<string, any>>;
  seller_otp?: string | null;
  final_acceptance_otp?: string | null;
  items: DirectAcquisitionItem[];
  created_at: string | null;
  updated_at: string | null;
}

/** Concierge Phase 1 booking request — replaces the legacy embedded address payload. */
export interface ConciergeBookingRequest {
  requested_slot_start: string;  // ISO
  requested_slot_end: string;    // ISO
  address_id: string;
  notes?: string | null;
  notes_tags?: string[];
}

export interface DirectAcquisitionBookingRequest {
  pickup_address_id: string;
  slot_start: string;
  slot_end: string;
  seller_ownership_declaration: boolean;
  estimated_visit_duration_minutes?: number;
  assignment_priority?: string | null;
  items: Array<{
    category: 'toys' | 'books';
    item_type: string;
    item_title: string;
    seller_photos: string[];
    seller_check_answers?: Record<string, any>;
    ai_detected_type: string;
    policy_status?: string;
    direct_eligibility_status?: string;
    owmee_suggested_offer_inr: number;
    offer_valid_until?: string;
    max_fe_auto_increase_allowed?: number;
    qc_checklist_template_id: string;
    required_pickup_photos?: string[];
    blocked_item_warnings?: string[];
  }>;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
export const Auth = {
  requestOtp: (phone: string) => api.post('/v1/auth/otp/send', { phone_number: phone }),
  sendOTP: (phone: string) => api.post('/v1/auth/otp/send', { phone_number: phone }),
  verifyOtp: (phone: string, code: string) => api.post('/v1/auth/otp/verify', { phone_number: phone, otp: code }),
  me: () => cachedGet('/v1/auth/me', undefined, 60_000),
  peekMe: () => peekCachedGet('/v1/auth/me', undefined, true),
  updateProfile: (data: any) =>
    api.patch('/v1/auth/me/profile', data).then((res) => {
      clearApiCache('/v1/auth/me');
      return res;
    }),
  publicProfile: (userId: string) => cachedGet(`/v1/auth/users/${userId}/public`, undefined, 300_000),
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
/**
 * Structured deletion reasons accepted by DELETE /v1/listings/{id}.
 * The backend validates server-side; sending an unknown value returns
 * 400 INVALID_REASON. Keep these in sync with _VALID_DELETION_REASONS in
 * backend/app/modules/listings/router.py.
 */
export type ListingDeletionReason =
  | 'sold_elsewhere'
  | 'changed_mind'
  | 'wrong_price'
  | 'no_buyers'
  | 'item_damaged'
  | 'other';

export const Listings = {
  browse: (p: BrowseParams = {}) => cachedGet('/v1/listings', { params: p }, 60_000),
  search: (q: string, p: BrowseParams = {}) => cachedGet('/v1/listings/search', { params: { q, ...p } }, 30_000),
  get: (id: string) => cachedGet(`/v1/listings/${id}`, undefined, 20_000),
  peek: (id: string) => peekCachedGet(`/v1/listings/${id}`, undefined, true),
  create: (d: any) =>
    api.post('/v1/listings', d).then((res) => {
      clearListingCaches();
      return res;
    }),
  publish: (id: string) =>
    api.post(`/v1/listings/${id}/publish`).then((res) => {
      clearListingCaches();
      return res;
    }),
  categories: () => cachedGet('/v1/listings/categories', undefined, 600_000),
  /**
   * Soft-delete a listing. The backend cascades:
   *   - open offers → cancelled with reason 'listing_withdrawn'
   *   - pending/scheduled FE visits → cancelled
   *   - reserved/sold listings or in_progress visits → 400 CANNOT_DELETE
   * Idempotent — calling twice on an already-removed listing returns 200.
   */
  delete: (id: string, reason?: ListingDeletionReason, note?: string) =>
    api.delete(`/v1/listings/${id}`, {
      data: reason ? { reason, note: note ?? null } : undefined,
    }).then((res) => {
      clearListingCaches();
      return res;
    }),
  /**
   * Edit a published listing. Backed by PATCH /v1/listings/{id}/ai which
   * locks edits once a buyer has committed (state ∉ {draft_ai,
   * pending_buyer}). Returns { updated_fields, locked_reason? }.
   */
  update: (id: string, fields: Partial<{
    title: string;
    description: string;
    price: number;
    condition: string;
    brand: string;
    model: string;
    storage: string;
    ram: string;
    processor: string;
    screen_size: string;
    color: string;
    purchase_year: number;
    battery_health: number;
    accessories: string;
    warranty_status: string;
    age_suitability: string;
    hygiene_status: string;
    screen_condition: string;
    body_condition: string;
    defects: string[];
    has_box: boolean;
    has_bill: boolean;
    has_charger: boolean;
    has_earphones: boolean;
    water_damage_history: boolean;
    seller_functional_attestation: boolean;
  }>) =>
    api.patch(`/v1/listings/${id}/ai`, fields).then((res) => {
      clearListingCaches();
      return res;
    }),
  markSold: (id: string, soldWhere: 'elsewhere' = 'elsewhere') =>
    api.post(`/v1/listings/${id}/mark-sold`, { sold_where: soldWhere }).then((res) => {
      clearListingCaches();
      return res;
    }),
  requestImageUpload: (listingId: string, contentType: string = 'image/jpeg', sortOrder: number = 0) =>
    api.post(`/v1/listings/${listingId}/images/request`, { content_type: contentType, sort_order: sortOrder }),
  confirmImageUpload: (listingId: string, r2Key: string, isPrimary: boolean = false, sortOrder: number = 0) =>
    api.post(`/v1/listings/${listingId}/images/confirm`, { r2_key: r2Key, sort_order: sortOrder, is_primary: isPrimary })
      .then((res) => {
        clearListingCaches();
        return res;
      }),
  myListings: (statusFilter?: string) => {
    clearApiCache('/v1/listings/me/listings');
    return api.get('/v1/listings/me/listings', { params: statusFilter ? { status_filter: statusFilter } : {} });
  },
  peekMyListings: (statusFilter?: string) =>
    peekCachedGet('/v1/listings/me/listings', { params: statusFilter ? { status_filter: statusFilter } : {} }, true),
};

// ── Sprint 8: Feed (blockbuster deals + explore) ────────────────────────────
export const Feed = {
  /** GET /v1/feed/blockbuster-deals — top discounted listings in user's state */
  blockbusterDeals: () => cachedGet<BlockbusterResponse>('/v1/feed/blockbuster-deals', undefined, 20_000),

  /** GET /v1/feed/explore — infinite explore feed with exponential radius */
  explore: (page: number = 0, cursor?: string | null) => {
    const params: any = { page };
    if (cursor) params.cursor = cursor;
    return cachedGet<ExploreFeedResponse>('/v1/feed/explore', { params }, 20_000);
  },
};

// ── Sprint 8: Geo (Nominatim proxy with backend caching) ────────────────────
export const Geo = {
  /** GET /v1/geo/reverse?lat=&lng= — legacy flat shape. New address flow uses structured reverse geocoding below. */
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
  // Per-address contact (P0 trust-floor 2026-05-03; BE schema upgrade required).
  // Indian e-com universally lets the recipient name + phone differ from the
  // account holder — gift deliveries, alternate contact for couriers.
  // Nullable on the response because legacy rows pre-2026-05-03 don't have
  // them yet; the backfill migration 0038b populates from the parent user.
  full_name: string | null;
  phone_number: string | null;
  flat_house_number: string;
  building_name: string | null;
  floor: string | null;
  landmark: string | null;
  // Read-shape: nullable to match the BE response schema (legacy rows were
  // saved with NULLs before the create-time required-rule landed).
  // CreateAddressRequest below makes them required at write time.
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
  full_name: string;
  phone_number: string;
  flat_house_number: string;
  building_name?: string | null;
  floor?: string | null;
  landmark?: string | null;
  address_line_1: string;
  locality: string;
  city: string;
  state: string;
  pincode: string;
  is_default?: boolean;
  source?: 'gps_detected' | 'manual';
}

export const Addresses = {
  /** GET /v1/users/me/addresses — default first, then created_at desc. */
  list: () => cachedGet<UserAddress[]>('/v1/users/me/addresses', undefined, 60_000),

  /** POST /v1/users/me/addresses — auto-defaults if user has none yet. */
  create: (body: CreateAddressRequest) =>
    api.post<UserAddress>('/v1/users/me/addresses', body).then((res) => {
      clearApiCache('/v1/users/me/addresses');
      return res;
    }),

  /** PATCH /v1/users/me/addresses/{id} — partial update; flipping is_default
   *  to true atomically demotes other defaults. */
  update: (id: string, body: Partial<CreateAddressRequest>) =>
    api.patch<UserAddress>(`/v1/users/me/addresses/${id}`, body).then((res) => {
      clearApiCache('/v1/users/me/addresses');
      return res;
    }),

  /** DELETE /v1/users/me/addresses/{id} — promotes most-recent remaining
   *  address to default if the deleted row was default. 204 on success. */
  delete: (id: string) =>
    api.delete<void>(`/v1/users/me/addresses/${id}`).then((res) => {
      clearApiCache('/v1/users/me/addresses');
      return res;
    }),
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
  create: (lid: string, amt: number) =>
    api.post('/v1/offers', { listing_id: lid, offered_price: amt }).then((res) => {
      clearApiCaches(['/v1/offers', '/v1/transactions']);
      return res;
    }),
  accept: (id: string) => api.post(`/v1/offers/${id}/accept`).then((res) => {
    clearApiCaches(['/v1/offers', '/v1/transactions']);
    clearListingCaches();
    return res;
  }),
  reject: (id: string, reason?: string) => api.post(`/v1/offers/${id}/reject`, { reason: reason || '' }).then((res) => {
    clearApiCache('/v1/offers');
    return res;
  }),
  counter: (id: string, amt: number) => api.post(`/v1/offers/${id}/counter`, { counter_price: amt }).then((res) => {
    clearApiCache('/v1/offers');
    return res;
  }),
  withdraw: (id: string) => api.post(`/v1/offers/${id}/withdraw`).then((res) => {
    clearApiCache('/v1/offers');
    return res;
  }),
  received: () => cachedGet('/v1/offers/received', undefined, 15_000),
  sent: () => cachedGet('/v1/offers/sent', undefined, 15_000),
  peekReceived: () => peekCachedGet('/v1/offers/received', undefined, true),
  peekSent: () => peekCachedGet('/v1/offers/sent', undefined, true),
  // Sprint 6b — buyer revises their own offer. Capped at 3 updates server-side.
  updatePrice: (id: string, newPrice: number) =>
    api.post(`/v1/offers/${id}/update-price`, { new_price: newPrice }).then((res) => {
      clearApiCache('/v1/offers');
      return res;
    }),
};

// ── Transactions ─────────────────────────────────────────────────────────────
// Sprint 6c: direct seller-buyer handoff endpoints removed;
// logistics is fully managed. Tracking endpoint added for the new flow.
export const Transactions = {
  list: () => cachedGet('/v1/transactions', undefined, 15_000),
  peekList: () => peekCachedGet('/v1/transactions', undefined, true),
  get: (id: string) => cachedGet(`/v1/transactions/${id}`, undefined, 15_000),
  tracking: (id: string) => cachedGet<TrackingResponse>(`/v1/transactions/${id}/tracking`, undefined, 15_000),
  confirmDeal: (id: string) => api.post(`/v1/transactions/${id}/confirm`),
  confirmSellerReadiness: (id: string, body?: {
    pickup_address_id?: string;
    item_available?: boolean;
    condition_unchanged?: boolean;
    accessories_confirmed?: boolean;
  }) => api.post(`/v1/transactions/${id}/seller-readiness/confirm`, {
    item_available: true,
    condition_unchanged: true,
    accessories_confirmed: true,
    ...(body || {}),
  }).then((res) => {
    clearApiCaches(['/v1/transactions', `/v1/transactions/${id}`, `/v1/transactions/${id}/tracking`]);
    clearListingCaches();
    return res;
  }),
  declineSellerReadiness: (id: string, reason: 'sold_elsewhere' | 'item_damaged' | 'changed_mind' | 'cannot_pickup' | 'other') =>
    api.post(`/v1/transactions/${id}/seller-readiness/decline`, { reason }).then((res) => {
      clearApiCaches(['/v1/transactions', `/v1/transactions/${id}`, `/v1/transactions/${id}/tracking`]);
      clearListingCaches();
      return res;
    }),
  rate: (id: string, stars: number, ok: boolean, note?: string) =>
    api.post(`/v1/transactions/${id}/rate`, { stars, item_as_described: ok ? 'yes' : 'no', comment: note }),
};

export interface TrackingStep {
  step: 'payment_captured' | 'seller_ready' | 'fe_pickup' | 'at_hub' | 'routed_for_delivery' | 'delivered';
  at: string | null;
  label: string;
  done: boolean;
}

export interface TrackingResponse {
  transaction_id: string;
  status: string;
  seller_readiness_status: 'pending' | 'confirmed' | 'declined' | 'expired' | string;
  pickup_readiness_deadline: string | null;
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
  list: () => cachedGet('/v1/wishlist', undefined, 30_000),
  peekList: () => peekCachedGet('/v1/wishlist', undefined, true),
  add: (lid: string) => api.post(`/v1/wishlist/${lid}`).then((res) => {
    clearApiCache('/v1/wishlist');
    return res;
  }),
  remove: (lid: string) => api.delete(`/v1/wishlist/${lid}`).then((res) => {
    clearApiCache('/v1/wishlist');
    return res;
  }),
};

// ── Notifications ────────────────────────────────────────────────────────────
export const Notifications = {
  list: (unreadOnly = false) => cachedGet('/v1/notifications', { params: { unread_only: unreadOnly } }, 15_000),
  markRead: (id: string) => api.post(`/v1/notifications/${id}/read`).then((res) => {
    clearApiCache('/v1/notifications');
    return res;
  }),
  unreadCount: () => cachedGet('/v1/notifications/unread-count', undefined, 15_000),
  preferences: () => cachedGet('/v1/notifications/preferences', undefined, 60_000),
  updatePreferences: (prefs: any) => api.put('/v1/notifications/preferences', prefs).then((res) => {
    clearApiCache('/v1/notifications/preferences');
    return res;
  }),
};

// ── Orders (Buy Now) ──────────────────────────────────────────────────
export const Orders = {
  buyNow: (listingId: string, orderNotes?: string, addressId?: string | null) =>
    api.post('/v1/orders/buy-now', {
      listing_id: listingId,
      address_id: addressId || undefined,
      order_notes: orderNotes && orderNotes.trim() ? orderNotes.trim() : undefined,
    }).then((res) => {
      clearApiCaches(['/v1/transactions', '/v1/offers']);
      clearListingCaches();
      return res;
    }),
  confirmPayment: (transactionId: string, payment: CheckoutPaymentSuccess) =>
    api.post(`/v1/transactions/${transactionId}/payment/confirm`, payment).then((res) => {
      clearApiCaches(['/v1/transactions', '/v1/offers', `/v1/transactions/${transactionId}`, `/v1/transactions/${transactionId}/tracking`]);
      clearListingCaches();
      return res;
    }),
  reportPaymentFailure: (transactionId: string, failure: CheckoutPaymentFailure) =>
    api.post(`/v1/transactions/${transactionId}/payment/failure`, failure).then((res) => {
      clearApiCaches(['/v1/transactions', '/v1/offers', `/v1/transactions/${transactionId}`, `/v1/transactions/${transactionId}/tracking`]);
      clearListingCaches();
      return res;
    }),
  cancelUnpaidTransaction: (transactionId: string, reason = 'buyer_cancelled_payment') =>
    api.post(`/v1/transactions/${transactionId}/payment/cancel`, { reason }).then((res) => {
      clearApiCaches(['/v1/transactions', '/v1/offers', `/v1/transactions/${transactionId}`, `/v1/transactions/${transactionId}/tracking`]);
      clearListingCaches();
      return res;
    }),
  cancelPaidBeforePickup: (transactionId: string, reason = 'buyer_cancelled_before_pickup') =>
    api.post(`/v1/transactions/${transactionId}/cancel`, { reason }).then((res) => {
      clearApiCaches(['/v1/transactions', '/v1/offers', `/v1/transactions/${transactionId}`, `/v1/transactions/${transactionId}/tracking`]);
      clearListingCaches();
      return res;
    }),
  createPaymentLinkFallback: (transactionId: string) =>
    api.post(`/v1/transactions/${transactionId}/payment-link`).then((res) => {
      clearApiCaches(['/v1/transactions', `/v1/transactions/${transactionId}`, `/v1/transactions/${transactionId}/tracking`]);
      return res;
    }),
};

// ── Disputes ──────────────────────────────────────────────────────────
export const Disputes = {
  // photo_uris is a FE-side hint; BE plumbing converts these to R2 keys via
  // a multipart endpoint or a presigned-URL upload step, depending on what
  // ships in the same release. Without photos, dispute resolution is text-only
  // (P0.4 trust-floor fix 2026-05-03).
  raise: (transactionId: string, reason: string, description: string, photo_uris?: string[]) =>
    api.post('/v1/disputes', {
      transaction_id: transactionId,
      reason,
      description,
      photo_uris: photo_uris && photo_uris.length > 0 ? photo_uris : undefined,
    }),
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

/**
 * Structured cancel reasons for concierge visits. Server-side route
 * (POST /v1/fe-visits/{id}/cancel) currently ignores the body — these
 * are sent forward-compat so the FE router can adopt them without a
 * mobile release. UI captures the reason regardless and feeds local
 * analytics today.
 */
export type FEVisitCancelReason =
  | 'changed_mind'
  | 'sold_elsewhere'
  | 'fe_late'
  | 'schedule_conflict'
  | 'no_longer_selling'
  | 'other';

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
  /**
   * Cancel a seller's own visit. Allowed when status is `requested` or
   * `scheduled`. Reason is captured for analytics — at the API level the
   * existing endpoint accepts no body; once the FE router adopts the
   * structured payload these fields ride through unchanged.
   */
  cancel: (id: string, reason?: FEVisitCancelReason, note?: string) =>
    api.post(`/v1/fe-visits/${id}/cancel`, reason ? { reason, note: note ?? null } : {}),

  // Concierge Phase 2: trust theater
  specialistProfile: (visitId: string) =>
    api.get<SpecialistProfile>(`/v1/fe-visits/${visitId}/specialist-profile`),
  sellerConfirmArrival: (visitId: string, codeMatched: boolean) =>
    api.post<{ confirmed: boolean; alerted: boolean; issue_id?: string }>(
      `/v1/fe-visits/${visitId}/seller-confirm-arrival`,
      { code_matched: codeMatched },
    ),

  // Concierge Phase 5 — seller NPS submission (one per completed visit).
  submitNps: (visitId: string, score: number, freeText?: string) =>
    api.post<{ submitted: boolean; nps_score: number }>(
      `/v1/fe-visits/${visitId}/nps`,
      { nps_score: score, free_text: freeText ?? null },
    ),
};

export const DirectSell = {
  pickupSlots: (addressId: string) =>
    api.get<{ address_id: string; slots: Array<{ slot_start: string; slot_end: string; available: boolean }> }>(
      `/v1/direct-sell/pickup-slots?address_id=${encodeURIComponent(addressId)}`,
    ),
  createBooking: (body: DirectAcquisitionBookingRequest) =>
    api.post<DirectAcquisitionBooking>('/v1/direct-sell/bookings', body),
  myBookings: () =>
    api.get<{ bookings: DirectAcquisitionBooking[] }>('/v1/direct-sell/bookings'),
  getBooking: (id: string) =>
    api.get<DirectAcquisitionBooking>(`/v1/direct-sell/bookings/${id}`),
  refreshVerificationCodes: (id: string) =>
    api.post<DirectAcquisitionBooking>(`/v1/direct-sell/bookings/${id}/verification-codes`),
  cancelBooking: (id: string, reason: string) =>
    api.post<DirectAcquisitionBooking>(`/v1/direct-sell/bookings/${id}/cancel`, { reason }),
};

export interface FEProfile {
  id: string;
  user_id: string;
  fe_code: string;
  city: string;
  active: boolean;
  current_shift: string;
  onboarding_status: string;
  verification_status: string;
  training_status: string;
  device_status: string;
  employment_type: 'internal' | 'contractor' | 'vendor_staff';
  vendor_name?: string | null;
  service_zones: string[];
  category_certifications: string[];
  languages: string[];
  daily_capacity: number;
  readiness_gaps: string[];
  profile_snapshot: Record<string, any>;
  device_binding: Record<string, any>;
  risk_metrics: Record<string, any>;
  suspended_reason?: string | null;
  admin_notes?: string | null;
  verified_at?: string | null;
  certified_at?: string | null;
  device_approved_at?: string | null;
  activated_at?: string | null;
  suspended_at?: string | null;
  last_seen_at?: string | null;
  shift_started_at?: string | null;
  created_at: string;
}

export const FEOnboarding = {
  me: () => api.get<FEProfile>('/v1/fe/onboarding/me'),
  bindDevice: (payload: {
    device_id: string;
    platform: string;
    app_version?: string;
    os_version?: string;
    device_model?: string;
    push_token?: string;
  }) => api.post<FEProfile>('/v1/fe/onboarding/device', payload),
  checkIn: (location?: Record<string, any>) =>
    api.post<FEProfile>('/v1/fe/onboarding/shift/check-in', { location: location || {} }),
  checkOut: () => api.post<FEProfile>('/v1/fe/onboarding/shift/check-out'),
};

// ── Sprint 4 / Pass 2: FE-role endpoints ─────────────────────────────
export const FE = {
  assignedVisits: () => api.get('/v1/fe/visits/assigned'),
  getVisit: (id: string) => api.get(`/v1/fe/visits/${id}`),
  startVisit: (id: string) => api.post(`/v1/fe/visits/${id}/start`),
  directBookings: (status?: string) =>
    api.get<{ bookings: DirectAcquisitionBooking[] }>(
      `/v1/fe/bookings${status ? `?status=${encodeURIComponent(status)}` : ''}`,
    ),
  directBooking: (id: string) =>
    api.get<DirectAcquisitionBooking>(`/v1/fe/bookings/${id}`),
  startDirectBooking: (id: string, location?: DirectLocationPayload) =>
    api.post<DirectAcquisitionBooking>(`/v1/fe/bookings/${id}/start`, { location }),
  arriveDirectBooking: (id: string, location?: DirectLocationPayload) =>
    api.post<DirectAcquisitionBooking>(`/v1/fe/bookings/${id}/arrive`, { location }),
  verifyDirectSellerOtp: (id: string, otp: string) =>
    api.post<DirectAcquisitionBooking>(`/v1/fe/bookings/${id}/verify-seller-otp`, { otp }),
  addDirectItemPhotos: (bookingId: string, itemId: string, photoKeys: string[]) =>
    api.post(`/v1/fe/bookings/${bookingId}/items/${itemId}/photos`, { photo_keys: photoKeys }),
  requestDirectItemPhotoUpload: (bookingId: string, itemId: string, contentType: string = 'image/jpeg') =>
    api.post<{ upload_url: string; r2_key: string; expires_in_seconds: number }>(
      `/v1/fe/bookings/${bookingId}/items/${itemId}/photos/request`,
      { content_type: contentType },
    ),
  directItemQc: (bookingId: string, itemId: string, payload: {
    qc_answers?: Record<string, any>;
    qc_notes?: string;
    pickup_photos?: string[];
  }) => api.post(`/v1/fe/bookings/${bookingId}/items/${itemId}/qc`, payload),
  reviseDirectItemOffer: (bookingId: string, itemId: string, payload: {
    revised_offer_inr: number;
    reason_code: string;
    evidence_photos?: string[];
  }) => api.post(`/v1/fe/bookings/${bookingId}/items/${itemId}/revise-offer`, payload),
  rejectDirectItem: (bookingId: string, itemId: string, payload: {
    reason_code: string;
    notes?: string;
    evidence_photos?: string[];
  }) => api.post(`/v1/fe/bookings/${bookingId}/items/${itemId}/reject`, payload),
  directSellerFinalAcceptance: (
    bookingId: string,
    accepted = true,
    otp?: string,
    location?: DirectLocationPayload,
  ) =>
    api.post<DirectAcquisitionBooking>(`/v1/fe/bookings/${bookingId}/seller-final-acceptance`, {
      accepted,
      method: 'otp',
      otp,
      location,
    }),
  requestDirectPayout: (bookingId: string) =>
    api.post<DirectAcquisitionBooking>(`/v1/fe/bookings/${bookingId}/request-payout`),
  // Concierge Phase 2 trust theater — N4 + N5 trigger endpoints.
  startRoute: (id: string) => api.post(`/v1/fe/visits/${id}/start-route`),
  arrivingSoon: (id: string) => api.post(`/v1/fe/visits/${id}/arriving-soon`),
  enforceAadhaar: (id: string) => api.post(`/v1/fe/visits/${id}/enforce-aadhaar`),
  submitListing: (id: string, payload: any) => api.post(`/v1/fe/visits/${id}/submit-listing`, payload),
  // Concierge Phase 3 — explicit close-visit (decoupled from submit-listing).
  // Phase 5 extends with handover_photo_r2_key + handover_skipped.
  closeVisit: (id: string, payload: {
    outcome: 'listed' | 'rejected_item' | 'seller_missing_verification' | 'pickup_not_ready';
    outcome_reason?: string;
    handover_photo_r2_key?: string;
    handover_skipped?: boolean;
  }) => api.post(`/v1/fe/visits/${id}/close-visit`, payload),
  // Concierge Phase 5 — Report Issue from FE app.
  reportIssue: (visitId: string, payload: {
    category: 'item_damage' | 'seller_backout' | 'address_mismatch' | 'seller_absent' | 'safety_concern' | 'other';
    description?: string;
    photo_urls?: string[];
  }) => api.post(`/v1/fe/visits/${visitId}/issues`, payload),
  // Concierge Phase 3 — expert pricing panel.
  priceSuggestion: (params: {
    category_id: string;
    brand: string;
    model?: string;
    condition?: string;
  }) => api.get<{
    match_count: number;
    match_quality: 'exact' | 'category_brand_model' | 'category_brand_only' | 'no_match';
    p25: number | null;
    median: number | null;
    p75: number | null;
    avg_days_to_sell: number | null;
    suggested: number | null;
    faster_sell_price: number | null;
    premium_price: number | null;
  }>('/v1/listings/price-suggestion', { params }),
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
  // photo_uris are R2 keys returned by Evidence.requestUpload below; mobile
  // uploads each photo to R2 first, then passes the keys here.
  request: (transactionId: string, reason: string, description: string, photo_uris?: string[]) =>
    api.post(`/v1/transactions/${transactionId}/return`, {
      reason,
      description,
      photo_uris: photo_uris && photo_uris.length > 0 ? photo_uris : undefined,
    }),
  // P0.5 — beacon when buyer taps the inspection-confirm checkbox at the door,
  // before the handover ack code is shown. Idempotent server-side.
  conditionConfirmed: (transactionId: string) =>
    api.post(`/v1/transactions/${transactionId}/condition_confirmed`),
};

// ── Evidence (dispute/return photo upload) ──────────────────────────────────
// Two-step upload mirroring the Listings image flow:
//   1) requestUpload() → BE returns a presigned R2 PUT URL + r2_key
//   2) client PUTs the file bytes directly to R2 at upload_url
//   3) client passes the r2_keys to Disputes.raise() / Returns.request()
//      as photo_uris, which BE persists into Dispute.photo_keys /
//      Transaction.return_photo_keys.
export const Evidence = {
  requestUpload: (transactionId: string, contentType: string = 'image/jpeg') =>
    api.post<{ upload_url: string; r2_key: string; expires_in_seconds: number }>(
      `/v1/transactions/${transactionId}/evidence/request`,
      { content_type: contentType },
    ),
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
  // Populated only on the /v1/fe/deliveries endpoint (P0 2026-05-03):
  // recipient name + phone surface on the FE handover screen so the
  // delivery agent knows who to ask for; order_notes is the buyer's
  // delivery instructions captured at checkout.
  buyer_name?: string | null;
  buyer_phone?: string | null;
  buyer_full_address?: string | null;
  buyer_locality?: string | null;
  buyer_city?: string | null;
  buyer_pincode?: string | null;
  seller_name?: string | null;
  seller_phone?: string | null;
  seller_full_address?: string | null;
  seller_locality?: string | null;
  seller_city?: string | null;
  seller_pincode?: string | null;
  order_notes?: string | null;
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
  list: (city?: string) =>
    api.get('/v1/community/list', { params: city ? { city } : undefined }),
};

// ── Sprint 8 Phase 2: AI-Assisted Listing ────────────────────────────────  // SPRINT8_PHASE2_AI
// Added by the Phase 2 mobile bundle. Provides multipart upload helpers
// for the photo-first listing flow and JSON helpers for the rest.

export interface AIDetectedFields {
  category_slug: string | null;
  raw_category_slug?: string | null;
  category_resolution?: string | null;
  category_confidence: number;
  category_rationale?: string | null;
  category_family?: 'device' | 'appliance' | 'toy' | 'book' | 'other' | string | null;
  category_specifics?: Record<string, any>;
  detected_item_type?: string | null;
  brand: string | null;
  model: string | null;
  storage: string | null;
  ram: string | null;
  processor: string | null;
  screen_size: string | null;
  color: string | null;
  purchase_year: number | null;
  condition_guess: string | null;
  screen_condition?: string | null;
  body_condition?: string | null;
  defects?: string[];
  battery_health?: number | null;
  accessories?: string | null;
  warranty_status?: string | null;
  mrp_inr?: number | null;
  mrp_confidence?: number;
  mrp_source?: 'visible_mrp' | 'receipt_or_bill' | 'market_anchor' | 'none' | string | null;
  mrp_reasoning?: string | null;
  title_suggestion: string | null;
  description_suggestion: string | null;
  flags: string[];
  manual_review_required?: boolean;
  blocking_reasons?: string[];
  seller_photo_feedback?: string[];
  seller_edit_fields?: string[];
  image_set_quality?: Record<string, any>;
  hero_image_index?: number | null;
  hero_image_rationale?: string | null;
  field_confidence?: Record<string, number>;
  field_evidence?: Record<string, string>;
  photo_analysis?: Record<string, any>;
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
  photo_urls?: string[];
  detected: AIDetectedFields;
  suggested_price: number | null;
  price_source: 'comparables' | 'vision' | 'mrp_anchor' | 'category_anchor' | 'ai' | 'none';
  comparables: AIComparable[];
  expires_at: string;
  needs_identifier: boolean;
  fallback_reason: string | null;
  analysis_contract?: Record<string, unknown>;
}

export interface AIDraftUploadSlot {
  index: number;
  upload_url: string;
  r2_key: string;
  content_type: string;
  expires_in_seconds: number;
}

export interface AIDraftUploadSessionResponse {
  draft_id: string;
  uploads: AIDraftUploadSlot[];
  status: 'uploading';
  expires_at: string;
}

export interface AIDraftAnalysisStatusResponse {
  draft_id: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed' | 'expired' | string;
  draft: AIDraftResponse | null;
  error: string | null;
  message: string | null;
  retry_after_seconds: number | null;
}

export interface AIDraftPriceRefreshRequest {
  category_slug?: string | null;
  brand?: string | null;
  model?: string | null;
  storage?: string | null;
  ram?: string | null;
  processor?: string | null;
  screen_size?: string | null;
  detected_item_type?: string | null;
  category_family?: string | null;
  category_specifics?: Record<string, any> | null;
  condition?: string | null;
  purchase_year?: number | null;
  screen_condition?: string | null;
  body_condition?: string | null;
  defects?: string[] | null;
  original_price?: number | null;
  mrp_source?: string | null;
  mrp_confidence?: number | null;
}

export interface AIExtractIMEIResponse {
  identifier_kind: 'imei' | 'serial' | null;
  identifier_value: string | null;
  imei: string | null;
  serial_number: string | null;
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
  original_price?: number | null;
  condition: string;
  category_slug: string;
  brand?: string | null;
  model?: string | null;
  storage?: string | null;
  ram?: string | null;
  processor?: string | null;
  screen_size?: string | null;
  color?: string | null;
  purchase_year?: number | null;
  screen_condition?: 'flawless' | 'minor_scratches' | 'cracked' | string | null;
  body_condition?: 'flawless' | 'minor_dents' | 'major_damage' | string | null;
  defects?: string[] | null;
  battery_health?: number | null;
  accessories?: string | null;
  warranty_status?: string | null;
  age_suitability?: string | null;
  hygiene_status?: string | null;
  has_box?: boolean | null;
  has_bill?: boolean | null;
  has_charger?: boolean | null;
  has_earphones?: boolean | null;
  water_damage_history?: boolean | null;
  seller_functional_attestation?: boolean | null;
  kids_safety_checklist?: Record<string, boolean> | null;
  category_family?: string | null;
  category_specifics?: Record<string, any> | null;
  description?: string | null;
  mrp_source?: string | null;
  mrp_confidence?: number | null;
  seller_mrp_confirmed?: boolean | null;
  hero_image_index?: number | null;
  removed_photo_indices?: number[] | null;
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
  original_price?: number | null;
}

export interface AISellerInfoNeededResponse {
  pickup_address_needed: boolean;
  accessories_needed: boolean;
  payout_kyc_needed: boolean;
  listing_state: string;
}

function postIdentifierOCR(draftId: string, imageUri: string, categorySlug?: string | null) {
  const form = new FormData();
  if (categorySlug) form.append('category_slug', categorySlug);
  form.append('image', {
    uri: imageUri,
    type: 'image/jpeg',
    name: 'identifier.jpg',
  } as any);
  return api.post<AIExtractIMEIResponse>(
    `/v1/listings/draft/${draftId}/extract-identifier`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: UPLOAD_TIMEOUT,
    },
  );
}

type AIDraftUploadPhase = 'async-session' | 'direct-r2' | 'analysis-start' | 'analysis-status';

function markAIDraftPhase<T extends any>(error: T, phase: AIDraftUploadPhase): T {
  if (error && typeof error === 'object') {
    (error as any).owmeePhase = phase;
  }
  return error;
}

function apiErrorStatus(error: any): number | null {
  const status = error?.response?.status ?? error?.status;
  return typeof status === 'number' ? status : null;
}

function apiErrorDetail(error: any): any {
  return error?.response?.data?.detail;
}

function isDefaultRouteNotFound(error: any): boolean {
  if (apiErrorStatus(error) !== 404) return false;
  const detail = apiErrorDetail(error);
  return !detail || detail === 'Not Found';
}

function shouldFallbackToMultipartDraft(error: any): boolean {
  const phase = error?.owmeePhase as AIDraftUploadPhase | undefined;
  const status = apiErrorStatus(error);
  if (phase === 'direct-r2') return true;
  if ((phase === 'async-session' || phase === 'analysis-start' || phase === 'analysis-status') &&
      (isDefaultRouteNotFound(error) || status === 405)) {
    return true;
  }
  return false;
}

function draftFromImagesMultipartRequest(imageUris: string[]): Promise<AxiosResponse<AIDraftResponse>> {
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
}

function uploadAiDraftPhoto(upload: AIDraftUploadSlot, imageUri: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', upload.upload_url);
    xhr.setRequestHeader('Content-Type', upload.content_type || 'image/jpeg');
    xhr.timeout = UPLOAD_TIMEOUT;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        const err = new Error(`Photo ${upload.index + 1} direct upload failed with status code ${xhr.status}`);
        (err as any).status = xhr.status;
        (err as any).r2Key = upload.r2_key;
        reject(markAIDraftPhase(err, 'direct-r2'));
      }
    };
    xhr.onerror = () => reject(markAIDraftPhase(new Error(`Photo ${upload.index + 1} direct upload network error`), 'direct-r2'));
    xhr.ontimeout = () => reject(markAIDraftPhase(new Error(`Photo ${upload.index + 1} direct upload timed out`), 'direct-r2'));
    xhr.send({
      uri: imageUri,
      type: upload.content_type || 'image/jpeg',
      name: `ai_draft_${upload.index}.jpg`,
    } as any);
  });
}

async function uploadAiDraftPhotos(uploads: AIDraftUploadSlot[], imageUris: string[], concurrency: number = 3): Promise<void> {
  let next = 0;
  const workerCount = Math.min(Math.max(1, concurrency), uploads.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < uploads.length) {
      const upload = uploads[next++];
      const uri = imageUris[upload.index];
      if (!uri) throw new Error(`Missing photo ${upload.index + 1}`);
      await uploadAiDraftPhoto(upload, uri);
    }
  });
  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const AIListing = {
  // SPRINT8_PHASE2_GEMINI_V2 — multi-image upload (1-6 photos)
  /** Upload photos directly to R2, queue AI analysis, then poll until ready. */
  draftFromImages: async (imageUris: string[]): Promise<AxiosResponse<AIDraftResponse>> => {
    try {
      const session = await api.post<AIDraftUploadSessionResponse>(
        '/v1/listings/draft/uploads/request',
        { images: imageUris.map(() => ({ content_type: 'image/jpeg' })) },
        { timeout: REQUEST_TIMEOUT },
      ).catch((error) => {
        throw markAIDraftPhase(error, 'async-session');
      });

      const uploads = [...session.data.uploads].sort((a, b) => a.index - b.index);
      await uploadAiDraftPhotos(uploads, imageUris);

      await api.post(
        `/v1/listings/draft/${session.data.draft_id}/analysis/start`,
        {},
        { timeout: REQUEST_TIMEOUT },
      ).catch((error) => {
        throw markAIDraftPhase(error, 'analysis-start');
      });

      let lastStatus: AIDraftAnalysisStatusResponse | null = null;
      for (let attempt = 0; attempt < 45; attempt++) {
        const statusRes = await api.get<AIDraftAnalysisStatusResponse>(
          `/v1/listings/draft/${session.data.draft_id}/analysis/status`,
          { timeout: REQUEST_TIMEOUT },
        ).catch((error) => {
          throw markAIDraftPhase(error, 'analysis-status');
        });
        lastStatus = statusRes.data;
        if (statusRes.data.status === 'ready' && statusRes.data.draft) {
          return { ...statusRes, data: statusRes.data.draft };
        }
        if (statusRes.data.status === 'failed' || statusRes.data.status === 'expired') {
          throw new Error(statusRes.data.message || statusRes.data.error || 'Photo analysis failed');
        }
        await sleep((statusRes.data.retry_after_seconds || 2) * 1000);
      }

      throw new Error(
        lastStatus?.message ||
        'Photo analysis is taking longer than expected. Please try again in a moment.',
      );
    } catch (error) {
      if (shouldFallbackToMultipartDraft(error)) {
        console.warn('AI draft async upload unavailable; using multipart fallback', {
          phase: (error as any)?.owmeePhase,
          status: apiErrorStatus(error),
          message: (error as any)?.message,
        });
        return draftFromImagesMultipartRequest(imageUris);
      }
      throw error;
    }
  },

  /** Multipart analysis fallback for older backend builds or unreachable direct storage PUTs. */
  draftFromImagesMultipart: draftFromImagesMultipartRequest,

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

  /** Photo of IMEI / serial / service-tag label → OCR + category validation. */
  extractIdentifier: postIdentifierOCR,

  /** Backward-compatible alias for older call sites. */
  extractIMEI: (draftId: string, imageUri: string) => postIdentifierOCR(draftId, imageUri, 'smartphones'),

  /** Recompute MRP + suggested price after seller confirms details in review. */
  refreshDraftPrice: (draftId: string, body: AIDraftPriceRefreshRequest) =>
    api.post<AIDraftResponse>(`/v1/listings/draft/${draftId}/price-suggestion`, body, {
      timeout: REQUEST_TIMEOUT,
    }),

  /** Convert a draft + final fields into a real listing in pending_buyer state. */
  createFromDraft: (body: AICreateFromDraftRequest) =>
    api.post<AICreateFromDraftResponse>('/v1/listings/from-draft', body).then((res) => {
      clearListingCaches();
      return res;
    }),

  /** What info do we still need from the seller for this listing? */
  sellerInfoNeeded: (listingId: string) =>
    api.get<AISellerInfoNeededResponse>(`/v1/listings/${listingId}/seller-info-needed`),

  /** Progressive collection (pickup address, accessories). */
  updateSellerInfo: (listingId: string, info: {
    pickup_address?: string;
    pickup_pincode?: string;
    accessories?: string;
    available_slots?: string[];
  }) => api.post(`/v1/listings/${listingId}/seller-info`, info).then((res) => {
    clearListingCaches();
    return res;
  }),

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
    ram?: string;
    processor?: string;
    screen_size?: string;
    color?: string;
    purchase_year?: number;
    battery_health?: number;
    accessories?: string;
    warranty_status?: string;
  }) => api.patch(`/v1/listings/${listingId}/ai`, fields).then((res) => {
    clearListingCaches();
    return res;
  }),

  /** Re-run Claude haiku to regenerate the description from current fields. */
  regenerateDescription: (listingId: string) =>
    api.post<{ description: string; ai_model: string }>(
      `/v1/listings/${listingId}/regenerate-description`,
    ).then((res) => {
      clearListingCaches();
      return res;
    }),
};
