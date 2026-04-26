/**
 * Owmee Navigation — fully wired
 *
 *   Root
 *     ├── Auth Stack (Onboarding → OtpPhone → OtpVerify)
 *     └── App Stack
 *           ├── MainTabs (Home / Search / Sell / Deals / Profile)
 *           ├── ListingDetail
 *           ├── TransactionDetail     — local meetup flow
 *           ├── ShippedTransaction    — Phase 2 shipped flow
 *           ├── TransactionList       — all deals
 *           ├── KycFlow (modal)
 *           └── KidsSection
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuthStore } from '../store/authStore';
import { Colors, Spacing } from '../utils/tokens';

// ── Param lists ───────────────────────────────────────────────────────────────

export type AuthStackParams = {
  Onboarding: undefined;
  OtpPhone: undefined;
  OtpVerify: { phone: string };
};

export type AppStackParams = {
  MainTabs: undefined;
  ListingDetail: { listingId: string };
  TransactionDetail: { transactionId: string };
  ShippedTransaction: { transactionId: string };
  TransactionList: undefined;
  KycFlow: { returnTo?: string };
  KidsSection: undefined;
};

export type TabParams = {
  Home: undefined;
  Search: undefined;
  Sell: undefined;
  Deals: undefined;
  Profile: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParams>();
const AppStack = createNativeStackNavigator<AppStackParams>();
const Tab = createBottomTabNavigator<TabParams>();

// ── Imports ───────────────────────────────────────────────────────────────────
import OnboardingScreen from '../screens/auth/OnboardingScreen';
import { OtpPhoneScreen } from '../screens/auth/OtpPhoneScreen';
import OtpVerifyScreen from '../screens/auth/OtpVerifyScreen';
import KycFlowScreen from '../screens/auth/KycFlowScreen';
import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import OffersScreen from '../screens/OffersScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import ListingDetailScreen from '../screens/listings/ListingDetailScreen';
import CreateListingScreen from '../screens/listings/CreateListingScreen';
import TransactionDetailScreen from '../screens/TransactionDetailScreen';
import ShippedTransactionScreen from '../screens/listings/ShippedTransactionScreen';
import TransactionListScreen from '../screens/TransactionListScreen';
import KidsSectionScreen from '../screens/kids/KidsSectionScreen';

// ── Tab icon component ────────────────────────────────────────────────────────

function TabIcon({ label, icon, active }: { label: string; icon: string; active: boolean }) {
  const isSell = label === 'Sell';
  if (isSell) {
    return (
      <View style={styles.sellIcon}>
        <Text style={styles.sellIconText}>+</Text>
      </View>
    );
  }
  return (
    <View style={styles.tabIconWrap}>
      <View style={[styles.tabIconBox, active && styles.tabIconBoxActive]}>
        <Text style={[styles.tabIconText, active && styles.tabIconTextActive]}>{icon}</Text>
      </View>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      {active && <View style={styles.tabPip} />}
    </View>
  );
}

// ── Tab navigator ─────────────────────────────────────────────────────────────

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false, tabBarStyle: styles.tabBar, tabBarShowLabel: false }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Home" icon="⬡" active={focused} /> }}
      />
      <Tab.Screen
        name="Search"
        component={SearchScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Search" icon="◎" active={focused} /> }}
      />
      <Tab.Screen
        name="Sell"
        component={CreateListingScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Sell" icon="+" active={focused} /> }}
      />
      <Tab.Screen
        name="Deals"
        component={TransactionListScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Deals" icon="🤝" active={focused} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Profile" icon="◉" active={focused} /> }}
      />
    </Tab.Navigator>
  );
}

// ── App stack ─────────────────────────────────────────────────────────────────

function AppNavigator() {
  return (
    <AppStack.Navigator screenOptions={{ headerShown: false }}>
      <AppStack.Screen name="MainTabs" component={MainTabs} />
      <AppStack.Screen name="ListingDetail" component={ListingDetailScreen} />
      <AppStack.Screen name="TransactionDetail" component={TransactionDetailScreen} />
      <AppStack.Screen name="ShippedTransaction" component={ShippedTransactionScreen} />
      <AppStack.Screen name="TransactionList" component={TransactionListScreen} />
      <AppStack.Screen name="KidsSection" component={KidsSectionScreen} />
      <AppStack.Screen
        name="KycFlow"
        component={KycFlowScreen}
        options={{ presentation: 'modal' }}
      />
    </AppStack.Navigator>
  );
}

// ── Auth stack ────────────────────────────────────────────────────────────────

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Onboarding" component={OnboardingScreen} />
      <AuthStack.Screen name="OtpPhone" component={OtpPhoneScreen} />
      <AuthStack.Screen name="OtpVerify" component={OtpVerifyScreen} />
    </AuthStack.Navigator>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function RootNavigator() {
  const { isAuthenticated, hydrate } = useAuthStore();

  useEffect(() => {
    hydrate();
  }, []);

  return (
    <NavigationContainer>
      {isAuthenticated ? <AppNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.bg,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
    height: 72,
    paddingBottom: 8,
  },
  tabIconWrap: { alignItems: 'center', gap: 2, paddingTop: 6 },
  tabIconBox: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: Colors.border2,
    alignItems: 'center', justifyContent: 'center',
  },
  tabIconBoxActive: { backgroundColor: Colors.tealLight },
  tabIconText: { fontSize: 14, color: Colors.text4 },
  tabIconTextActive: { color: Colors.teal },
  tabLabel: { fontSize: 8, fontWeight: '500', color: Colors.text4, marginTop: 1 },
  tabLabelActive: { color: Colors.teal },
  tabPip: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.teal, marginTop: 2 },
  sellIcon: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: Colors.teal,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2, marginTop: 6,
  },
  sellIconText: { fontSize: 20, color: Colors.white, lineHeight: 22, fontWeight: '300' },
});
