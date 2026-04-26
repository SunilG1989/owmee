import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, FlatList, Modal, ScrollView, Keyboard, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { parseApiError } from '../utils/errors';
import { C, T, S, R, formatPrice } from '../utils/tokens';
import type { TabScreen } from '../navigation/types';
import { Listings, type BrowseParams, type Listing } from '../services/api';
import { useLocation } from '../hooks/useLocation';
import { ListingCard, SkeletonCard, calcCardWidth } from '../components/listing/ListingCard';

const CONDS = [{ key: 'like_new', label: 'Like new' }, { key: 'good', label: 'Good' }, { key: 'fair', label: 'Fair' }];
const SORTS = [{ key: 'ranking', label: 'Relevant' }, { key: 'distance', label: 'Nearest' }, { key: 'price_asc', label: 'Price ↑' }, { key: 'price_desc', label: 'Price ↓' }, { key: 'newest', label: 'Newest' }];
const SUBCATS: Record<string, string[]> = {
  smartphones: ['Apple', 'Samsung', 'OnePlus', 'Xiaomi', 'Vivo', 'Realme'],
  laptops: ['MacBook', 'Dell', 'HP', 'Lenovo', 'ASUS', 'Acer'],
  tablets: ['Apple iPad', 'Samsung Tab', 'Lenovo Tab', 'OnePlus Pad'],
  'small-appliances': ['Mixer', 'Iron', 'Air Purifier', 'Vacuum', 'Heater'],
  'kids-utility': ['Toys', 'Clothes', 'Books', 'Strollers', 'School bags'],
};
const CATEGORIES = [{ slug: 'smartphones', label: 'Phones' }, { slug: 'laptops', label: 'Laptops' }, { slug: 'tablets', label: 'Tablets' }, { slug: 'small-appliances', label: 'Appliances' }, { slug: 'kids-utility', label: 'Kids' }];

export default function SearchScreen({ navigation, route }: TabScreen<'Search'>) {
  const { location } = useLocation();
  const { width: sw } = useWindowDimensions();
  const cardWidth = useMemo(() => calcCardWidth(sw), [sw]);
  const initCat = route?.params?.category_slug || null;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [category, setCategory] = useState<string | null>(initCat);
  const [condition, setCondition] = useState('');
  const [sort, setSort] = useState('ranking');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const debounce = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { if (initCat) doSearch('', condition, initCat, sort); }, [initCat]);

  // T2-10: cleanup debounce on unmount
  useEffect(() => { return () => { if (debounce.current) clearTimeout(debounce.current); }; }, []);

  const doSearch = async (q: string, cond: string, cat: string | null, sortBy: string) => {
    setLoading(true); setSearched(true);
    try {
      const p: BrowseParams = { condition: cond || undefined, category_slug: cat || undefined, sort: sortBy as any, min_price: minPrice ? parseFloat(minPrice) : undefined, max_price: maxPrice ? parseFloat(maxPrice) : undefined, limit: 30 };
      if (location) { p.lat = location.lat; p.lng = location.lng; p.radius_km = 50; p.city = location.city; }
      const res = q.trim().length >= 2 ? await Listings.search(q.trim(), p) : await Listings.browse(p);
      setResults(res.data.listings || []);
    } catch { setResults([]); }
    finally { setLoading(false); if (cat) Keyboard.dismiss(); }
  };

  const onText = (t: string) => {
    setQuery(t);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { if (t.trim().length >= 2) doSearch(t, condition, category, sort); }, 500);
  };

  const activeFilters = (condition ? 1 : 0) + (category ? 1 : 0) + (minPrice ? 1 : 0) + (maxPrice ? 1 : 0) + (sort !== 'ranking' ? 1 : 0);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.top}>
        <View style={s.searchRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}><Text style={{ fontSize: 20, color: C.text2 }}>←</Text></TouchableOpacity>
          <TextInput style={s.input} placeholder="Search phones, laptops, toys..." placeholderTextColor={C.text4} value={query} onChangeText={onText} autoFocus={!initCat} returnKeyType="search" onSubmitEditing={() => doSearch(query, condition, category, sort)} />
          {query.length > 0 && <TouchableOpacity onPress={() => { setQuery(''); setResults([]); setSearched(false); }}><Text style={{ fontSize: 14, color: C.text4, padding: 4 }}>✕</Text></TouchableOpacity>}
          <TouchableOpacity style={s.filterBtn} onPress={() => setShowFilters(true)}>
            <Text style={{ fontSize: 18, color: C.text2 }}>⊟</Text>
            {activeFilters > 0 && <View style={s.filterBadge}><Text style={s.filterBadgeText}>{activeFilters}</Text></View>}
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {CATEGORIES.map(c => (
            <TouchableOpacity key={c.slug} style={[s.chip, category === c.slug && s.chipOn]} onPress={() => { const n = category === c.slug ? null : c.slug; setCategory(n); doSearch(query, condition, n, sort); }}>
              <Text style={[s.chipText, category === c.slug && s.chipTextOn]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
          {CONDS.map(c => (
            <TouchableOpacity key={c.key} style={[s.chip, condition === c.key && s.chipOn]} onPress={() => { const n = condition === c.key ? '' : c.key; setCondition(n); doSearch(query, n, category, sort); }}>
              <Text style={[s.chipText, condition === c.key && s.chipTextOn]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={s.statusBar}>
        <Text style={s.statusText}>{location ? `📍 ${location.city}` : '📍 All cities'}{searched ? ` · ${results.length} result${results.length !== 1 ? 's' : ''}` : ''}</Text>
        <TouchableOpacity onPress={() => setShowFilters(true)}><Text style={s.sortLabel}>{SORTS.find(o => o.key === sort)?.label || 'Sort'} ▾</Text></TouchableOpacity>
      </View>

      {loading && <View style={s.skelRow}><SkeletonCard cardWidth={cardWidth} /><SkeletonCard cardWidth={cardWidth} /></View>}
      {!loading && searched && results.length === 0 && (
        <View style={s.empty}><Text style={{ fontSize: 40, marginBottom: S.lg }}>🔍</Text>
          <Text style={s.emptyTitle}>{query ? `Nothing found for "${query}"` : 'No items match filters'}</Text></View>
      )}
      {!loading && results.length > 0 && (
        <FlatList data={results} keyExtractor={i => i.id} numColumns={2} columnWrapperStyle={s.gridRow} contentContainerStyle={{ paddingBottom: 100 }}
          renderItem={({ item }) => <ListingCard listing={item} onPress={l => navigation.navigate('ListingDetail', { listingId: l.id })} showDistance={!!location} cardWidth={cardWidth} />}
          showsVerticalScrollIndicator={false} removeClippedSubviews maxToRenderPerBatch={6} windowSize={5} initialNumToRender={4} />
      )}

      {/* Filter modal */}
      <Modal visible={showFilters} animationType="slide" transparent>
        <View style={s.modalOv}><View style={s.modalC}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.lg }}>
            <Text style={{ fontSize: T.size.lg, fontWeight: '600', color: C.text }}>Filters</Text>
            <TouchableOpacity onPress={() => setShowFilters(false)}><Text style={{ fontSize: 18, color: C.text3 }}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.fLabel}>Sort by</Text>
            {SORTS.map(o => (
              <TouchableOpacity key={o.key} style={s.radioRow} onPress={() => setSort(o.key)}>
                <View style={[s.radio, sort === o.key && s.radioOn]}>{sort === o.key && <View style={s.radioDot} />}</View>
                <Text style={{ fontSize: T.size.md, color: C.text }}>{o.label}</Text>
              </TouchableOpacity>
            ))}
            <Text style={[s.fLabel, { marginTop: S.lg }]}>Price range</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
              <TextInput style={s.priceInput} placeholder="₹ Min" placeholderTextColor={C.text4} keyboardType="numeric" value={minPrice} onChangeText={setMinPrice} />
              <Text style={{ color: C.text4 }}>—</Text>
              <TextInput style={s.priceInput} placeholder="₹ Max" placeholderTextColor={C.text4} keyboardType="numeric" value={maxPrice} onChangeText={setMaxPrice} />
            </View>
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.lg, borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: S.lg }}>
            <TouchableOpacity style={s.clearBtn} onPress={() => { setCondition(''); setCategory(null); setSort('ranking'); setMinPrice(''); setMaxPrice(''); }}>
              <Text style={{ fontSize: T.size.md, color: C.text2 }}>Clear all</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.applyBtn} onPress={() => { setShowFilters(false); doSearch(query, condition, category, sort); }}>
              <Text style={{ fontSize: T.size.md, color: '#fff', fontWeight: '600' }}>Apply filters</Text>
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  top: { backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingHorizontal: S.xl, paddingVertical: S.sm },
  input: { flex: 1, fontSize: T.size.md, color: C.text, paddingVertical: 0 },
  filterBtn: { padding: 4, position: 'relative' },
  filterBadge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: C.honey, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize:10, color: '#fff', fontWeight: '700' },
  chips: { paddingHorizontal: S.xl, paddingVertical: S.sm, gap: 6 },
  chip: { paddingHorizontal: S.md, paddingVertical: 6, borderRadius: R.pill, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  chipOn: { backgroundColor: C.honeyLight, borderColor: C.honey },
  chipText: { fontSize: T.size.sm, color: C.text2, fontWeight: '500' },
  chipTextOn: { color: C.honeyDeep, fontWeight: '600' },
  statusBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: S.xl, paddingVertical: S.sm },
  statusText: { fontSize: T.size.sm, color: C.text3 },
  sortLabel: { fontSize: T.size.sm, color: C.honeyDeep, fontWeight: '600' },
  gridRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },
  skelRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { fontSize: T.size.lg, fontWeight: '600', color: C.text, textAlign: 'center' },
  modalOv: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalC: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: S.xl, maxHeight: '80%' },
  fLabel: { fontSize: T.size.md, fontWeight: '600', color: C.text, marginBottom: S.sm },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 8 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: C.honey },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.honey },
  priceInput: { flex: 1, borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm, paddingHorizontal: S.md, paddingVertical: 8, fontSize: T.size.md, color: C.text },
  clearBtn: { flex: 1, paddingVertical: 12, borderRadius: R.sm, borderWidth: 0.5, borderColor: C.border, alignItems: 'center' },
  applyBtn: { flex: 2, paddingVertical: 12, borderRadius: R.sm, backgroundColor: C.honey, alignItems: 'center' },
});
