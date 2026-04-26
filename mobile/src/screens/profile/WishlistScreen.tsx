import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R } from '../../utils/tokens';
import { Wishlist, Listings, type Listing } from '../../services/api';
import { ListingCard, calcCardWidth } from '../../components/listing/ListingCard';

export default function WishlistScreen({ navigation }: any) {
  const { width: sw } = useWindowDimensions();
  const cardWidth = useMemo(() => calcCardWidth(sw), [sw]);
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await Wishlist.list();
      const wishlist = res.data?.wishlist || [];
      // Fetch listing details for each wishlisted item
      const listings = await Promise.all(
        wishlist.slice(0, 20).map(async (w: any) => {
          try { const r = await Listings.get(w.listing_id); return r.data; }
          catch { return null; }
        })
      );
      setItems(listings.filter(Boolean) as Listing[]);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, []));

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={{ fontSize: 20, color: C.text2 }}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Saved Items</Text>
        <View style={{ width: 24 }} />
      </View>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        numColumns={2}
        columnWrapperStyle={s.gridRow}
        contentContainerStyle={{ paddingBottom: 100 }}
        renderItem={({ item }) => (
          <ListingCard listing={item} onPress={l => navigation.navigate('ListingDetail', { listingId: l.id })} cardWidth={cardWidth} />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.honey} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>♡</Text>
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
  safe: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  gridRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text, marginBottom: 4 },
  emptySub: { fontSize: 13, color: C.text3 },
});
