import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton, Button, IconButton } from '../../components/ui';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, Shadow, formatPrice, timeAgo } from '../../utils/tokens';
import { Listings, type Listing } from '../../services/api';

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  draft:              { label: 'Draft',     color: C.text3,  bg: C.bone2        },
  pending_review:     { label: 'In review', color: C.yellow, bg: C.yellowLight  },
  pending_moderation: { label: 'In review', color: C.yellow, bg: C.yellowLight  },
  active:             { label: 'Active',    color: C.petrol, bg: C.petrolLight  },
  reserved:           { label: 'Reserved',  color: C.petrol, bg: C.petrolLight  },
  sold:               { label: 'Sold',      color: C.text4,  bg: C.bone2        },
  expired:            { label: 'Expired',   color: C.red,    bg: C.redLight     },
  removed:            { label: 'Removed',   color: C.text4,  bg: C.bone2        },
};

export default function MyListingsScreen({ navigation }: any) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await Listings.myListings();
      setListings(res.data?.listings || res.data || []);
    } catch (e: any) {
      const { parseApiError } = require('../../utils/errors');
      Alert.alert('Could not load listings', parseApiError(e));
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, []));

  const renderItem = ({ item }: { item: Listing }) => {
    const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
    const img = item.thumbnail_url || (item.image_urls || item.images)?.[0];
    return (
      <TouchableOpacity
        style={s.card}
        onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
        onLongPress={() => {
          if (item.status === 'active') {
            Alert.alert('Manage listing', 'What would you like to do?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete listing', style: 'destructive', onPress: async () => {
                Alert.alert('Delete?', 'This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: async () => {
                    try { await Listings.delete(item.id); load(); }
                    catch { Alert.alert('Error', 'Failed to delete listing'); }
                  }},
                ]);
              }},
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
        activeOpacity={0.85}
      >
        {img ? (
          <Image source={{ uri: img }} style={s.thumb} resizeMode="cover" />
        ) : (
          <View style={[s.thumb, s.noImg]}>
            <Text style={s.noImgIcon}>📦</Text>
          </View>
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
        <Text style={s.headerTitle}>My Listings</Text>
        <IconButton
          icon="+"
          onPress={() => navigation.navigate('Sell')}
          a11y="Create listing"
          variant="solid"
          size="sm"
        />
      </View>
      <FlatList
        data={listings}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.petrol} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>📦</Text>
            <Text style={s.emptyTitle}>No listings yet</Text>
            <Text style={s.emptySub}>Tap + to list your first item</Text>
            <Button
              label="Create listing"
              variant="primary"
              onPress={() => navigation.navigate('Sell')}
            />
          </View>
        }
        removeClippedSubviews maxToRenderPerBatch={8} windowSize={5}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  loading: { marginTop: S.xxxl + S.xxxl },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingVertical: S.sm + 2,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: T.size.lg - 1, fontWeight: T.weight.semi, color: C.text },

  list: { padding: S.lg },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: R.lg,
    padding: S.md, marginBottom: S.sm + 2,
    borderWidth: 1, borderColor: C.border,
    ...Shadow.card,
  },
  thumb: { width: 72, height: 72, borderRadius: R.sm },
  noImg: { backgroundColor: C.bone2, alignItems: 'center', justifyContent: 'center' },
  noImgIcon: { fontSize: T.size.xxl },
  info: { flex: 1, marginLeft: S.md },
  title: { fontSize: T.size.sm + 1, fontWeight: T.weight.semi, color: C.text, marginBottom: 2 },
  price: { fontSize: T.size.lg - 1, fontWeight: T.weight.bold, color: C.petrol, marginBottom: S.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  statusBadge: { paddingHorizontal: S.sm, paddingVertical: 2, borderRadius: R.xs },
  statusText: { fontSize: T.size.xs, fontWeight: T.weight.bold },
  views: { fontSize: T.size.xs, color: C.text3 },
  time: { fontSize: T.size.xs, color: C.text4 },
  arrow: { fontSize: T.size.xl, color: C.text4, marginLeft: S.xs },

  empty: { alignItems: 'center', paddingTop: S.xxxl + S.xxl },
  emptyEmoji: { fontSize: T.size.display + 18, marginBottom: S.lg },
  emptyTitle: { fontSize: T.size.lg + 1, fontWeight: T.weight.semi, color: C.text, marginBottom: S.xs },
  emptySub: { fontSize: T.size.base, color: C.text3, marginBottom: S.xl },
});
