/**
 * SellerProfileScreen — Buyer views seller's public profile
 * Shows: name, city, KYC badge, trust score, ratings, deal count, active listings
 */
import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, useWindowDimensions, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton, IconButton } from '../../components/ui';
import { C, T, S, R, Shadow, formatPrice, timeAgo } from '../../utils/tokens';
import { Listings, type Listing } from '../../services/api';
import { ListingCard, calcCardWidth } from '../../components/listing/ListingCard';
import { useAuthStore } from '../../store/authStore';

export default function SellerProfileScreen({ navigation, route }: any) {
  const { seller } = route.params; // { id, name, city, kyc_verified, avg_rating, deal_count, trust_score, member_since }
  const { width: sw } = useWindowDimensions();
  const cardWidth = useMemo(() => calcCardWidth(sw), [sw]);
  const { isAuthenticated } = useAuthStore();
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

  const openBuySafely = (listing: Listing) => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    navigation.navigate('Checkout', { listingId: listing.id });
  };

  const openMakeOffer = (listing: Listing) => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    navigation.navigate('ListingDetail', { listingId: listing.id, openOffer: true });
  };

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
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Seller profile</Text>
        <IconButton
          icon="⋮"
          onPress={() => Alert.alert('Actions', '', [
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
          ])}
          a11y="Seller actions"
          size="sm"
        />
      </View>

      {loading ? (
        <ActivityIndicator color={C.petrol} style={s.loading} />
      ) : (
        <FlatList
          data={listings}
          keyExtractor={i => i.id}
          numColumns={2}
          columnWrapperStyle={s.gridRow}
          ListHeaderComponent={header}
          ListFooterComponent={<View style={s.bottomSpacer} />}
          renderItem={({ item }) => (
            <ListingCard
              listing={item}
              onPress={l => navigation.navigate('ListingDetail', { listingId: l.id })}
              onBuySafely={openBuySafely}
              onMakeOffer={openMakeOffer}
              cardWidth={cardWidth}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>📦</Text>
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
  safe: { flex: 1, backgroundColor: C.bone },
  loading: { marginTop: S.xxxl + S.xxxl },
  bottomSpacer: { height: 100 },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingVertical: S.sm + 2,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: T.size.lg - 1, fontWeight: T.weight.semi, color: C.text },
  profileCard: {
    alignItems: 'center', backgroundColor: C.surface,
    margin: S.lg, borderRadius: R.xl, padding: S.xxl,
    borderWidth: 1, borderColor: C.border,
    ...Shadow.card,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.petrolLight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: S.md,
  },
  avatarText: { fontSize: T.size.display - 2, fontWeight: T.weight.bold, color: C.petrolDeep },
  name: { fontSize: T.size.xl, fontWeight: T.weight.bold, color: C.ink },
  city: { fontSize: T.size.base, color: C.text3, marginTop: S.xs },
  badges: { flexDirection: 'row', gap: S.sm, marginTop: S.md },
  kycBadge: {
    backgroundColor: C.petrolLight,
    paddingHorizontal: S.md, paddingVertical: 5,
    borderRadius: R.xs + 2,
  },
  kycBadgeText: { fontSize: T.size.sm, fontWeight: T.weight.bold, color: C.petrol },
  trustBadge: {
    backgroundColor: C.bone2,
    paddingHorizontal: S.md, paddingVertical: 5,
    borderRadius: R.xs + 2,
  },
  trustBadgeText: { fontSize: T.size.sm, fontWeight: T.weight.semi, color: C.text2 },
  stats: { flexDirection: 'row', marginTop: S.xl, width: '100%', justifyContent: 'space-around' },
  stat: { alignItems: 'center' },
  statNum: { fontSize: T.size.lg + 1, fontWeight: T.weight.heavy, color: C.ink },
  statLabel: {
    fontSize: T.size.xs, color: C.text3, marginTop: 2,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  statDivider: { width: 1, backgroundColor: C.border, marginVertical: S.xs },
  sectionTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.ink,
    paddingHorizontal: S.lg,
    marginTop: S.sm, marginBottom: S.sm,
  },
  gridRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },
  empty: { alignItems: 'center', paddingTop: S.xxxl },
  emptyEmoji: { fontSize: T.size.display + 10, marginBottom: S.md },
  emptyText: { fontSize: T.size.sm + 1, color: C.text3 },
});
