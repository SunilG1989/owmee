import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParams = {
  MainTabs: NavigatorScreenParams<TabParams>;
  ListingDetail: { listingId: string };
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
  RequestFeVisit: { categoryHint?: string } | undefined;
  FeVisitConfirmation: { visitId: string };
  VerificationWall: { intent?: 'buy' | 'sell' | 'publish' } | undefined;
  // FE-role screens
  FeHome: undefined;
  FeVisitDetail: { visitId: string };
  FeCapture: { visitId: string };
  FeVisitHistory: undefined;

  // Sprint 8 / Phase 1: Location picker re-entry (modal)
  LocationPicker: undefined;

  // Sprint 7 / Phase 1: Community proof screen
  CommunityProof: undefined;


  // ── Sprint 8 / Phase 2: AI-Assisted Listing ────────────────────────────  // SPRINT8_PHASE2_AI
  AIListingCamera: undefined;
  AIListingSuggest: { draft: any };
  AIListingIdentifier: { draft: any; finalFields: any };
  EditListing: { listingId: string };

};

export type AuthStackParams = {
  Onboarding: undefined;
  Register: { city?: string; state?: string; pincode?: string };
  OtpVerify: { phone: string; profile?: any };
};

export type TabParams = {
  Home: undefined;
  Search: { category_slug?: string; isKids?: boolean } | undefined;
  Sell: undefined;
  Profile: undefined;
};

export type RootScreen<T extends keyof RootStackParams> = NativeStackScreenProps<RootStackParams, T>;
export type TabScreen<T extends keyof TabParams> = CompositeScreenProps<BottomTabScreenProps<TabParams, T>, NativeStackScreenProps<RootStackParams>>;
export type AuthScreen<T extends keyof AuthStackParams> = NativeStackScreenProps<AuthStackParams, T>;
