/**
 * SellerProfileScreen — Buyer views seller's public profile
 * Shows: name, city, KYC badge, trust score, ratings, deal count, active listings
 */
import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, useWindowDimensions, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R, Shadow, formatPrice, timeAgo } from '../../utils/tokens';
import { Listings, type Listing } from '../../services/api';
import { ListingCard, calcCardWidth } from '../../components/listing/ListingCard';

export default function SellerProfileScreen({ navigation, route }: any) {
  const { seller } = route.params; // { id, name, city, kyc_verified, avg_rating, deal_count, trust_score, member_since }
  const { width: sw } = useWindowDimensions();
  const cardWidth = useMemo(() => calcCardWidth(sw), [sw]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        // Fetch seller's active listings
        const res = await Listings.browse({ limit: 20 });
        // Filter by seller_id client-side (until backend supports seller filter)
        const sellerListings = (res.data?.listings || res.data || [])
          .filter((l: Listing) => l.seller_id === seller.id);
        setListings(sellerListings);
      } catch {} finally { setLoading(false); }
    })();
  }, [seller.id]);

  const header = () => (
    <>
      {/* Seller card */}
      <View style={s.profileCard}>
        <View style={s.avatar}><Text style={s.avatarText}>{(seller.name || 'S')[0].toUpperCase()}</Text></View>
        <Text style={s.name}>{seller.name || 'Seller'}</Text>
        {seller.city && <Text style={s.city}>📍 {seller.city}</Text>}

        {/* Badges */}
        <View style={s.badges}>
          {seller.kyc_verified && (
            <View style={s.kycBadge}><Text style={s.kycBadgeText}>✓ Aadhaar Verified</Text></View>
          )}
          {seller.trust_score != null && (
            <View style={s.trustBadge}><Text style={s.trustBadgeText} onPress={() => Alert.alert('Trust Score', 'Trust score is calculated from:\n\n• KYC verification (+20)\n• Completed deals (+5 each)\n• Positive ratings (+3 each)\n• Account age (+1/month)\n• Penalties for cancellations (-10)\n\nHigher score = more trustworthy seller.')}>🛡️ Trust: {seller.trust_score} ⓘ</Text></View>
          )}
        </View>

        {/* Stats */}
        <View style={s.stats}>
          <View style={s.stat}>
            <Text style={s.statNum}>{seller.deal_count || 0}</Text>
            <Text style={s.statLabel}>Deals</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statNum}>{seller.avg_rating ? `${seller.avg_rating.toFixed(1)}★` : '—'}</Text>
            <Text style={s.statLabel}>Rating</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statNum}>{listings.length}</Text>
            <Text style={s.statLabel}>Active</Text>
          </View>
          <View style={s.statDivider} />
          <View style={s.stat}>
            <Text style={s.statNum}>{seller.member_since ? timeAgo(seller.member_since) : '—'}</Text>
            <Text style={s.statLabel}>Joined</Text>
          </View>
        </View>
      </View>

      {/* Section header */}
      {listings.length > 0 && (
        <Text style={s.sectionTitle}>Active listings ({listings.length})</Text>
      )}
    </>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={{ fontSize: 20, color: C.text2 }}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Seller profile</Text>
        <TouchableOpacity onPress={() => Alert.alert('Actions', '', [
          { text: 'Report user', onPress: () => {
            import('../../services/api').then(({ Reports }) => {
              Reports.reportUser(seller.id, 'inappropriate').then(() => {
                Alert.alert('Reported', 'Our team will review within 48 hours.');
              }).catch(() => Alert.alert('Error', 'Could not submit report'));
            });
          }},
          { text: 'Block user', style: 'destructive', onPress: () => {
            import('../../services/api').then(({ Reports }) => {
              Reports.blockUser(seller.id).then(() => {
                Alert.alert('Blocked', "You won't see this seller's listings anymore.", [
                  { text: 'OK', onPress: () => navigation.goBack() },
                ]);
              }).catch(() => Alert.alert('Error', 'Could not block user'));
            });
          }},
          { text: 'Cancel', style: 'cancel' },
        ])}><Text style={{ fontSize: 18, color: C.text3 }}>⋮</Text></TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={C.honey} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={listings}
          keyExtractor={i => i.id}
          numColumns={2}
          columnWrapperStyle={s.gridRow}
          ListHeaderComponent={header}
          ListFooterComponent={<View style={{ height: 100 }} />}
          renderItem={({ item }) => (
            <ListingCard listing={item} onPress={l => navigation.navigate('ListingDetail', { listingId: l.id })} cardWidth={cardWidth} />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>📦</Text>
              <Text style={s.emptyText}>No active listings</Text>
            </View>
          }
          removeClippedSubviews maxToRenderPerBatch={6} windowSize={5}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  profileCard: { alignItems: 'center', backgroundColor: C.surface, margin: 16, borderRadius: R.xl, padding: 24, borderWidth: 1, borderColor: C.border, ...Shadow.card },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.honeyLight, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 28, fontWeight: '700', color: C.honeyDeep },
  name: { fontSize: 20, fontWeight: '700', color: C.ink },
  city: { fontSize: 13, color: C.text3, marginTop: 4 },
  badges: { flexDirection: 'row', gap: 8, marginTop: 12 },
  kycBadge: { backgroundColor: C.forestLight, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  kycBadgeText: { fontSize: 12, fontWeight: '700', color: C.forest },
  trustBadge: { backgroundColor: C.sand, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  trustBadgeText: { fontSize: 12, fontWeight: '600', color: C.text2 },
  stats: { flexDirection: 'row', marginTop: 20, width: '100%', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '800', color: C.ink },
  statLabel: { fontSize: 10, color: C.text3, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
  statDivider: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.ink, paddingHorizontal: 16, marginTop: 8, marginBottom: 8 },
  gridRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },
  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: 14, color: C.text3 },
});
