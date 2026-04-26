/**
 * RootNavigator — Sprint 3 redesign
 *
 * Key changes from Sprint 2:
 *   1. AuthFlow skips OnboardingScreen → goes straight to Register (name + phone)
 *   2. Guest users land on MainTabs immediately (browse, search, view listings)
 *   3. Auth only triggered when user taps Sell, Deals, Offer, Buy, or Wishlist
 *   4. KYC is a separate modal — only shown when verified-tier action is attempted
 *   5. OnboardingScreen only shown on FIRST EVER app open (stored in AsyncStorage)
 *
 * Flow:
 *   First open  → LocationPicker → Onboarding (once) → MainTabs
 *   Return user → MainTabs (browse freely)
 *   Tap Sell    → AuthFlow modal (Register → OTP) → back to Sell tab
 *   Tap Publish → KYC modal (Aadhaar → Address → PAN → Selfie → Payout)
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../store/authStore';
import { C, T, S, R, Shadow } from '../utils/tokens';

// Screens
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
import LocationPickerScreen from '../screens/auth/LocationPickerScreen';
// Profile sub-screens
import MyListingsScreen from '../screens/listings/MyListingsScreen';
import TransactionListScreen from '../screens/profile/TransactionListScreen';
import WishlistScreen from '../screens/profile/WishlistScreen';
import EditProfileScreen from '../screens/profile/EditProfileScreen';
import NotificationsScreen from '../screens/profile/NotificationsScreen';
import SellerProfileScreen from '../screens/profile/SellerProfileScreen';
// Purchase flow
import CheckoutScreen from '../screens/purchase/CheckoutScreen';
import OrderConfirmationScreen from '../screens/purchase/OrderConfirmationScreen';

import type { RootStackParams, AuthStackParams, TabParams } from './types';

const RootStack = createNativeStackNavigator<RootStackParams>();
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

/**
 * AuthFlow — Sprint 3: Skip onboarding, go straight to Register
 * Register is now just name + phone (light signup).
 * Trust info is shown inline on the RegisterScreen itself.
 */
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
    { key: 'Deals', label: 'Deals', icon: '💬' },
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
                // Gate: Sell and Deals require login
                if ((tab.key === 'Sell' || tab.key === 'Deals') && !isAuthenticated) {
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
      <Tab.Screen name="Sell" component={CreateListingScreen} />
      <Tab.Screen name="Deals" component={OffersScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { hydrate, hydrated } = useAuthStore();
  const [locationSet, setLocationSet] = useState<boolean | null>(null);
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);

  useEffect(() => {
    hydrate();

    // Check location + onboarding status in parallel
    Promise.all([
      AsyncStorage.getItem('@ow_location'),
      AsyncStorage.getItem('@ow_onboarding_seen'),
    ]).then(async ([loc, onb]) => {
      setLocationSet(!!loc);
      setOnboardingSeen(!!onb);

      // Auto-detect location silently if:
      //   - user has been here before (onboarding seen)
      //   - no location saved yet
      //   - location permission already granted (don't prompt)
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
                  // Minimal fallback save — location picker will handle full reverse geocode
                  await AsyncStorage.setItem('@ow_location', JSON.stringify({
                    lat: latitude, lng: longitude, city: 'Detecting...', state: '',
                    fullAddress: 'Detecting address...',
                  }));
                  setLocationSet(true);
                },
                () => {}, // silent fail — user will see picker
                { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
              );
            }
          }
        } catch {}
      }
    });

    // Sync KYC status from backend on startup
    const { accessToken } = useAuthStore.getState();
    if (accessToken) {
      import('../services/api').then(({ Auth }) => {
        Auth.me().then(r => {
          const { setTier, setKycStatus } = useAuthStore.getState();
          if (r.data?.tier) setTier(r.data.tier);
          if (r.data?.kyc_status) setKycStatus(r.data.kyc_status);
        }).catch(() => {});
      });
    }
  }, []);

  // Wait for hydration + async checks
  if (!hydrated || locationSet === null || onboardingSeen === null) {
    return <View style={{ flex: 1, backgroundColor: C.cream }} />;
  }

  // Step 1: Location picker (first time)
  if (!locationSet) {
    return (
      <LocationPickerScreen
        onLocationSet={() => setLocationSet(true)}
      />
    );
  }

  // Step 2: Onboarding slides (first time ONLY — then never again)
  if (!onboardingSeen) {
    return (
      <OnboardingScreen
        navigation={{
          navigate: () => {
            AsyncStorage.setItem('@ow_onboarding_seen', 'true');
            setOnboardingSeen(true);
          },
        }}
      />
    );
  }

  // Step 3: Main app — guest or logged in
  return (
    <NavigationContainer>
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        <RootStack.Screen name="MainTabs" component={MainTabs} />
        <RootStack.Screen name="ListingDetail" component={ListingDetailScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="TransactionDetail" component={TransactionDetailScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="KidsSection" component={KidsSectionScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="AuthFlow" component={AuthFlowNavigator} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <RootStack.Screen name="KycFlow" component={KycFlowScreen} options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        {/* Profile sub-screens */}
        <RootStack.Screen name="MyListings" component={MyListingsScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="SavedItems" component={WishlistScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="TransactionList" component={TransactionListScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="EditProfile" component={EditProfileScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="Notifications" component={NotificationsScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="SellerProfile" component={SellerProfileScreen} options={{ animation: 'slide_from_right' }} />
        {/* Purchase flow */}
        <RootStack.Screen name="Checkout" component={CheckoutScreen} options={{ animation: 'slide_from_right' }} />
        <RootStack.Screen name="OrderConfirmation" component={OrderConfirmationScreen} options={{ animation: 'fade', gestureEnabled: false }} />
      </RootStack.Navigator>
    </NavigationContainer>
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
