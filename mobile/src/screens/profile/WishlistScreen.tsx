import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '../../components/ui';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R } from '../../utils/tokens';
import { Wishlist, Listings, type Listing } from '../../services/api';
import { ListingCard, calcCardWidth } from '../../components/listing/ListingCard';
import { useAuthStore } from '../../store/authStore';
import { afterInteractions } from '../../utils/schedule';

export default function WishlistScreen({ navigation }: any) {
  const { width: sw } = useWindowDimensions();
  const cardWidth = useMemo(() => calcCardWidth(sw), [sw]);
  const { isAuthenticated } = useAuthStore();
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await Wishlist.list();
      const wishlist = res.data?.wishlist || [];
      const cardListings = wishlist
        .slice(0, 20)
        .map((w: any) => w?.listing)
        .filter(Boolean) as Listing[];

      if (cardListings.length === wishlist.length || cardListings.length >= 20) {
        setItems(cardListings);
        return;
      }

      // Backward compatibility for older API responses that only return ids.
      const missing = wishlist
        .slice(0, 20)
        .filter((w: any) => !w?.listing);
      const fetched = await Promise.all(
        missing.map(async (w: any) => {
          try { const r = await Listings.get(w.listing_id); return r.data; }
          catch { return null; }
        }),
      );
      setItems([...cardListings, ...(fetched.filter(Boolean) as Listing[])]);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => afterInteractions(load), [load]));

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
    navigation.navigate('ListingDetail', { listingId: listing.id, openOffer: true, initialListing: listing });
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color={C.petrol} style={s.loading} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Saved Items</Text>
        <View style={s.headerSpacer} />
      </View>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        numColumns={2}
        columnWrapperStyle={s.gridRow}
        contentContainerStyle={s.listPadding}
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            onPress={l => navigation.navigate('ListingDetail', { listingId: l.id, initialListing: l })}
            onBuySafely={openBuySafely}
            onMakeOffer={openMakeOffer}
            cardWidth={cardWidth}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.petrol} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>♡</Text>
            <Text style={s.emptyTitle}>No saved items</Text>
            <Text style={s.emptySub}>Tap ♡ on listings to save them here</Text>
          </View>
        }
        removeClippedSubviews maxToRenderPerBatch={6} windowSize={5}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  loading: { marginTop: S.xxxl + S.xxxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingVertical: S.sm + 2,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  headerTitle: { fontSize: T.size.lg - 1, fontWeight: T.weight.semi, color: C.text },
  headerSpacer: { width: 24 },
  gridRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },
  listPadding: { paddingBottom: S.xxxl * 3 },
  empty: { alignItems: 'center', paddingTop: S.xxxl + S.xxl },
  emptyEmoji: { fontSize: T.size.display + 18, marginBottom: S.lg },
  emptyTitle: { fontSize: T.size.lg + 1, fontWeight: T.weight.semi, color: C.text, marginBottom: S.xs },
  emptySub: { fontSize: T.size.base, color: C.text3 },
});
