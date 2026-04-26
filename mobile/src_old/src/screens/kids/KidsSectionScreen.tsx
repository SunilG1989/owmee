/**
 * KidsSectionScreen
 * Warm orange accent, safety badges on every card.
 * India UX: parent-to-parent trust, age/completeness/hygiene mandatory.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Radius } from '../../utils/tokens';
import { Listings } from '../../services/api';
import type { Listing } from '../../services/api';
import type { AppStackParams as NavParams } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<NavParams>;

function KidsCard({ listing, onPress }: { listing: Listing; onPress: () => void }) {
  return (
    <TouchableOpacity style={sk.card} onPress={onPress} activeOpacity={0.8}>
      <View style={sk.imgBox}>
        <Text style={sk.imgEmoji}>🧸</Text>
      </View>
      <View style={sk.info}>
        <Text style={sk.price}>₹{parseInt(listing.price).toLocaleString('en-IN')}</Text>
        <Text style={sk.title} numberOfLines={1}>{listing.title}</Text>
        {/* Safety badges */}
        <View style={sk.badgeRow}>
          {listing.age_suitability && (
            <View style={sk.badge}><Text style={sk.badgeText}>Age {listing.age_suitability}</Text></View>
          )}
          {listing.accessories?.toLowerCase().includes('complete') && (
            <View style={[sk.badge, sk.badgeGreen]}><Text style={[sk.badgeText, sk.badgeTextGreen]}>✓ Complete</Text></View>
          )}
          {listing.hygiene_status && (
            <View style={[sk.badge, sk.badgeGreen]}><Text style={[sk.badgeText, sk.badgeTextGreen]}>✓ {listing.hygiene_status}</Text></View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function KidsSectionScreen() {
  const navigation = useNavigation<Nav>();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await Listings.browse({ kids_only: true, limit: 40 });
      setListings(res.data.listings);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={sk.safe}>
      {/* Kids header */}
      <View style={sk.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={sk.back}>←</Text>
        </TouchableOpacity>
        <Text style={sk.headerTitle}>owmee <Text style={sk.headerSub}>kids</Text></Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Hero */}
      <View style={sk.hero}>
        <Text style={sk.heroTitle}>Safe finds for little ones</Text>
        <Text style={sk.heroSub}>Every listing includes age suitability, completeness & hygiene disclosures</Text>
      </View>

      {/* Safety key */}
      <View style={sk.safetyKey}>
        <Text style={sk.safetyTitle}>what every listing tells you</Text>
        <View style={sk.safetyRow}>
          <View style={sk.badge}><Text style={sk.badgeText}>Age range</Text></View>
          <View style={[sk.badge, sk.badgeGreen]}><Text style={[sk.badgeText, sk.badgeTextGreen]}>✓ Complete</Text></View>
          <View style={[sk.badge, sk.badgeGreen]}><Text style={[sk.badgeText, sk.badgeTextGreen]}>✓ Cleaned</Text></View>
          <View style={sk.badgeWarn}><Text style={sk.badgeTextWarn}>! Missing part</Text></View>
        </View>
      </View>

      {/* Listings */}
      <FlatList
        data={listings}
        keyExtractor={item => item.id}
        numColumns={2}
        contentContainerStyle={sk.list}
        columnWrapperStyle={sk.row}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.kids} />}
        ListEmptyComponent={!loading ? (
          <View style={sk.empty}>
            <Text style={sk.emptyIcon}>🧸</Text>
            <Text style={sk.emptyTitle}>No kids listings nearby yet</Text>
            <Text style={sk.emptyText}>Be the first to list in your city</Text>
          </View>
        ) : null}
        renderItem={({ item }) => (
          <KidsCard
            listing={item}
            onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
          />
        )}
      />
    </SafeAreaView>
  );
}

const sk = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.kidsLight },
  header: { backgroundColor: Colors.kids, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  back: { fontSize: 22, color: 'rgba(255,255,255,0.8)', width: 32 },
  headerTitle: { fontSize: 16, fontWeight: '500', color: Colors.white },
  headerSub: { opacity: 0.7 },
  hero: { backgroundColor: Colors.kids, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl },
  heroTitle: { fontSize: 16, fontWeight: '500', color: Colors.white, marginBottom: 4 },
  heroSub: { fontSize: 11, color: 'rgba(255,255,255,0.75)', lineHeight: 17 },
  safetyKey: { backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,154,92,0.2)', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  safetyTitle: { fontSize: 9, fontWeight: '500', color: Colors.kids, textTransform: 'uppercase', letterSpacing: 0.08, marginBottom: Spacing.sm },
  safetyRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  list: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm, paddingBottom: 60 },
  row: { gap: Spacing.sm },
  card: { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.card, borderWidth: 0.5, borderColor: 'rgba(255,154,92,0.2)', overflow: 'hidden' },
  imgBox: { height: 100, backgroundColor: Colors.kidsLight, alignItems: 'center', justifyContent: 'center' },
  imgEmoji: { fontSize: 40 },
  info: { padding: Spacing.sm },
  price: { fontSize: 14, fontWeight: '500', color: Colors.text },
  title: { fontSize: 10, color: Colors.text3, marginTop: 2, marginBottom: 6 },
  badgeRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  badge: { backgroundColor: Colors.kidsLight, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 9, color: Colors.kids, fontWeight: '500' },
  badgeGreen: { backgroundColor: '#dcfce7' },
  badgeTextGreen: { color: '#16a34a' },
  badgeWarn: { backgroundColor: '#FFF8E1', borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  badgeTextWarn: { fontSize: 9, color: '#C65000', fontWeight: '500' },
  empty: { alignItems: 'center', paddingTop: 60, gap: Spacing.sm },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 15, fontWeight: '500', color: Colors.text },
  emptyText: { fontSize: 13, color: Colors.text3 },
});
