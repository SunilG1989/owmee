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

// Consumer screens
import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import CreateListingScreen from '../screens/listings/CreateListingScreen';
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
import FeVisitHistoryScreen from '../screens/fe/FeVisitHistoryScreen';
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

import type { RootStackParams, AuthStackParams, TabParams } from './types';

const RootStack = createNativeStackNavigator<RootStackParams>();
const FeStack = createNativeStackNavigator<RootStackParams>();
const AuthStack = createNativeStackNavigator<AuthStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

function TabIcon({ label, icon, active }: { label: string; icon: string; active: boolean }) {
  if (label === 'Sell') {
    return (
      <View style={st.fab}>
        <Text style={st.fabIcon}>+</Text>
      </View>
    );
  }
  return (
    <View style={st.tabItem}>
      <Text style={[st.tabIcon, active && { color: C.honey }]}>{icon}</Text>
      <Text style={[st.tabLabel, active && { color: C.honey, fontWeight: '600' }]}>{label}</Text>
      {active && <View style={st.tabDot} />}
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

function MainTabs() {
  const { isAuthenticated } = useAuthStore();
  const insets = useSafeAreaInsets();

  const tabs = [
    { key: 'Home', label: 'Home', icon: '⌂' },
    { key: 'Search', label: 'Search', icon: '🔍' },
    { key: 'Sell', label: 'Sell', icon: '+' },
    { key: 'Profile', label: 'Profile', icon: '👤' },
  ];

  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation: tabNav }) => (
        <View style={[st.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {tabs.map((tab, index) => (
            <TouchableOpacity
              key={tab.key}
              style={st.tabTouch}
              onPress={() => {
                if (tab.key === 'Sell' && !isAuthenticated) {
                  (tabNav as any).getParent()?.navigate('AuthFlow');
                  return;
                }
                tabNav.navigate(tab.key as keyof TabParams);
              }}
              activeOpacity={0.7}
            >
              <TabIcon label={tab.label} icon={tab.icon} active={state.index === index} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen name="Sell" component={SellTabRedirect} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function FeRootStack() {
  return (
    <NavigationContainer>
      <FeStack.Navigator screenOptions={{ headerShown: false }} initialRouteName="FeHome">
        <FeStack.Screen name="FeHome" component={FeHomeScreen} />
        <FeStack.Screen name="FeVisitDetail" component={FeVisitDetailScreen} options={{ animation: 'slide_from_right' }} />
        <FeStack.Screen name="FeCapture" component={FeCaptureScreen} options={{ animation: 'slide_from_right' }} />
        <FeStack.Screen name="FeVisitHistory" component={FeVisitHistoryScreen} options={{ animation: 'slide_from_right' }} />
      </FeStack.Navigator>
    </NavigationContainer>
  );
}

export default function RootNavigator() {
  const { hydrate, hydrated, isAuthenticated, role } = useAuthStore();
  const [locationSet, setLocationSet] = useState<boolean | null>(null);
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);

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

  if (!hydrated || locationSet === null || onboardingSeen === null) {
    return <View style={{ flex: 1, backgroundColor: C.cream }} />;
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
        <RootStack.Screen name="MainTabs" component={MainTabs} />
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
        {/* Sprint 4 / Pass 2 + Pass 3: FE seller-facing flow */}
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
        {/* Sprint 8 / Phase 2: AI-Assisted Listing — SPRINT8_PHASE2_AI */}
        <RootStack.Screen name="AIListingCamera" component={AIListingCameraScreen} options={{ animation: 'slide_from_bottom', presentation: 'fullScreenModal' }} />
        <RootStack.Screen name="AIListingSuggest" component={AIListingSuggestScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="AIListingIdentifier" component={AIListingIdentifierScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="EditListing" component={EditListingScreen} options={{ animation: 'slide_from_right' }} />
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
    paddingTop: 6,
  },
  tabTouch: { flex: 1, alignItems: 'center' },
  tabItem: { alignItems: 'center', gap: 2 },
  tabIcon: { fontSize: 18, color: C.text4 },
  tabLabel: { fontSize: 10, fontWeight: '500', color: C.text4 },
  tabDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.honey, marginTop: 2 },
  fab: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: C.honey,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: -4,
    ...Shadow.glow,
  },
  fabIcon: { fontSize: 28, fontWeight: '200', color: '#fff', marginTop: -2 },
});
