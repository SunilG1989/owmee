import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParams = {
  MainTabs: NavigatorScreenParams<TabParams>;
  ListingDetail: { listingId: string; openOffer?: boolean; initialListing?: any };
  TransactionDetail: { transactionId: string };
  KycFlow: { returnTo?: string };
  KycRequiredForAction: { actionLabel?: string; returnTo?: string };
  KidsSection: undefined;
  AuthFlow: undefined;
  // Profile sub-screens
  MyListings: undefined;
  MyFeVisits: undefined;
  SavedItems: undefined;
  TransactionList: undefined;
  EditProfile: undefined;
  Notifications: undefined;
  // Sprint 1: Purchase flow
  Checkout: { listingId: string };
  OrderConfirmation: { transactionId: string; listing?: any; total?: number };
  SellerProfile: { seller: { id: string; name?: string; city?: string; kyc_verified?: boolean; avg_rating?: number; deal_count?: number; trust_score?: number; member_since?: string } };

  // ── Sprint 4 / Pass 2: FE flow ─────────────────────────────────────────────
  FeVisitConfirmation: { visitId: string };
  VerificationWall: { intent?: 'buy' | 'sell' | 'publish' } | undefined;
  // FE-role screens
  FeHome: undefined;
  FeOps: undefined;  // Sprint 6c: post-purchase pickups + deliveries
  FeVisitDetail: { visitId: string };
  FeCapture: { visitId: string };
  FeVisitHistory: undefined;
  // Concierge Phase 3 — specialist excellence (FE app)
  SellerApproval: {
    visitId: string;
    summary: { title: string; condition: string; priceInr: number };
    payload: any;
  };
  VisitContinue: { visitId: string };
  // Concierge Phase 5 — trust safety net
  ReportIssue: { visitId: string };
  ConciergeNps: { visit_id: string; specialist_first_name?: string };

  // Sprint 6b: Buyer/seller offers list with v2 mechanics
  MyOffers: undefined;

  // Sprint 7 / Phase 1: Community proof screen
  CommunityProof: undefined;


  // ── Sprint 8 / Phase 2: AI-Assisted Listing ────────────────────────────  // SPRINT8_PHASE2_AI
  AIListingCamera: undefined;
  AIListingSuggest: { draft: any };
  AIListingIdentifier: { draft: any; finalFields: any };
  EditListing: { listingId: string };
  // Manual-entry fallback when the AI flow can't run (Gemini quota
  // exhausted, etc.). Reachable from AIListingCameraScreen's
  // "Use manual form" Alert action.
  CreateListing: undefined;

  // ── Concierge (master spec) ─────────────────────────────────────────
  SellModeFork: undefined;
  ConciergeBooking: { selectedAddressId?: string } | undefined;
  ConciergeBookingConfirmed: { visit: import('../services/api').FEVisit };
  MyConcierge: undefined;
  // Phase 2 — trust theater
  VisitDetail: { visit_id: string };
  ArrivalVerification: { visit_id: string };

  // ── Address PRD: 3-screen address flow ───────────────────────────────
  // Each screen optionally carries `returnTo` (the screen that should
  // own the user when the flow finishes). For onboarding-gate use it's
  // 'MainTabs'. For "Add a new address" from a picker, the picker
  // re-fetches its list on focus so returnTo is unset.
  LocationDetect: { returnTo?: string } | undefined;
  LocationMap: {
    initialLat: number;
    initialLng: number;
    source?: 'gps_detected' | 'manual';
    gpsAccuracy?: number;
    returnTo?: string;
    // Existing saved address selected from the Home location picker.
    // The map must be reviewed before making it the active/default address.
    reviewAddress?: import('../services/api').UserAddress;
  };
  AddressDetails: {
    lat: number;
    lng: number;
    source: 'gps_detected' | 'manual';
    reverse: import('../services/api').PhotonReverseResponse | null;
    returnTo?: string;
    // P0 launch fix (2026-05-03): editing an existing row patches it instead
    // of creating a new one. Used by AddressPicker's "Edit" affordance and
    // by CheckoutScreen when buyer's default address is missing fields.
    edit?: import('../services/api').UserAddress;
  };
  AddressPicker: { returnTo?: string } | undefined;

};

export type AuthStackParams = {
  Onboarding: undefined;
  Register: { city?: string; state?: string; pincode?: string };
  OtpVerify: { phone: string; profile?: any };
};

export type TabParams = {
  Home: undefined;
  Search: { category_slug?: string; query?: string; isKids?: boolean; openFilters?: boolean } | undefined;
  Sell: undefined;
  Notifications: undefined;
  Profile: undefined;
};

export type RootScreen<T extends keyof RootStackParams> = NativeStackScreenProps<RootStackParams, T>;
export type TabScreen<T extends keyof TabParams> = CompositeScreenProps<BottomTabScreenProps<TabParams, T>, NativeStackScreenProps<RootStackParams>>;
export type AuthScreen<T extends keyof AuthStackParams> = NativeStackScreenProps<AuthStackParams, T>;
