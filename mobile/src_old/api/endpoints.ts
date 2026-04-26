import { api } from './client';

// ── Auth ──────────────────────────────────────────────────────────────────────
export const sendOTP = (phone_number: string) =>
  api.post('/v1/auth/otp/send', { phone_number });

export const verifyOTP = (phone_number: string, otp: string) =>
  api.post('/v1/auth/otp/verify', { phone_number, otp });

export const getMe = () => api.get('/v1/auth/me');

export const updateProfile = (params: { num_kids?: number; kids_age_range?: string }) =>
  api.patch('/v1/auth/me/profile', null, { params });

// ── KYC ───────────────────────────────────────────────────────────────────────
export const kycConsent = () => api.post('/v1/kyc/consent', { consent_type: 'aadhaar_kyc' });
export const kycAadhaarInitiate = () => api.post('/v1/kyc/aadhaar/initiate');
export const kycAadhaarVerify = (request_id: string, otp: string) =>
  api.post('/v1/kyc/aadhaar/verify', { request_id, otp });
export const kycPanVerify = (pan_number: string) =>
  api.post('/v1/kyc/pan/verify', { pan_number });
export const kycLivenessSession = () => api.post('/v1/kyc/liveness/session');
export const kycLivenessVerify = (session_id: string) =>
  api.post('/v1/kyc/liveness/verify', { session_id });
export const kycPayoutVerify = (account_type: string, account_value: string) =>
  api.post('/v1/kyc/payout-account/verify', { account_type, account_value });
export const kycStatus = () => api.get('/v1/kyc/status');

// ── Listings ─────────────────────────────────────────────────────────────────
export const getCategories = () => api.get('/v1/listings/categories');

export const browseListings = (params: {
  city?: string; category_slug?: string; condition?: string;
  min_price?: number; max_price?: number; kids_only?: boolean;
  limit?: number; offset?: number;
}) => api.get('/v1/listings', { params });

export const searchListings = (q: string, params?: {
  city?: string; category_slug?: string; kids_only?: boolean;
  limit?: number; offset?: number;
}) => api.get('/v1/listings/search', { params: { q, ...params } });

export const getListing = (id: string) => api.get(`/v1/listings/${id}`);
export const getSellerDashboard = () => api.get('/v1/listings/me');
export const getMyListings = (status_filter?: string) =>
  api.get('/v1/listings/me/listings', { params: { status_filter } });

export const createListing = (data: {
  category_id: string; title: string; description?: string;
  price: number; condition: string; city: string; state: string;
  locality?: string; accessories?: string; warranty_info?: string;
  battery_health?: number; age_suitability?: string;
  hygiene_status?: string; is_kids_item?: boolean; is_negotiable?: boolean;
}) => api.post('/v1/listings', data);

export const requestImageUpload = (listing_id: string, content_type = 'image/jpeg') =>
  api.post(`/v1/listings/${listing_id}/images/request`, { content_type });

export const confirmImageUpload = (listing_id: string, r2_key: string, is_primary = false) =>
  api.post(`/v1/listings/${listing_id}/images/confirm`, { r2_key, is_primary });

export const publishListing = (listing_id: string) =>
  api.post(`/v1/listings/${listing_id}/publish`);

export const updateListingPrice = (listing_id: string, new_price: number) =>
  api.put(`/v1/listings/${listing_id}/price`, { new_price });

export const markListingSold = (listing_id: string, sold_where: 'on_owmee' | 'elsewhere') =>
  api.post(`/v1/listings/${listing_id}/mark-sold`, { sold_where });

// ── Activity & Discovery ─────────────────────────────────────────────────────
export const getActivity = (city?: string) =>
  api.get('/v1/listings/activity', { params: { city } });

export const getNewSinceVisit = (city?: string) =>
  api.get('/v1/listings/new-since-visit', { params: { city } });

// ── Offers ────────────────────────────────────────────────────────────────────
export const makeOffer = (listing_id: string, offered_price: number, offer_note?: string) =>
  api.post('/v1/offers', { listing_id, offered_price, offer_note });

export const getOffersReceived = (status?: string) =>
  api.get('/v1/offers/received', { params: { status } });

export const getOffersSent = () => api.get('/v1/offers/sent');

export const counterOffer = (offer_id: string, counter_price: number) =>
  api.post(`/v1/offers/${offer_id}/counter`, { counter_price });

export const acceptOffer = (offer_id: string) =>
  api.post(`/v1/offers/${offer_id}/accept`);

export const acceptOfferCash = (offer_id: string) =>
  api.post(`/v1/offers/${offer_id}/accept-cash`);

export const rejectOffer = (offer_id: string, reason?: string) =>
  api.post(`/v1/offers/${offer_id}/reject`, { reason });

export const withdrawOffer = (offer_id: string) =>
  api.post(`/v1/offers/${offer_id}/withdraw`);

// ── Transactions ─────────────────────────────────────────────────────────────
export const getTransactions = () => api.get('/v1/transactions');
export const getTransaction = (id: string) => api.get(`/v1/transactions/${id}`);

export const confirmMeetup = (transaction_id: string, meetup_at: string) =>
  api.post(`/v1/transactions/${transaction_id}/meetup`, { meetup_at });

export const cancelAtMeetup = (transaction_id: string, reason: string) =>
  api.post(`/v1/transactions/${transaction_id}/cancel-meetup`, { reason });

export const confirmDeal = (transaction_id: string) =>
  api.post(`/v1/transactions/${transaction_id}/confirm`);

export const rateTransaction = (transaction_id: string, stars: number, comment?: string, item_as_described?: string) =>
  api.post(`/v1/transactions/${transaction_id}/rate`, { stars, comment, item_as_described });

// ── Wishlist ───────────────────────────────────────────────────────────────────
export const getWishlist = () => api.get('/v1/wishlist');
export const addToWishlist = (listing_id: string) => api.post(`/v1/wishlist/${listing_id}`);
export const removeFromWishlist = (listing_id: string) => api.delete(`/v1/wishlist/${listing_id}`);

// ── Notifications ─────────────────────────────────────────────────────────────
export const getNotifications = (unread_only = false) =>
  api.get('/v1/notifications', { params: { unread_only } });

export const getUnreadCount = () => api.get('/v1/notifications/unread-count');

export const markNotificationRead = (id: string) =>
  api.post(`/v1/notifications/${id}/read`);

export const getNotificationPrefs = () => api.get('/v1/notifications/preferences');

export const updateNotificationPrefs = (prefs: {
  transactions_enabled: boolean;
  messages_enabled: boolean;
  promotions_enabled: boolean;
}) => api.put('/v1/notifications/preferences', prefs);

// ── Reputation ────────────────────────────────────────────────────────────────
export const getReputation = () => api.get('/v1/users/me/reputation');

// ── Disputes & Reports ────────────────────────────────────────────────────────
export const raiseDispute = (transaction_id: string, reason: string, description: string) =>
  api.post('/v1/disputes', { transaction_id, reason, description });

export const reportListing = (listing_id: string, report_type: string, description?: string) =>
  api.post(`/v1/reports/listing/${listing_id}`, { report_type, description });

export const reportUser = (user_id: string, report_type: string, description?: string) =>
  api.post(`/v1/reports/user/${user_id}`, { report_type, description });
