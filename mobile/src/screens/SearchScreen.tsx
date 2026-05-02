import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View, Text, TextInput, StyleSheet, FlatList, Modal, ScrollView, Keyboard,
  useWindowDimensions, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R } from '../utils/tokens';
import { Button, Chip, IconButton } from '../components/ui';
import type { TabScreen } from '../navigation/types';
import { Listings, type BrowseParams, type Listing } from '../services/api';
import { useLocation } from '../hooks/useLocation';
import { ListingCard, SkeletonCard, calcCardWidth } from '../components/listing/ListingCard';

const CONDS = [
  { key: 'like_new', label: 'Like new' },
  { key: 'good',     label: 'Good' },
  { key: 'fair',     label: 'Fair' },
];
const SORTS = [
  { key: 'ranking',     label: 'Relevant' },
  { key: 'distance',    label: 'Nearest' },
  { key: 'price_asc',   label: 'Price ↑' },
  { key: 'price_desc',  label: 'Price ↓' },
  { key: 'newest',      label: 'Newest' },
];
const CATEGORIES = [
  { slug: 'smartphones',      label: 'Phones' },
  { slug: 'laptops',          label: 'Laptops' },
  { slug: 'tablets',          label: 'Tablets' },
  { slug: 'small-appliances', label: 'Appliances' },
  { slug: 'kids-utility',     label: 'Kids' },
];

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

  // Re-run the category-prefilled search when filters change too. Without
  // condition/sort in deps, changing those filters did nothing until the
  // user typed in the search box.
  useEffect(() => {
    if (initCat) doSearch('', condition, initCat, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initCat, condition, sort]);

  useEffect(() => {
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, []);

  const doSearch = async (q: string, cond: string, cat: string | null, sortBy: string) => {
    setLoading(true); setSearched(true);
    try {
      const p: BrowseParams = {
        condition: cond || undefined,
        category_slug: cat || undefined,
        sort: sortBy as any,
        min_price: minPrice ? parseFloat(minPrice) : undefined,
        max_price: maxPrice ? parseFloat(maxPrice) : undefined,
        limit: 30,
      };
      if (location) {
        p.lat = location.lat; p.lng = location.lng; p.radius_km = 50; p.city = location.city;
      }
      const res = q.trim().length >= 2 ? await Listings.search(q.trim(), p) : await Listings.browse(p);
      setResults(res.data.listings || []);
    } catch { setResults([]); }
    finally { setLoading(false); if (cat) Keyboard.dismiss(); }
  };

  const onText = (t: string) => {
    setQuery(t);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (t.trim().length >= 2) doSearch(t, condition, category, sort);
    }, 500);
  };

  const activeFilters =
    (condition ? 1 : 0) + (category ? 1 : 0) +
    (minPrice ? 1 : 0) + (maxPrice ? 1 : 0) +
    (sort !== 'ranking' ? 1 : 0);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.top}>
        <View style={s.searchRow}>
          <IconButton icon="←" onPress={() => navigation.goBack()} a11y="Back" size="sm" />
          <TextInput
            style={s.input}
            placeholder="Search phones, laptops, toys..."
            placeholderTextColor={C.text4}
            value={query}
            onChangeText={onText}
            autoFocus={!initCat}
            returnKeyType="search"
            onSubmitEditing={() => doSearch(query, condition, category, sort)}
          />
          {query.length > 0 && (
            <IconButton
              icon="✕"
              onPress={() => { setQuery(''); setResults([]); setSearched(false); }}
              a11y="Clear search"
              size="sm"
            />
          )}
          <View style={s.filterAnchor}>
            <IconButton icon="⊟" onPress={() => setShowFilters(true)} a11y="Open filters" size="sm" />
            {activeFilters > 0 && (
              <View style={s.filterBadge}>
                <Text style={s.filterBadgeText}>{activeFilters}</Text>
              </View>
            )}
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chips}
        >
          {CATEGORIES.map(c => (
            <Chip
              key={c.slug}
              label={c.label}
              selected={category === c.slug}
              onPress={() => {
                const n = category === c.slug ? null : c.slug;
                setCategory(n);
                doSearch(query, condition, n, sort);
              }}
            />
          ))}
          {CONDS.map(c => (
            <Chip
              key={c.key}
              label={c.label}
              selected={condition === c.key}
              onPress={() => {
                const n = condition === c.key ? '' : c.key;
                setCondition(n);
                doSearch(query, n, category, sort);
              }}
            />
          ))}
        </ScrollView>
      </View>

      <View style={s.statusBar}>
        <Text style={s.statusText}>
          {location ? `📍 ${location.city}` : '📍 All cities'}
          {searched ? ` · ${results.length} result${results.length !== 1 ? 's' : ''}` : ''}
        </Text>
        <TouchableOpacity onPress={() => setShowFilters(true)}>
          <Text style={s.sortLabel}>
            {SORTS.find(o => o.key === sort)?.label || 'Sort'} ▾
          </Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={s.skelRow}>
          <SkeletonCard cardWidth={cardWidth} />
          <SkeletonCard cardWidth={cardWidth} />
        </View>
      )}
      {!loading && searched && results.length === 0 && (
        <View style={s.empty}>
          <Text style={s.emptyEmoji}>🔍</Text>
          <Text style={s.emptyTitle}>
            {query ? `Nothing found for "${query}"` : 'No items match filters'}
          </Text>
        </View>
      )}
      {!loading && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={i => i.id}
          numColumns={2}
          columnWrapperStyle={s.gridRow}
          contentContainerStyle={s.gridPadding}
          renderItem={({ item }) => (
            <ListingCard
              listing={item}
              onPress={l => navigation.navigate('ListingDetail', { listingId: l.id })}
              showDistance={!!location}
              cardWidth={cardWidth}
            />
          )}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={6}
          windowSize={5}
          initialNumToRender={4}
        />
      )}

      <Modal visible={showFilters} animationType="slide" transparent>
        <View style={s.modalOv}>
          <View style={s.modalC}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Filters</Text>
              <IconButton
                icon="✕"
                onPress={() => setShowFilters(false)}
                a11y="Close filters"
                size="sm"
              />
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.fLabel}>Sort by</Text>
              {SORTS.map(o => (
                <TouchableOpacity key={o.key} style={s.radioRow} onPress={() => setSort(o.key)}>
                  <View style={[s.radio, sort === o.key && s.radioOn]}>
                    {sort === o.key && <View style={s.radioDot} />}
                  </View>
                  <Text style={s.radioLabel}>{o.label}</Text>
                </TouchableOpacity>
              ))}

              <Text style={[s.fLabel, s.fLabelSpaced]}>Price range</Text>
              <View style={s.priceRow}>
                <TextInput
                  style={s.priceInput}
                  placeholder="₹ Min"
                  placeholderTextColor={C.text4}
                  keyboardType="numeric"
                  value={minPrice}
                  onChangeText={setMinPrice}
                />
                <Text style={s.priceDash}>—</Text>
                <TextInput
                  style={s.priceInput}
                  placeholder="₹ Max"
                  placeholderTextColor={C.text4}
                  keyboardType="numeric"
                  value={maxPrice}
                  onChangeText={setMaxPrice}
                />
              </View>
            </ScrollView>

            <View style={s.modalActions}>
              <Button
                label="Clear all"
                variant="secondary"
                onPress={() => {
                  setCondition(''); setCategory(null); setSort('ranking');
                  setMinPrice(''); setMaxPrice('');
                }}
                style={s.clearBtn}
              />
              <Button
                label="Apply filters"
                variant="primary"
                onPress={() => {
                  setShowFilters(false);
                  doSearch(query, condition, category, sort);
                }}
                style={s.applyBtn}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  top: { backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.xl,
    paddingVertical: S.sm,
  },
  input: { flex: 1, fontSize: T.size.md, color: C.text, paddingVertical: 0 },

  // Filter anchor positions the badge over the IconButton.
  filterAnchor: { position: 'relative' },
  filterBadge: {
    position: 'absolute',
    top: -4, right: -4,
    width: 16, height: 16,
    borderRadius: 8,
    backgroundColor: C.petrol,
    alignItems: 'center', justifyContent: 'center',
  },
  filterBadgeText: { fontSize: T.size.xs, color: C.white, fontWeight: T.weight.bold },

  chips: {
    paddingHorizontal: S.xl,
    paddingVertical: S.sm,
    gap: S.xs + 2,
  },

  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: S.xl,
    paddingVertical: S.sm,
  },
  statusText: { fontSize: T.size.sm, color: C.text3 },
  sortLabel: { fontSize: T.size.sm, color: C.petrolDeep, fontWeight: T.weight.semi },

  gridRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },
  gridPadding: { paddingBottom: S.xxxl * 3 },
  skelRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xxxl },
  emptyEmoji: { fontSize: T.size.display, marginBottom: S.lg },
  emptyTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text, textAlign: 'center' },

  modalOv: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalC: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    padding: S.xl,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: S.lg,
  },
  modalTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text },

  fLabel: { fontSize: T.size.md, fontWeight: T.weight.semi, color: C.text, marginBottom: S.sm },
  fLabelSpaced: { marginTop: S.lg },

  radioRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: S.sm },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { borderColor: C.petrol },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.petrol },
  radioLabel: { fontSize: T.size.md, color: C.text },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  priceInput: {
    flex: 1,
    borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: S.md, paddingVertical: S.sm,
    fontSize: T.size.md, color: C.text,
  },
  priceDash: { color: C.text4 },

  modalActions: {
    flexDirection: 'row',
    gap: S.sm,
    marginTop: S.lg,
    borderTopWidth: 0.5, borderTopColor: C.border,
    paddingTop: S.lg,
  },
  clearBtn: { flex: 1 },
  applyBtn: { flex: 2 },
});
