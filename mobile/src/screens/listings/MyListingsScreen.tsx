import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, Shadow, formatPrice, timeAgo } from '../../utils/tokens';
import { Listings, type Listing } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

// FIX BUG-09: Add pending_moderation to match backend publish status
const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: C.text3, bg: C.sand },
  pending_review: { label: 'In review', color: C.yellow, bg: C.yellowLight },
  pending_moderation: { label: 'In review', color: C.yellow, bg: C.yellowLight },
  active: { label: 'Active', color: C.forest, bg: C.forestLight },
  reserved: { label: 'Reserved', color: C.honey, bg: C.honeyLight },
  sold: { label: 'Sold', color: C.text4, bg: C.sand },
  expired: { label: 'Expired', color: C.red, bg: C.redLight },
  removed: { label: 'Removed', color: C.text4, bg: C.sand },
};

export default function MyListingsScreen({ navigation }: any) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      // FIX BUG-02 + BUG-03: Use dedicated my-listings endpoint (returns all statuses)
      const res = await Listings.myListings();
      setListings(res.data?.listings || res.data || []);
    } catch (e: any) {
      // Fix #39: Surface error instead of silent swallow
      const { parseApiError } = require('../../utils/errors');
      Alert.alert('Could not load listings', parseApiError(e));
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, []));

  const renderItem = ({ item }: { item: Listing }) => {
    const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
    const img = item.thumbnail_url || (item.image_urls || item.images)?.[0];
    return (
      <TouchableOpacity style={s.card} 
          onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
          onLongPress={() => {
            if (item.status === 'active') {
              Alert.alert('Manage listing', 'What would you like to do?', [
                { text: 'Cancel', style: 'cancel' },
                // FIX BUG-05: Remove "Pause listing" — no PATCH endpoint exists
                { text: 'Delete listing', style: 'destructive', onPress: async () => {
                  Alert.alert('Delete?', 'This cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: async () => {
                      try { await Listings.delete(item.id); load(); }
                      catch { Alert.alert('Error', 'Failed to delete listing'); }
                    }},
                  ]);
                }},
                // FIX BUG-04: Send correct values matching backend regex
                { text: 'Sold on Owmee', onPress: async () => {
                  try { await Listings.markSold(item.id, 'on_owmee'); load(); }
                  catch { Alert.alert('Error', 'Failed'); }
                }},
                { text: 'Sold elsewhere', onPress: async () => {
                  try { await Listings.markSold(item.id, 'elsewhere'); load(); }
                  catch { Alert.alert('Error', 'Failed'); }
                }},
              ]);
            }
          }}
          activeOpacity={0.85}>
        {img ? (
          <Image source={{ uri: img }} style={s.thumb} resizeMode={"cover"} />
        ) : (
          <View style={[s.thumb, s.noImg]}><Text style={{ fontSize: 24 }}>📦</Text></View>
        )}
        <View style={s.info}>
          <Text style={s.title} numberOfLines={2}>{item.title}</Text>
          <Text style={s.price}>{formatPrice(item.price)}</Text>
          <View style={s.metaRow}>
            <View style={[s.statusBadge, { backgroundColor: st.bg }]}>
              <Text style={[s.statusText, { color: st.color }]}>{st.label}</Text>
            </View>
            {item.view_count != null && <Text style={s.views}>{item.view_count} views</Text>}
            {item.created_at && <Text style={s.time}>{timeAgo(item.created_at)}</Text>}
          </View>
        </View>
        <Text style={s.arrow}>›</Text>
      </TouchableOpacity>
    );
  };

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={{ fontSize: 20, color: C.text2 }}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>My Listings</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Sell')}><Text style={{ fontSize: 24, color: C.honey }}>+</Text></TouchableOpacity>
      </View>
      <FlatList
        data={listings}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.honey} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>📦</Text>
            <Text style={s.emptyTitle}>No listings yet</Text>
            <Text style={s.emptySub}>Tap + to list your first item</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => navigation.navigate('Sell')}>
              <Text style={{ fontSize: 14, color: '#fff', fontWeight: '600' }}>Create listing</Text>
            </TouchableOpacity>
          </View>
        }
        removeClippedSubviews maxToRenderPerBatch={8} windowSize={5}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  list: { padding: 16 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: R.lg, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.border, ...Shadow.card },
  thumb: { width: 72, height: 72, borderRadius: R.sm },
  noImg: { backgroundColor: C.sand, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, marginLeft: 12 },
  title: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  price: { fontSize: 16, fontWeight: '700', color: C.honey, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: '700' },
  views: { fontSize: 10, color: C.text3 },
  time: { fontSize: 10, color: C.text4 },
  arrow: { fontSize: 20, color: C.text4, marginLeft: 4 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text, marginBottom: 4 },
  emptySub: { fontSize: 13, color: C.text3, marginBottom: 20 },
  emptyBtn: { backgroundColor: C.honey, borderRadius: R.sm, paddingHorizontal: 24, paddingVertical: 12 },
});
