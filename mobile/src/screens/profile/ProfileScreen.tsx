import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, formatPrice } from '../../utils/tokens';
import { Auth } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useLocation } from '../../hooks/useLocation';

interface UserProfile {
  id: string; phone_number: string; name?: string; city?: string;
  tier: string; kyc_status: string; trust_score?: number;
  listings_count?: number; deals_count?: number; avg_rating?: number;
}

export default function ProfileScreen({ navigation }: any) {
  const { isAuthenticated, phone, kycStatus, tier, logout, setTier, setKycStatus } = useAuthStore();
  const { location } = useLocation();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!isAuthenticated) { setLoading(false); return; }
    (async () => {
      try {
        const res = await Auth.me();
        setProfile(res.data);
        // Sync tier and kycStatus from backend (source of truth)
        if (res.data.tier && res.data.tier !== tier) setTier(res.data.tier as any);
        if (res.data.kyc_status && res.data.kyc_status !== kycStatus) setKycStatus(res.data.kyc_status as any);
      } catch {} finally { setLoading(false); }
    })();
  }, [isAuthenticated]));

  if (!isAuthenticated) return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.gate}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>◉</Text>
        <Text style={s.gateH}>Your profile</Text>
        <Text style={s.gateSub}>Sign in to manage listings, track deals, and build your reputation.</Text>
        <TouchableOpacity style={s.gateBtn} onPress={() => navigation.getParent()?.navigate('AuthFlow')}>
          <Text style={{ fontSize: 14, color: '#fff', fontWeight: '600' }}>Sign in</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;

  const displayName = profile?.name || phone || 'Owmee User';
  const displayCity = profile?.city || location?.city;
  const isVerified = kycStatus === 'verified';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={s.body}>
        <Text style={s.hdr}>Profile</Text>

        {/* User card */}
        <TouchableOpacity style={s.userCard} onPress={() => navigation.navigate('EditProfile')} activeOpacity={0.85}>
          <View style={s.avatar}>
            <Text style={s.avatarT}>{displayName[0].toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{displayName}</Text>
            <Text style={s.phone}>{phone}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <View style={[s.trustBadge, isVerified && { backgroundColor: C.forestLight }]}>
                <Text style={[s.trustText, isVerified && { color: C.forest }]}>{isVerified ? '✓ Verified' : 'Not verified'}</Text>
              </View>
              {displayCity && <Text style={{ fontSize: 11, color: C.text3 }}>📍 {displayCity}</Text>}
              {profile?.trust_score != null && <Text style={{ fontSize: 11, color: C.text3 }}>🛡️ {profile.trust_score}</Text>}
            </View>
          </View>
          <Text style={{ fontSize: 18, color: C.text4 }}>›</Text>
        </TouchableOpacity>

        {/* KYC banner */}
        {!isVerified && (
          <TouchableOpacity style={s.kycBanner} onPress={() => navigation.navigate('KycFlow')} activeOpacity={0.85}>
            <View style={s.kycIcon}><Text style={{ fontSize: 20 }}>🪪</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.kycTitle}>Get the Verified badge</Text>
              <Text style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>Tap to verify — trusted sellers rank higher</Text>
            </View>
            <Text style={{ fontSize: 18, color: C.honey }}>→</Text>
          </TouchableOpacity>
        )}

        {/* Stats */}
        {profile && (
          <View style={s.statsGrid}>
            <View style={s.statCard}><Text style={s.statNum}>{profile.listings_count || 0}</Text><Text style={s.statLabel}>Listings</Text></View>
            <View style={s.statCard}><Text style={s.statNum}>{profile.deals_count || 0}</Text><Text style={s.statLabel}>Deals</Text></View>
            <View style={s.statCard}><Text style={s.statNum}>{profile.avg_rating ? `${profile.avg_rating.toFixed(1)}★` : '—'}</Text><Text style={s.statLabel}>Rating</Text></View>
            <View style={s.statCard}><Text style={s.statNum}>{isVerified ? '✓' : '—'}</Text><Text style={s.statLabel}>KYC</Text></View>
          </View>
        )}

        {/* Menu items — ALL WIRED */}
        <TouchableOpacity style={s.menuRow} onPress={() => navigation.navigate('MyListings')}>
          <Text style={{ fontSize: 16 }}>📦</Text><Text style={s.menuLabel}>My listings</Text><Text style={s.menuArrow}>›</Text>
        </TouchableOpacity>
            <TouchableOpacity style={s.menuRow} onPress={() => navigation.navigate('MyFeVisits')}>
          <Text style={{ fontSize: 16 }}>📦</Text><Text style={s.menuLabel}>Your FE visits</Text><Text style={s.menuArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.menuRow} onPress={() => navigation.navigate('SavedItems')}>
          <Text style={{ fontSize: 16 }}>♡</Text><Text style={s.menuLabel}>Saved items</Text><Text style={s.menuArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.menuRow} onPress={() => navigation.navigate('TransactionList')}>
          <Text style={{ fontSize: 16 }}>📋</Text><Text style={s.menuLabel}>Transaction history</Text><Text style={s.menuArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.menuRow} onPress={() => navigation.navigate('Notifications')}>
          <Text style={{ fontSize: 16 }}>🔔</Text><Text style={s.menuLabel}>Notifications</Text><Text style={s.menuArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.menuRow} onPress={() => Alert.alert('Help & Support', 'Contact us:\n\nsupport@owmee.in\n\nGrievance Officer:\ngrievance@owmee.in\nResponse within 48 hours\n\nData deletion requests:\nprivacy@owmee.in')}>
          <Text style={{ fontSize: 16 }}>💬</Text><Text style={s.menuLabel}>Help & support</Text><Text style={s.menuArrow}>›</Text>
        </TouchableOpacity>

        {/* Sign out */}
        <TouchableOpacity style={s.logoutBtn} onPress={() => Alert.alert('Sign out?', '', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out', style: 'destructive', onPress: logout },
        ])}>
          <Text style={{ fontSize: 14, color: C.red }}>Sign out</Text>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  body: { flex: 1, paddingHorizontal: 16 },
  hdr: { fontSize: 22, fontWeight: '700', color: C.text, paddingTop: 8, marginBottom: 16 },
  userCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.honeyLight, alignItems: 'center', justifyContent: 'center' },
  avatarT: { fontSize: 22, fontWeight: '700', color: C.honeyDeep },
  name: { fontSize: 17, fontWeight: '700', color: C.text },
  phone: { fontSize: 12, color: C.text3, marginTop: 1 },
  trustBadge: { backgroundColor: C.sand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  trustText: { fontSize: 11, color: C.text3, fontWeight: '600' },
  kycBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.honeyLight, borderRadius: R.lg, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.honey },
  kycIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  kycTitle: { fontSize: 15, fontWeight: '600', color: C.honeyDeep },
  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: C.surface, borderRadius: R.sm, padding: 12, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '700', color: C.text },
  statLabel: { fontSize: 10, color: C.text3, marginTop: 2 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: C.border },
  menuLabel: { flex: 1, fontSize: 15, color: C.text },
  menuArrow: { fontSize: 18, color: C.text4 },
  logoutBtn: { marginTop: 24, paddingVertical: 14, alignItems: 'center', borderRadius: R.sm, borderWidth: 1, borderColor: C.red },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  gateH: { fontSize: 18, fontWeight: '600', color: C.text, marginBottom: 4 },
  gateSub: { fontSize: 12, color: C.text3, textAlign: 'center', lineHeight: 18 },
  gateBtn: { marginTop: 20, backgroundColor: C.honey, borderRadius: R.sm, paddingHorizontal: 24, paddingVertical: 12 },
});
