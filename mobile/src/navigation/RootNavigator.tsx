/**
 * RootNavigator — Sprint 4 / Pass 3
 *
 * Pass 3 changes:
 *   - VerificationWallStub → real VerificationWallScreen
 *   - FeVisitConfirmationStub → real FeVisitConfirmationScreen
 *   - Stub functions and stub styles removed
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store/authStore';
import { LOCATION_KEY, ONBOARDING_SEEN_KEY } from '../utils/storageKeys';
import { C, T, S, R, Shadow } from '../utils/tokens';
import SplashScreen from '../components/SplashScreen';

// Consumer screens
import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import CreateListingScreen from '../screens/listings/CreateListingScreen';
import OffersScreen from '../screens/OffersScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import ListingDetailScreen from '../screens/listings/ListingDetailScreen';
import TransactionDetailScreen from '../screens/TransactionDetailScreen';
import KidsSectionScreen from '../screens/kids/KidsSectionScreen';
import OnboardingScreen from '../screens/auth/OnboardingScreen';
import RegisterScreen from '../screens/auth/RegisterScreen';
import OtpVerifyScreen from '../screens/auth/OtpVerifyScreen';
import KycFlowScreen from '../screens/auth/KycFlowScreen';
import KycRequiredForActionScreen from '../screens/KycRequiredForActionScreen';
import LocationPickerScreen from '../screens/auth/LocationPickerScreen';
// Address PRD: 3-screen flow replaces LocationPickerScreen for the
// post-auth onboarding gate. LocationPickerScreen kept temporarily as
// fallback for unauthed-browse + the LocationPicker modal route until
// the PRD's Phase 2 finishes its sweep.
import LocationDetectScreen from '../screens/auth/address/LocationDetectScreen';
import LocationMapScreen from '../screens/auth/address/LocationMapScreen';
import AddressDetailsScreen from '../screens/auth/address/AddressDetailsScreen';
import AddressPickerScreen from '../screens/auth/address/AddressPickerScreen';
// Profile sub-screens
import MyListingsScreen from '../screens/listings/MyListingsScreen';
import MyFeVisitsScreen from '../screens/profile/MyFeVisitsScreen';
import TransactionListScreen from '../screens/profile/TransactionListScreen';
import WishlistScreen from '../screens/profile/WishlistScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import NotificationsScreen from '../screens/profile/NotificationsScreen';
import SellerProfileScreen from '../screens/profile/SellerProfileScreen';
// Purchase flow
import CheckoutScreen from '../screens/purchase/CheckoutScreen';
import OrderConfirmationScreen from '../screens/purchase/OrderConfirmationScreen';
// Sprint 4 / Pass 2: FE flow
import FeHomeScreen from '../screens/fe/FeHomeScreen';
import FeVisitDetailScreen from '../screens/fe/FeVisitDetailScreen';
import FeCaptureScreen from '../screens/fe/FeCaptureScreen';
// Sprint 6c: post-purchase pickups + deliveries
import FeOpsScreen from '../screens/fe/FeOpsScreen';
import FeVisitHistoryScreen from '../screens/fe/FeVisitHistoryScreen';
// Concierge Phase 3 — specialist excellence (FE app)
import SellerApprovalScreen from '../screens/fe/SellerApprovalScreen';
import VisitContinueScreen from '../screens/fe/VisitContinueScreen';
// Concierge Phase 5 — trust safety net
import ReportIssueScreen from '../screens/fe/ReportIssueScreen';
import NpsScreen from '../screens/listings/concierge/NpsScreen';
import RequestFeVisitScreen from '../screens/listings/RequestFeVisitScreen';
import CommunityProofScreen from '../screens/community/CommunityProofScreen';
// Sprint 4 / Pass 3: real screens replacing Pass 2 stubs
import VerificationWallScreen from '../screens/auth/VerificationWallScreen';
import FeVisitConfirmationScreen from '../screens/listings/FeVisitConfirmationScreen';
// ── Sprint 8 / Phase 2: AI-Assisted Listing ─────────────────────────────  // SPRINT8_PHASE2_AI
import AIListingCameraScreen from '../screens/listings/ai/AIListingCameraScreen';
import AIListingSuggestScreen from '../screens/listings/ai/AIListingSuggestScreen';
import AIListingIdentifierScreen from '../screens/listings/ai/AIListingIdentifierScreen';
import EditListingScreen from '../screens/listings/EditListingScreen';
import SellTabRedirect from '../screens/listings/ai/SellTabRedirect';
// Concierge master spec — Phase 1
import SellModeForkScreen from '../screens/listings/SellModeForkScreen';
import ConciergeBookingScreen from '../screens/listings/concierge/BookingScreen';
import ConciergeBookingConfirmedScreen from '../screens/listings/concierge/BookingConfirmedScreen';
import MyConciergeScreen from '../screens/listings/concierge/MyConciergeScreen';
// Concierge master spec — Phase 2
import VisitDetailScreen from '../screens/listings/concierge/VisitDetailScreen';
import ArrivalVerificationScreen from '../screens/listings/concierge/ArrivalVerificationScreen';

import type { RootStackParams, AuthStackParams, TabParams } from './types';

const RootStack = createNativeStackNavigator<RootStackParams>();
const FeStack = createNativeStackNavigator<RootStackParams>();
const AuthStack = createNativeStackNavigator<AuthStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

/**
 * Bottom tab cell (non-Sell). Material You–style: contained pill
 * behind the icon when active, label always visible underneath.
 * Inactive icons sit on a transparent pill so the active-state
 * transition is purely background — no icon hop. Inactive icon
 * color bumped from C.text4 → C.text2 (passes WCAG AA on white).
 */
function TabCell({
  label, icon, active, badge,
}: {
  label: string;
  icon: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <View style={st.cell}>
      <View style={[st.iconPill, active && st.iconPillActive]}>
        <Text style={[st.cellIcon, active && st.cellIconActive]}>{icon}</Text>
        {badge && badge > 0 ? (
          <View style={st.badge}>
            <Text style={st.badgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[st.cellLabel, active && st.cellLabelActive]}>{label}</Text>
    </View>
  );
}

/**
 * Sell-tab FAB — raised circular button +14px above the bar
 * baseline, soft petrol glow shadow. Anchors the primary marketplace
 * action ("List something") so "I came here to sell" lands in one
 * tap. Same idiom as Instagram's centred create button + WhatsApp's
 * call FAB.
 */
function SellFab({ active }: { active: boolean }) {
  return (
    <View style={st.fabSlot}>
      <View style={[st.fab, active && st.fabActive]}>
        <Text style={st.fabPlus} allowFontScaling={false}>＋</Text>
      </View>
      <Text style={[st.fabLabel, active && st.fabLabelActive]}>Sell</Text>
    </View>
  );
}

function AuthFlowNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="OtpVerify" component={OtpVerifyScreen} />
    </AuthStack.Navigator>
  );
}

/**
 * MainTabsWithAddressGate — Address PRD section 4.1
 *
 * Replaces the old "is locationSet AsyncStorage?" check with a real
 * "does this user have at least one saved address?" API check that
 * fires once after auth. If 0 addresses, the user is reset onto the
 * LocationDetect screen with returnTo=MainTabs; AddressDetailsScreen
 * then resets back here on save.
 *
 * The check fires once per authenticated session via a ref. Logging
 * out resets the ref (via the isAuthenticated transition) so re-login
 * re-checks. Errors don't gate — if the API is down we let the user
 * into MainTabs and surface the prompt later via Profile (Phase 2).
 */
function MainTabsWithAddressGate() {
  const { isAuthenticated } = useAuthStore();
  const navigation = require('@react-navigation/native').useNavigation();
  const checkedRef = React.useRef(false);

  React.useEffect(() => {
    // Reset the gate on logout so the next sign-in re-checks.
    if (!isAuthenticated) {
      checkedRef.current = false;
      return;
    }
    if (checkedRef.current) return;
    checkedRef.current = true;

    (async () => {
      try {
        const { Addresses } = require('../services/api');
        const res = await Addresses.list();
        if (Array.isArray(res.data) && res.data.length === 0) {
          navigation.reset({
            index: 0,
            routes: [
              { name: 'LocationDetect', params: { returnTo: 'MainTabs' } },
            ],
          });
        }
      } catch {
        // Silent — don't gate on transient API failures.
      }
    })();
  }, [isAuthenticated, navigation]);

  return <MainTabs />;
}

/**
 * Five-tab layout: Home · Search · Sell (raised FAB) · Notifications · Profile.
 * The Sell tab is the centre slot and renders as a circular FAB; the
 * other four are contained-pill cells.
 *
 * Notifications gets a badge slot — wire `useUnreadNotifications()` (or
 * any future Zustand selector) into the `notifBadge` value to surface
 * the unread count. Currently 0 (no source yet) — UI is ready.
 */
function MainTabs() {
  const { isAuthenticated } = useAuthStore();
  const insets = useSafeAreaInsets();

  // Placeholder — wire to a real unread-notifications source when ready.
  const notifBadge = 0;

  const tabs: { key: keyof TabParams; label: string; icon: string }[] = [
    { key: 'Home',          label: 'Home',          icon: '⌂' },
    { key: 'Search',        label: 'Search',        icon: '🔍' },
    { key: 'Sell',          label: 'Sell',          icon: '＋' },
    { key: 'Notifications', label: 'Inbox',         icon: '🔔' },
    { key: 'Profile',       label: 'Profile',       icon: '👤' },
  ];

  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation: tabNav }) => (
        <View style={[st.tabBar, { paddingBottom: Math.max(insets.bottom, S.sm) }]}>
          {tabs.map((tab, index) => {
            const active = state.index === index;
            const isSell = tab.key === 'Sell';
            const onPress = () => {
              if (isSell && !isAuthenticated) {
                (tabNav as any).getParent()?.navigate('AuthFlow');
                return;
              }
              if (tab.key === 'Notifications' && !isAuthenticated) {
                (tabNav as any).getParent()?.navigate('AuthFlow');
                return;
              }
              tabNav.navigate(tab.key as never);
            };
            return (
              <TouchableOpacity
                key={tab.key}
                style={st.tabTouch}
                onPress={onPress}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: active }}
              >
                {isSell ? (
                  <SellFab active={active} />
                ) : (
                  <TabCell
                    label={tab.label}
                    icon={tab.icon}
                    active={active}
                    badge={tab.key === 'Notifications' ? notifBadge : undefined}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      {/* Sell tab → fork screen. Renders as raised FAB in the bar. */}
      <Tab.Screen name="Sell" component={SellModeForkScreen} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function FeRootStack() {
  return (
    <NavigationContainer>
      <FeStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="FeHome">
        <FeStack.Screen name="FeHome" component={FeHomeScreen} />
        <FeStack.Screen name="FeOps" component={FeOpsScreen} options={{ animation: 'slide_from_right' }} />
        <FeStack.Screen name="FeVisitDetail" component={FeVisitDetailScreen} options={{ animation: 'slide_from_right' }} />
        <FeStack.Screen name="FeCapture" component={FeCaptureScreen} options={{ animation: 'slide_from_right' }} />
        <FeStack.Screen name="FeVisitHistory" component={FeVisitHistoryScreen} options={{ animation: 'slide_from_right' }} />
        {/* Concierge Phase 3 — specialist excellence */}
        <FeStack.Screen name="SellerApproval" component={SellerApprovalScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <FeStack.Screen name="VisitContinue" component={VisitContinueScreen} options={{ animation: 'slide_from_right' }} />
        {/* Concierge Phase 5 — trust safety net (FE side) */}
        <FeStack.Screen name="ReportIssue" component={ReportIssueScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      </FeStack.Navigator>
    </NavigationContainer>
  );
}

export default function RootNavigator() {
  const { hydrate, hydrated, isAuthenticated, role } = useAuthStore();
  const [locationSet, setLocationSet] = useState<boolean | null>(null);
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);
  // Minimum-display floor so the splash doesn't flash on fast devices —
  // same 700ms guard Amazon / Meesho use to keep brand perception
  // consistent regardless of cold-start speed.
  const [splashMinElapsed, setSplashMinElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSplashMinElapsed(true), 700);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    hydrate();

    Promise.all([
      AsyncStorage.getItem(LOCATION_KEY),
      AsyncStorage.getItem(ONBOARDING_SEEN_KEY),
    ]).then(async ([loc, onb]) => {
      setLocationSet(!!loc);
      setOnboardingSeen(!!onb);

      if (onb && !loc) {
        try {
          const { PermissionsAndroid, Platform } = require('react-native');
          if (Platform.OS === 'android') {
            const hasPermission = await PermissionsAndroid.check(
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            );
            if (hasPermission) {
              const Geolocation = require('@react-native-community/geolocation').default;
              Geolocation.getCurrentPosition(
                async (pos: any) => {
                  const { latitude, longitude } = pos.coords;
                  await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify({
                    lat: latitude, lng: longitude, city: 'Detecting...', state: '',
                    fullAddress: 'Detecting address...',
                  }));
                  setLocationSet(true);
                },
                () => {},
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
              );
            }
          }
        } catch {}
      }
    });

    // Sync tier/role from backend on startup
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      import('../services/api').then(({ Auth }) => {
        Auth.me().then(r => {
          const { setTier, setKycStatus, setTriState } = useAuthStore.getState();
          const d = r.data || {};
          if (d.tier) setTier(d.tier);
          if (d.kyc_status) setKycStatus(d.kyc_status);
          if (d.auth_state) {
            setTriState(
              d.auth_state,
              !!d.buyer_eligible,
              d.seller_tier || 'not_eligible',
              d.role || 'user',
            );
          }
        }).catch(() => {});
      });
    }
  }, []);

  if (!hydrated || locationSet === null || onboardingSeen === null || !splashMinElapsed) {
    return <SplashScreen />;
  }

  // ── FE branch: if logged-in user has FE role, show the FE app ──────────────
  if (isAuthenticated && role === 'fe') {
    return <FeRootStack />;
  }

  if (!locationSet) {
    return (
      <LocationPickerScreen
        onLocationSet={() => setLocationSet(true)}
      />
    );
  }

  if (!onboardingSeen) {
    return (
      <OnboardingScreen
        navigation={{
          navigate: () => {
            AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
            setOnboardingSeen(true);
          },
        }}
      />
    );
  }

  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="MainTabs" component={MainTabsWithAddressGate} />
        <RootStack.Screen name="ListingDetail" component={ListingDetailScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="TransactionDetail" component={TransactionDetailScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="KidsSection" component={KidsSectionScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="AuthFlow" component={AuthFlowNavigator} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <RootStack.Screen name="KycFlow" component={KycFlowScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <RootStack.Screen name="KycRequiredForAction" component={KycRequiredForActionScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        {/* Profile sub-screens */}
        <RootStack.Screen name="MyListings" component={MyListingsScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="MyFeVisits" component={MyFeVisitsScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="SavedItems" component={WishlistScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="TransactionList" component={TransactionListScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="EditProfile" component={EditProfileScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="Notifications" component={NotificationsScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="SellerProfile" component={SellerProfileScreen} options={{ animation: 'slide_from_right' }} />
        {/* Purchase flow */}
        <RootStack.Screen name="Checkout" component={CheckoutScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} options={{ animation: 'fade', gestureEnabled: false }} />
        {/* Concierge master spec — Phase 1 booking flow */}
        <RootStack.Screen name="SellModeFork" component={SellModeForkScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="ConciergeBooking" component={ConciergeBookingScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="ConciergeBookingConfirmed" component={ConciergeBookingConfirmedScreen} options={{ animation: 'fade', gestureEnabled: false }} />
        <RootStack.Screen name="MyConcierge" component={MyConciergeScreen} options={{ animation: 'slide_from_right' }} />
        {/* Concierge Phase 2 — trust theater deep links */}
        <RootStack.Screen name="VisitDetail" component={VisitDetailScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="ArrivalVerification" component={ArrivalVerificationScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        {/* Concierge Phase 5 — seller NPS (deep-linked from notification) */}
        <RootStack.Screen name="ConciergeNps" component={NpsScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        {/* Legacy seller-facing FE request screen — DEPRECATED in Concierge
            Phase 1, file kept (marked @deprecated) for reference only.
            Phase 5 deletes the file. */}
        <RootStack.Screen name="RequestFeVisit" component={RequestFeVisitScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="FeVisitConfirmation" component={FeVisitConfirmationScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="VerificationWall" component={VerificationWallScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        {/* Sprint 7 / Phase 1: Community proof */}
        <RootStack.Screen name="CommunityProof" component={CommunityProofScreen} options={{ animation: 'slide_from_right' }} />
        {/* SPRINT8_LOCATION_ROUTE: re-entry to location picker from anywhere */}
        <RootStack.Screen
          name="LocationPicker"
          component={LocationPickerRoute}
          options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
        />
        {/* Sprint 6b: My Offers (Received / Sent / Deals) */}
        <RootStack.Screen name="MyOffers" component={OffersScreen} options={{ animation: 'slide_from_right' }} />
        {/* Sprint 8 / Phase 2: AI-Assisted Listing — SPRINT8_PHASE2_AI */}
        <RootStack.Screen name="AIListingCamera" component={AIListingCameraScreen} options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <RootStack.Screen name="AIListingSuggest" component={AIListingSuggestScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="AIListingIdentifier" component={AIListingIdentifierScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="EditListing" component={EditListingScreen} options={{ animation: 'slide_from_right' }} />
        {/* Manual-entry listing form — fallback when AI can't run. */}
        <RootStack.Screen name="CreateListing" component={CreateListingScreen} options={{ animation: 'slide_from_right' }} />
        {/* Address PRD: 3-screen flow + picker */}
        <RootStack.Screen name="LocationDetect" component={LocationDetectScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="LocationMap" component={LocationMapScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="AddressDetails" component={AddressDetailsScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="AddressPicker" component={AddressPickerScreen} options={{ animation: 'slide_from_right' }} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

// SPRINT8_LOCATION_ROUTE: wrapper that makes LocationPickerScreen
// usable as a navigable route (it normally takes onLocationSet as a
// prop instead of route params).
function LocationPickerRoute({ navigation }: any) {
  return (
    <LocationPickerScreen
      onLocationSet={() => {
        // After the user picks a location, just close the modal.
        // The HomeScreen's useLocation hook will pick up the new
        // value from AsyncStorage on next render.
        navigation.goBack();
      }}
    />
  );
}

const st = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: S.sm,
    minHeight: 64,
  },
  tabTouch: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },

  // ── Non-Sell tab cell: Material You–style icon pill + label ─────────────
  cell: { alignItems: 'center', justifyContent: 'center', paddingTop: 2 },
  iconPill: {
    width: 56,
    height: 28,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  iconPillActive: { backgroundColor: C.petrolLight },
  cellIcon: { fontSize: T.size.lg, color: C.text2, lineHeight: 20 },
  cellIconActive: { color: C.petrol },
  cellLabel: {
    fontSize: T.size.xs,
    fontWeight: T.weight.medium,
    color: C.text2,
    marginTop: 2,
  },
  cellLabelActive: { color: C.petrol, fontWeight: T.weight.semi },

  // ── Notification badge (unread count) ───────────────────────────────────
  badge: {
    position: 'absolute',
    top: -2,
    right: 8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: C.coral,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.surface,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: T.weight.bold,
    color: C.white,
    lineHeight: 12,
  },

  // ── Sell tab: raised petrol FAB ─────────────────────────────────────────
  fabSlot: { alignItems: 'center', justifyContent: 'flex-start' },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.petrol,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -14,
    ...Shadow.glow,
  },
  fabActive: { backgroundColor: C.petrolDeep },
  fabPlus: {
    fontSize: T.size.xxl,
    fontWeight: '300',
    color: C.white,
    lineHeight: T.size.xxl + 2,
    marginTop: -1,
  },
  fabLabel: {
    fontSize: T.size.xs,
    fontWeight: T.weight.medium,
    color: C.text2,
    marginTop: 2,
  },
  fabLabelActive: { color: C.petrol, fontWeight: T.weight.semi },
});
