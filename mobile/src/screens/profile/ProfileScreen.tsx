import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R } from '../../utils/tokens';
import { Button } from '../../components/ui';
import { Auth } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useLocation } from '../../hooks/useLocation';

interface UserProfile {
  id: string; phone_number: string; name?: string; city?: string;
  tier: string; kyc_status: string; trust_score?: number;
  listings_count?: number; deals_count?: number; avg_rating?: number;
}

interface MenuItem {
  emoji: string;
  label: string;
  route: string | null;
  onPress?: () => void;
}

export default function ProfileScreen({ navigation }: any) {
  const { isAuthenticated, phone, kycStatus, tier, logout, setTier, setKycStatus } = useAuthStore();
  const { location } = useLocation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!isAuthenticated) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await Auth.me();
        if (cancelled) return;
        setProfile(res.data);
        if (res.data.tier && res.data.tier !== tier) setTier(res.data.tier as any);
        if (res.data.kyc_status && res.data.kyc_status !== kycStatus) setKycStatus(res.data.kyc_status as any);
      } catch {} finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]));

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.gate}>
          <Text style={s.gateEmoji}>◉</Text>
          <Text style={s.gateH}>Your profile</Text>
          <Text style={s.gateSub}>Sign in to manage listings, track deals, and build your reputation.</Text>
          <Button
            label="Sign in"
            variant="primary"
            onPress={() => navigation.getParent()?.navigate('AuthFlow')}
            style={s.gateBtn}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color={C.petrol} style={s.loading} />
      </SafeAreaView>
    );
  }

  const displayName = profile?.name || phone || 'Owmee User';
  const displayCity = location?.locality || location?.city;
  const isVerified = kycStatus === 'verified';

  const menuItems: MenuItem[] = [
    { emoji: '🚚', label: 'My Concierge', route: 'MyConcierge' },
    { emoji: '📦', label: 'My listings', route: 'MyListings' },
    { emoji: '✉️', label: 'My offers', route: 'MyOffers' },
    { emoji: '📦', label: 'Your FE visits', route: 'MyFeVisits' },
    { emoji: '♡', label: 'Saved items', route: 'SavedItems' },
    { emoji: '📋', label: 'Transaction history', route: 'TransactionList' },
    { emoji: '🔔', label: 'Notifications', route: 'Notifications' },
    {
      emoji: '☎', label: 'Help & support', route: null,
      onPress: () => Alert.alert(
        'Help & Support',
        'Contact us:\n\nsupport@owmee.in\n\nGrievance Officer:\ngrievance@owmee.in\nResponse within 48 hours\n\nData deletion requests:\nprivacy@owmee.in',
      ),
    },
  ];

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={s.body}>
        <Text style={s.hdr}>Profile</Text>

        <TouchableOpacity
          style={s.userCard}
          onPress={() => navigation.navigate('EditProfile')}
          activeOpacity={0.85}
        >
          <View style={s.avatar}>
            <Text style={s.avatarT}>{displayName[0].toUpperCase()}</Text>
          </View>
          <View style={s.flex1}>
            <Text style={s.name}>{displayName}</Text>
            <Text style={s.phone}>{phone}</Text>
            <View style={s.userMetaRow}>
              <View style={[s.trustBadge, isVerified && s.trustBadgeOn]}>
                <Text style={[s.trustText, isVerified && s.trustTextOn]}>
                  {isVerified ? '✓ Verified' : 'Not verified'}
                </Text>
              </View>
              {displayCity && <Text style={s.userMeta}>📍 {displayCity}</Text>}
              {profile?.trust_score != null && (
                <Text style={s.userMeta}>🛡️ {profile.trust_score}</Text>
              )}
            </View>
          </View>
          <Text style={s.userArrow}>›</Text>
        </TouchableOpacity>

        {!isVerified && (
          <TouchableOpacity
            style={s.kycBanner}
            onPress={() => navigation.navigate('KycFlow')}
            activeOpacity={0.85}
          >
            <View style={s.kycIcon}><Text style={s.kycIconText}>🪪</Text></View>
            <View style={s.flex1}>
              <Text style={s.kycTitle}>Get the Verified badge</Text>
              <Text style={s.kycSub}>Tap to verify — trusted sellers rank higher</Text>
            </View>
            <Text style={s.kycArrow}>→</Text>
          </TouchableOpacity>
        )}

        {profile && (
          <View style={s.statsGrid}>
            <View style={s.statCard}>
              <Text style={s.statNum}>{profile.listings_count || 0}</Text>
              <Text style={s.statLabel}>Listings</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statNum}>{profile.deals_count || 0}</Text>
              <Text style={s.statLabel}>Deals</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statNum}>
                {profile.avg_rating ? `${profile.avg_rating.toFixed(1)}★` : '—'}
              </Text>
              <Text style={s.statLabel}>Rating</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statNum}>{isVerified ? '✓' : '—'}</Text>
              <Text style={s.statLabel}>KYC</Text>
            </View>
          </View>
        )}

        {menuItems.map(item => (
          <TouchableOpacity
            key={item.label}
            style={s.menuRow}
            onPress={() => {
              if (item.onPress) item.onPress();
              else if (item.route) navigation.navigate(item.route);
            }}
          >
            <Text style={s.menuEmoji}>{item.emoji}</Text>
            <Text style={s.menuLabel}>{item.label}</Text>
            <Text style={s.menuArrow}>›</Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={s.logoutBtn}
          onPress={() => Alert.alert('Sign out?', '', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: logout },
          ])}
        >
          <Text style={s.logoutText}>Sign out</Text>
        </TouchableOpacity>

        <View style={s.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  loading: { marginTop: S.xxxl + S.xxxl },
  body: { flex: 1, paddingHorizontal: S.lg },
  flex1: { flex: 1 },
  bottomSpacer: { height: 100 },

  hdr: {
    fontSize: T.size.xxl - 2,
    fontWeight: T.weight.bold,
    color: C.text,
    paddingTop: S.sm,
    marginBottom: S.lg,
  },

  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: S.md,
    backgroundColor: C.surface, borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1, borderColor: C.border,
    marginBottom: S.md,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: C.petrolLight,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarT: { fontSize: T.size.xxl - 2, fontWeight: T.weight.bold, color: C.petrolDeep },
  name: { fontSize: T.size.lg, fontWeight: T.weight.bold, color: C.text },
  phone: { fontSize: T.size.sm, color: C.text3, marginTop: 1 },
  userMetaRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.xs },
  userMeta: { fontSize: T.size.sm, color: C.text3 },
  userArrow: { fontSize: T.size.lg + 1, color: C.text4 },

  trustBadge: {
    backgroundColor: C.bone2,
    paddingHorizontal: S.sm, paddingVertical: 3,
    borderRadius: R.xs,
  },
  trustBadgeOn: { backgroundColor: C.petrolLight },
  trustText: { fontSize: T.size.sm, color: C.text3, fontWeight: T.weight.semi },
  trustTextOn: { color: C.petrol },

  kycBanner: {
    flexDirection: 'row', alignItems: 'center', gap: S.md,
    backgroundColor: C.petrolLight, borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.lg,
    borderWidth: 1, borderColor: C.petrol,
  },
  kycIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.white,
    alignItems: 'center', justifyContent: 'center',
  },
  kycIconText: { fontSize: T.size.xl },
  kycTitle: { fontSize: T.size.md, fontWeight: T.weight.semi, color: C.petrolDeep },
  kycSub: { fontSize: T.size.sm, color: C.text3, marginTop: 2 },
  kycArrow: { fontSize: T.size.lg + 1, color: C.petrol },

  statsGrid: { flexDirection: 'row', gap: S.sm, marginBottom: S.lg },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: R.sm,
    padding: S.md, borderWidth: 1, borderColor: C.border,
    alignItems: 'center',
  },
  statNum: { fontSize: T.size.lg + 1, fontWeight: T.weight.bold, color: C.text },
  statLabel: { fontSize: T.size.xs, color: C.text3, marginTop: 2 },

  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: S.md,
    paddingVertical: S.lg,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  menuEmoji: { fontSize: T.size.lg - 1 },
  menuLabel: { flex: 1, fontSize: T.size.md, color: C.text },
  menuArrow: { fontSize: T.size.lg + 1, color: C.text4 },

  logoutBtn: {
    marginTop: S.xxl,
    paddingVertical: S.md + 2,
    alignItems: 'center',
    borderRadius: R.sm,
    borderWidth: 1, borderColor: C.red,
  },
  logoutText: { fontSize: T.size.sm + 1, color: C.red },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xxxl },
  gateEmoji: { fontSize: T.size.display + 18, marginBottom: S.lg },
  gateH: { fontSize: T.size.lg + 1, fontWeight: T.weight.semi, color: C.text, marginBottom: S.xs },
  gateSub: { fontSize: T.size.sm, color: C.text3, textAlign: 'center', lineHeight: 18 },
  gateBtn: { marginTop: S.xl },
});
