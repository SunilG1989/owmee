import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, ActivityIndicator, useWindowDimensions, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S } from '../../utils/tokens';
import { Listings, type Listing } from '../../services/api';
import { ListingCard, calcCardWidth } from '../../components/listing/ListingCard';
import { BackButton } from '../../components/ui';
import { useLocation } from '../../hooks/useLocation';

export default function KidsSectionScreen({ navigation }: any) {
  const { width: sw } = useWindowDimensions();
  const cardWidth = useMemo(() => calcCardWidth(sw), [sw]);
  const { location } = useLocation();
  const [items, setItems] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await Listings.browse({
          kids_only: true,
          lat: location?.lat,
          lng: location?.lng,
          limit: 30,
        });
        setItems(r.data.listings || []);
      } catch {} finally { setLoading(false); }
    })();
  }, [location]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <View>
          <Text style={s.title}>🧸 Kids items</Text>
          <Text style={s.sub}>Verified sellers · Hygiene rated</Text>
        </View>
      </View>
      {loading ? (
        <ActivityIndicator color={C.petrol} style={s.loading} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          numColumns={2}
          columnWrapperStyle={s.colWrap}
          contentContainerStyle={s.listPadding}
          renderItem={({ item }) => (
            <ListingCard
              listing={item}
              onPress={l => navigation.navigate('ListingDetail', { listingId: l.id })}
              showDistance={!!location}
              cardWidth={cardWidth}
            />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyEmoji}>🧸</Text>
              <Text style={s.emptyText}>No kids items yet</Text>
            </View>
          }
          removeClippedSubviews
          maxToRenderPerBatch={6}
          windowSize={5}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  header: {
    paddingHorizontal: S.lg, paddingTop: S.sm, paddingBottom: S.md,
    flexDirection: 'row', alignItems: 'center', gap: S.md,
  },
  title: { fontSize: T.size.xxl - 2, fontWeight: T.weight.bold, color: C.text },
  sub: { fontSize: T.size.sm, color: C.text3, marginTop: 2 },
  loading: { marginTop: S.xxxl + S.sm },
  colWrap: { gap: S.sm, paddingHorizontal: S.lg },
  listPadding: { paddingBottom: S.xxxl * 3 },
  empty: { alignItems: 'center', paddingTop: S.xxxl + S.xl },
  emptyEmoji: { fontSize: T.size.display + 10, marginBottom: S.md },
  emptyText: { fontSize: T.size.sm + 1, color: C.text3 },
});
