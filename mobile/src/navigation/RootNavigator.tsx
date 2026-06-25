/**
 * RootNavigator — Sprint 4 / Pass 3
 *
 * Pass 3 changes:
 *   - VerificationWallStub → real VerificationWallScreen
 *   - FeVisitConfirmationStub → real FeVisitConfirmationScreen
 *   - Stub functions and stub styles removed
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, NativeModules, Platform, StatusBar, View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { enableFreeze } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Home as HomeIcon,
  Compass as CompassIcon,
  Camera as CameraIcon,
  Bell as BellIcon,
  User as UserIcon,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useAuthStore } from '../store/authStore';
import { ONBOARDING_SEEN_KEY } from '../utils/storageKeys';
import { C, T, S, R, Shadow } from '../utils/tokens';
import SplashScreen from '../components/SplashScreen';
import { Button } from '../components/ui';
import {
  ADDRESS_GATE_RETRY_DELAYS_MS,
  resolveAddressGate,
} from './addressGate';

import type { RootStackParams, AuthStackParams, TabParams } from './types';

type ScreenLoader = () => { default: React.ComponentType<any> };
const screen = (loader: ScreenLoader) => () => loader().default;

const getHomeScreen = screen(() => require('../screens/HomeScreen'));
const getSearchScreen = screen(() => require('../screens/SearchScreen'));
const getSellModeForkScreen = screen(() => require('../screens/listings/SellModeForkScreen'));
const getNotificationsScreen = screen(() => require('../screens/profile/NotificationsScreen'));
const getProfileScreen = screen(() => require('../screens/profile/ProfileScreen'));
const getOnboardingScreen = screen(() => require('../screens/auth/OnboardingScreen'));
const getRegisterScreen = screen(() => require('../screens/auth/RegisterScreen'));
const getOtpVerifyScreen = screen(() => require('../screens/auth/OtpVerifyScreen'));
const getListingDetailScreen = screen(() => require('../screens/listings/ListingDetailScreen'));
const getTransactionDetailScreen = screen(() => require('../screens/TransactionDetailScreen'));
const getKidsSectionScreen = screen(() => require('../screens/kids/KidsSectionScreen'));
const getKycFlowScreen = screen(() => require('../screens/auth/KycFlowScreen'));
const getKycRequiredForActionScreen = screen(() => require('../screens/KycRequiredForActionScreen'));
const getMyListingsScreen = screen(() => require('../screens/listings/MyListingsScreen'));
const getMyFeVisitsScreen = screen(() => require('../screens/profile/MyFeVisitsScreen'));
const getWishlistScreen = screen(() => require('../screens/profile/WishlistScreen'));
const getTransactionListScreen = screen(() => require('../screens/profile/TransactionListScreen'));
const getEditProfileScreen = screen(() => require('../screens/profile/EditProfileScreen'));
const getSellerProfileScreen = screen(() => require('../screens/profile/SellerProfileScreen'));
const getCheckoutScreen = screen(() => require('../screens/purchase/CheckoutScreen'));
const getOrderConfirmationScreen = screen(() => require('../screens/purchase/OrderConfirmationScreen'));
const getFeHomeScreen = screen(() => require('../screens/fe/FeHomeScreen'));
const getFeOpsScreen = screen(() => require('../screens/fe/FeOpsScreen'));
const getFeVisitDetailScreen = screen(() => require('../screens/fe/FeVisitDetailScreen'));
const getFeCaptureScreen = screen(() => require('../screens/fe/FeCaptureScreen'));
const getFeVisitHistoryScreen = screen(() => require('../screens/fe/FeVisitHistoryScreen'));
const getSellerApprovalScreen = screen(() => require('../screens/fe/SellerApprovalScreen'));
const getVisitContinueScreen = screen(() => require('../screens/fe/VisitContinueScreen'));
const getReportIssueScreen = screen(() => require('../screens/fe/ReportIssueScreen'));
const getConciergeBookingScreen = screen(() => require('../screens/listings/concierge/BookingScreen'));
const getConciergeBookingConfirmedScreen = screen(() => require('../screens/listings/concierge/BookingConfirmedScreen'));
const getMyConciergeScreen = screen(() => require('../screens/listings/concierge/MyConciergeScreen'));
const getVisitDetailScreen = screen(() => require('../screens/listings/concierge/VisitDetailScreen'));
const getArrivalVerificationScreen = screen(() => require('../screens/listings/concierge/ArrivalVerificationScreen'));
const getConciergeNpsScreen = screen(() => require('../screens/listings/concierge/NpsScreen'));
const getFeVisitConfirmationScreen = screen(() => require('../screens/listings/FeVisitConfirmationScreen'));
const getVerificationWallScreen = screen(() => require('../screens/auth/VerificationWallScreen'));
const getCommunityProofScreen = screen(() => require('../screens/community/CommunityProofScreen'));
const getOffersScreen = screen(() => require('../screens/OffersScreen'));
const getAIListingCameraScreen = screen(() => require('../screens/listings/ai/AIListingCameraScreen'));
const getAIListingSuggestScreen = screen(() => require('../screens/listings/ai/AIListingSuggestScreen'));
const getAIListingIdentifierScreen = screen(() => require('../screens/listings/ai/AIListingIdentifierScreen'));
const getEditListingScreen = screen(() => require('../screens/listings/EditListingScreen'));
const getCreateListingScreen = screen(() => require('../screens/listings/CreateListingScreen'));
const getLocationDetectScreen = screen(() => require('../screens/auth/address/LocationDetectScreen'));
const getLocationMapScreen = screen(() => require('../screens/auth/address/LocationMapScreen'));
const getAddressDetailsScreen = screen(() => require('../screens/auth/address/AddressDetailsScreen'));
const getAddressPickerScreen = screen(() => require('../screens/auth/address/AddressPickerScreen'));

const RootStack = createNativeStackNavigator<RootStackParams>();
const FeStack = createNativeStackNavigator<RootStackParams>();
const AuthStack = createNativeStackNavigator<AuthStackParams>();
const Tab = createBottomTabNavigator<TabParams>();
const SPLASH_STATUS_BG = C.splashBg;
const APP_STATUS_BG = C.bone;
const SPLASH_MIN_MS = 450;

enableFreeze(true);

function setAndroidNavigationBar(backgroundColor: string, darkIcons: boolean) {
  if (Platform.OS !== 'android') return;
  NativeModules.SystemBars?.setNavigationBarColor(backgroundColor, darkIcons);
}

/**
 * Bottom tab cell (non-Sell). Material You–style: contained pill
 * behind the icon when active, label always visible underneath.
 * Inactive icons sit on a transparent pill so the active-state
 * transition is purely background — no icon hop. Inactive icon
 * color bumped from C.text4 → C.text2 (passes WCAG AA on white).
 *
 * Icons are Lucide line glyphs (proper SVG, tintable, OS-consistent)
 * — replaces the emoji-as-icon shortcut that was rendering as Apple
 * stickers on iOS / Material blobs on Android.
 */
function TabCell({
  label, Icon, active, badge,
}: {
  label: string;
  Icon: LucideIcon;
  active: boolean;
  badge?: number;
  tabKey: keyof TabParams;
}) {
  return (
    <View style={st.cell}>
      <View style={[st.iconPill, active && st.iconPillActive]}>
        <Icon
          size={21}
          strokeWidth={active ? 2.25 : 2}
          color={active ? C.white : C.text2}
        />
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
 * Sell-tab FAB — raised circular button +14px above the bar baseline.
 * Uses the same logo teal as Home and primary CTAs so the core marketplace
 * action feels native to the Owmee brand system.
 */
function SellFab({ active }: { active: boolean }) {
  return (
    <View style={st.fabSlot}>
      <View style={[st.fab, active && st.fabActive]}>
        <CameraIcon size={18} strokeWidth={2.25} color={active ? C.white : C.ctaPrimary} />
      </View>
      <Text style={[st.fabLabel, active && st.fabLabelActive]}>Sell</Text>
    </View>
  );
}

function AuthFlowNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <AuthStack.Screen name="Register" getComponent={getRegisterScreen} />
      <AuthStack.Screen name="OtpVerify" getComponent={getOtpVerifyScreen} />
    </AuthStack.Navigator>
  );
}

/**
 * MainTabsWithAddressGate — Address PRD section 4.1
 *
 * Replaces the old local-location gate with a real
 * "does this user have at least one saved address?" API check that
 * fires once after auth. If 0 addresses, the user is reset onto the
 * LocationDetect screen with returnTo=MainTabs; AddressDetailsScreen
 * then resets back here on save.
 *
 * The check fires once per authenticated user. It only marks complete after a
 * successful backend response and retries short transient failures; this keeps
 * fresh signups from missing the address flow during the OTP/auth handoff.
 */
function MainTabsWithAddressGate() {
  const { isAuthenticated, userId } = useAuthStore();
  const navigation = useNavigation<any>();
  const checkedUserRef = React.useRef<string | null>(null);
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = React.useRef(0);
  const [checking, setChecking] = React.useState(false);
  const [gateFailedOpen, setGateFailedOpen] = React.useState(false);
  const [gateError, setGateError] = React.useState(false);
  const [retryTick, setRetryTick] = React.useState(0);

  const authUserKey = isAuthenticated && userId ? userId : null;

  React.useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // Reset the gate on logout so the next sign-in re-checks.
    if (!authUserKey) {
      checkedUserRef.current = null;
      retryCountRef.current = 0;
      setChecking(false);
      setGateFailedOpen(false);
      setGateError(false);
      return;
    }

    if (checkedUserRef.current === authUserKey) {
      setChecking(false);
      setGateFailedOpen(false);
      setGateError(false);
      return;
    }

    let cancelled = false;
    setChecking(true);
    setGateFailedOpen(false);
    setGateError(false);

    (async () => {
      try {
        const { Addresses, clearApiCache } = require('../services/api');
        const decision = await resolveAddressGate({
          listAddresses: Addresses.list,
          clearAddressCache: () => clearApiCache('/v1/users/me/addresses'),
        });

        if (cancelled) return;
        checkedUserRef.current = authUserKey;
        retryCountRef.current = 0;

        if (decision === 'needs_address') {
          navigation.reset({
            index: 0,
            routes: [
              { name: 'LocationDetect', params: { returnTo: 'MainTabs' } },
            ],
          });
        }
      } catch {
        if (cancelled) return;

        checkedUserRef.current = null;
        const retryIndex = retryCountRef.current;
        const delay = ADDRESS_GATE_RETRY_DELAYS_MS[retryIndex];
        if (delay != null) {
          retryCountRef.current = retryIndex + 1;
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            setRetryTick((v) => v + 1);
          }, delay);
          return;
        }

        // Do not silently skip the signup address flow. A final failure becomes
        // an explicit recovery choice so users can retry or consciously browse
        // without a saved address until the backend is reachable.
        setGateError(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [authUserKey, navigation, retryTick]);

  const retryAddressGate = () => {
    retryCountRef.current = 0;
    setGateError(false);
    setChecking(true);
    setRetryTick((v) => v + 1);
  };

  const continueWithoutLocation = () => {
    if (authUserKey) checkedUserRef.current = authUserKey;
    setGateFailedOpen(true);
    setGateError(false);
    setChecking(false);
  };

  if (gateError && authUserKey) {
    return (
      <AddressGateRecovery
        onRetry={retryAddressGate}
        onContinue={continueWithoutLocation}
      />
    );
  }

  const needsGate =
    !!authUserKey &&
    checkedUserRef.current !== authUserKey &&
    !gateFailedOpen;

  if (checking || needsGate) {
    return <AddressGateLoading />;
  }

  return <MainTabs />;
}

function AddressGateLoading() {
  return (
    <View style={st.addressGate}>
      <ActivityIndicator color={C.ctaPrimary} />
      <Text style={st.addressGateText}>Preparing your Owmee account...</Text>
    </View>
  );
}

function AddressGateRecovery({
  onRetry,
  onContinue,
}: {
  onRetry: () => void;
  onContinue: () => void;
}) {
  return (
    <View style={st.addressGate}>
      <Text style={st.addressGateTitle}>Could not check your saved address</Text>
      <Text style={st.addressGateHint}>
        Please retry. You can continue for now, but Owmee will ask for your
        address before checkout, pickup, or delivery.
      </Text>
      <View style={st.addressGateActions}>
        <Button label="Retry" onPress={onRetry} fullWidth />
        <Button
          label="Continue for now"
          variant="ghost"
          onPress={onContinue}
          fullWidth
        />
      </View>
    </View>
  );
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

  // Sell.Icon is unused (SellFab renders its own Camera glyph) but
  // kept in the array shape so the index/layout math stays clean.
  //
  // Direct buyer-seller chat is not part of Owmee. This tab is activity and
  // transaction notifications only, so keep the label away from chat language.
  const tabs: { key: keyof TabParams; label: string; Icon: LucideIcon }[] = [
    { key: 'Home',          label: 'Home',    Icon: HomeIcon    },
    { key: 'Search',        label: 'Search',  Icon: CompassIcon },
    { key: 'Sell',          label: 'Sell',    Icon: CameraIcon  },
    { key: 'Notifications', label: 'Activity', Icon: BellIcon   },
    { key: 'Profile',       label: 'Profile', Icon: UserIcon    },
  ];

  return (
    <Tab.Navigator
      detachInactiveScreens
      screenOptions={{ headerShown: false, freezeOnBlur: true, lazy: true }}
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
                    tabKey={tab.key}
                    label={tab.label}
                    Icon={tab.Icon}
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
      <Tab.Screen name="Home" getComponent={getHomeScreen} />
      <Tab.Screen name="Search" getComponent={getSearchScreen} />
      {/* Sell tab → fork screen. Renders as raised FAB in the bar. */}
      <Tab.Screen name="Sell" getComponent={getSellModeForkScreen} />
      <Tab.Screen name="Notifications" getComponent={getNotificationsScreen} />
      <Tab.Screen name="Profile" getComponent={getProfileScreen} />
    </Tab.Navigator>
  );
}

function FeRootStack() {
  return (
    <NavigationContainer>
      <FeStack.Navigator screenOptions={{ headerShown: false, freezeOnBlur: true }} initialRouteName="FeHome">
        <FeStack.Screen name="FeHome" getComponent={getFeHomeScreen} />
        <FeStack.Screen name="FeOps" getComponent={getFeOpsScreen} options={{ animation: 'slide_from_right' }} />
        <FeStack.Screen name="FeVisitDetail" getComponent={getFeVisitDetailScreen} options={{ animation: 'slide_from_right' }} />
        <FeStack.Screen name="FeCapture" getComponent={getFeCaptureScreen} options={{ animation: 'slide_from_right' }} />
        <FeStack.Screen name="FeVisitHistory" getComponent={getFeVisitHistoryScreen} options={{ animation: 'slide_from_right' }} />
        {/* Concierge Phase 3 — specialist excellence */}
        <FeStack.Screen name="SellerApproval" getComponent={getSellerApprovalScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <FeStack.Screen name="VisitContinue" getComponent={getVisitContinueScreen} options={{ animation: 'slide_from_right' }} />
        {/* Concierge Phase 5 — trust safety net (FE side) */}
        <FeStack.Screen name="ReportIssue" getComponent={getReportIssueScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
      </FeStack.Navigator>
    </NavigationContainer>
  );
}

export default function RootNavigator() {
  const { hydrate, hydrated, isAuthenticated, role } = useAuthStore();
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);
  // Small display floor prevents a blink on fast starts without making
  // the launch feel artificially held.
  const [splashMinElapsed, setSplashMinElapsed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSplashMinElapsed(true), SPLASH_MIN_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    hydrate();
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY).then((onb) => {
      setOnboardingSeen(!!onb);
    });
  }, [hydrate]);

  const appReady = hydrated && onboardingSeen !== null && splashMinElapsed;

  useEffect(() => {
    setAndroidNavigationBar(
      appReady ? APP_STATUS_BG : SPLASH_STATUS_BG,
      appReady,
    );
  }, [appReady]);

  useEffect(() => {
    if (!appReady || Platform.OS !== 'android') return;
    NativeModules.SplashControl?.hide?.();
  }, [appReady]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return;
    let alive = true;

    import('../services/api').then(({ Auth }) => {
      Auth.me().then(r => {
        if (!alive) return;
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

    return () => {
      alive = false;
    };
  }, [hydrated, isAuthenticated]);

  if (!appReady) {
    return <SplashScreen />;
  }

  const appStatusBar = (
    <StatusBar
      barStyle="dark-content"
      backgroundColor={APP_STATUS_BG}
      translucent={false}
    />
  );

  // ── FE branch: if logged-in user has FE role, show the FE app ──────────────
  if (isAuthenticated && role === 'fe') {
    return (
      <>
        {appStatusBar}
        <FeRootStack />
      </>
    );
  }

  if (!onboardingSeen) {
    const OnboardingScreen = getOnboardingScreen();
    return (
      <>
        {appStatusBar}
        <OnboardingScreen
          navigation={{
            navigate: () => {
              AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
              setOnboardingSeen(true);
            },
          }}
        />
      </>
    );
  }

  return (
    <>
      {appStatusBar}
      <NavigationContainer>
        <RootStack.Navigator screenOptions={{ headerShown: false, freezeOnBlur: true }}>
          <RootStack.Screen name="MainTabs" component={MainTabsWithAddressGate} />
          <RootStack.Screen name="ListingDetail" getComponent={getListingDetailScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="TransactionDetail" getComponent={getTransactionDetailScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="KidsSection" getComponent={getKidsSectionScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="AuthFlow" component={AuthFlowNavigator} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <RootStack.Screen name="KycFlow" getComponent={getKycFlowScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <RootStack.Screen name="KycRequiredForAction" getComponent={getKycRequiredForActionScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          {/* Profile sub-screens */}
          <RootStack.Screen name="MyListings" getComponent={getMyListingsScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="MyFeVisits" getComponent={getMyFeVisitsScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="SavedItems" getComponent={getWishlistScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="TransactionList" getComponent={getTransactionListScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="EditProfile" getComponent={getEditProfileScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="Notifications" getComponent={getNotificationsScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="SellerProfile" getComponent={getSellerProfileScreen} options={{ animation: 'slide_from_right' }} />
          {/* Purchase flow */}
          <RootStack.Screen name="Checkout" getComponent={getCheckoutScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="OrderConfirmation" getComponent={getOrderConfirmationScreen} options={{ animation: 'fade', gestureEnabled: false }} />
          {/* Concierge master spec — Phase 1 booking flow */}
          <RootStack.Screen name="SellModeFork" getComponent={getSellModeForkScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="ConciergeBooking" getComponent={getConciergeBookingScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="ConciergeBookingConfirmed" getComponent={getConciergeBookingConfirmedScreen} options={{ animation: 'fade', gestureEnabled: false }} />
          <RootStack.Screen name="MyConcierge" getComponent={getMyConciergeScreen} options={{ animation: 'slide_from_right' }} />
          {/* Concierge Phase 2 — trust theater deep links */}
          <RootStack.Screen name="VisitDetail" getComponent={getVisitDetailScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="ArrivalVerification" getComponent={getArrivalVerificationScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          {/* Concierge Phase 5 — seller NPS (deep-linked from notification) */}
          <RootStack.Screen name="ConciergeNps" getComponent={getConciergeNpsScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          <RootStack.Screen name="FeVisitConfirmation" getComponent={getFeVisitConfirmationScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="VerificationWall" getComponent={getVerificationWallScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
          {/* Sprint 7 / Phase 1: Community proof */}
          <RootStack.Screen name="CommunityProof" getComponent={getCommunityProofScreen} options={{ animation: 'slide_from_right' }} />
          {/* Sprint 6b: My Offers (Received / Sent / Deals) */}
          <RootStack.Screen name="MyOffers" getComponent={getOffersScreen} options={{ animation: 'slide_from_right' }} />
          {/* Sprint 8 / Phase 2: AI-Assisted Listing — SPRINT8_PHASE2_AI */}
          <RootStack.Screen name="AIListingCamera" getComponent={getAIListingCameraScreen} options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
          <RootStack.Screen name="AIListingSuggest" getComponent={getAIListingSuggestScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="AIListingIdentifier" getComponent={getAIListingIdentifierScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="EditListing" getComponent={getEditListingScreen} options={{ animation: 'slide_from_right' }} />
          {/* Manual-entry listing form — fallback when AI can't run. */}
          <RootStack.Screen name="CreateListing" getComponent={getCreateListingScreen} options={{ animation: 'slide_from_right' }} />
          {/* Address PRD: 3-screen flow + picker */}
          <RootStack.Screen name="LocationDetect" getComponent={getLocationDetectScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="LocationMap" getComponent={getLocationMapScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="AddressDetails" getComponent={getAddressDetailsScreen} options={{ animation: 'slide_from_right' }} />
          <RootStack.Screen name="AddressPicker" getComponent={getAddressPickerScreen} options={{ animation: 'slide_from_right' }} />
        </RootStack.Navigator>
      </NavigationContainer>
    </>
  );
}

const st = StyleSheet.create({
  addressGate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.sm,
    backgroundColor: C.bone,
    paddingHorizontal: S.xl,
  },
  addressGateText: {
    fontSize: T.size.base,
    fontWeight: T.weight.medium,
    color: C.text3,
    textAlign: 'center',
  },
  addressGateTitle: {
    fontSize: T.size.xl,
    fontWeight: T.weight.bold,
    color: C.text,
    textAlign: 'center',
  },
  addressGateHint: {
    maxWidth: 340,
    fontSize: T.size.base,
    color: C.text3,
    textAlign: 'center',
    lineHeight: 21,
  },
  addressGateActions: {
    width: '100%',
    maxWidth: 280,
    gap: S.sm,
    marginTop: S.sm,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border2,
    borderRadius: R.xl + 2,
    marginHorizontal: S.lg,
    marginBottom: S.xs + 2,
    paddingTop: S.xs + 2,
    minHeight: 60,
    ...Shadow.subtle,
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
    borderWidth: 1,
    borderColor: 'transparent',
  },
  iconPillActive: {
    backgroundColor: C.ctaPrimary,
    borderColor: C.ctaPrimary,
  },
  cellLabel: {
    fontSize: T.size.xs,
    fontWeight: T.weight.medium,
    color: C.text2,
    marginTop: 2,
  },
  cellLabelActive: { color: C.ctaPrimary, fontWeight: T.weight.semi },

  // ── Notification badge (unread count) ───────────────────────────────────
  badge: {
    position: 'absolute',
    top: -2,
    right: 8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: C.bone,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: C.surface,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: T.weight.bold,
    color: C.coralDeep,
    lineHeight: 12,
  },

  // ── Sell tab: raised logo-color FAB ────────────────────────────────────
  // Soft teal at rest, filled logo teal when active.
  fabSlot: { alignItems: 'center', justifyContent: 'flex-start' },
  fab: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.ctaPrimarySoft,
    borderWidth: 1,
    borderColor: C.ctaPrimaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.subtle,
  },
  // Press-state uses inline opacity via activeOpacity on the wrapping
  // TouchableOpacity.
  fabActive: {
    backgroundColor: C.ctaPrimary,
    borderColor: C.ctaPrimary,
  },
  fabLabel: {
    fontSize: T.size.xs,
    fontWeight: T.weight.medium,
    color: C.text2,
    marginTop: 2,
  },
  fabLabelActive: { color: C.ctaPrimary, fontWeight: T.weight.semi },
});
