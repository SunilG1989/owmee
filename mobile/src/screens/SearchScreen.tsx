import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ActivityIndicator, View, Text, TextInput, StyleSheet, FlatList, Modal, ScrollView, Keyboard,
  useWindowDimensions, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import {
  ArrowLeft, MapPin, SlidersHorizontal, Sparkles, X,
} from 'lucide-react-native';
import { C, T, S, R, Shadow } from '../utils/tokens';
import { Button, Chip, IconButton } from '../components/ui';
import type { TabScreen } from '../navigation/types';
import { Listings, type BrowseParams, type Listing } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLocation } from '../hooks/useLocation';
import { ListingCard, SkeletonCard, calcCardWidth, getCardLayout } from '../components/listing/ListingCard';
import { afterInteractions } from '../utils/schedule';

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
  { slug: 'smartphones',      label: 'Mobiles' },
  { slug: 'laptops',          label: 'Laptops' },
  { slug: 'tablets',          label: 'Tablets' },
  { slug: 'small-appliances', label: 'Appliances' },
  { slug: 'kids-utility',     label: 'Kids' },
  { slug: 'others',           label: 'Other' },
];

export default function SearchScreen({ navigation, route }: TabScreen<'Search'>) {
  const { location } = useLocation();
  const { isAuthenticated } = useAuthStore();
  const { width: sw } = useWindowDimensions();
  const cardWidth = useMemo(() => calcCardWidth(sw), [sw]);
  const initCat = route?.params?.category_slug || null;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(!!initCat);
  const [searched, setSearched] = useState(!!initCat);
  const [category, setCategory] = useState<string | null>(initCat);
  const [condition, setCondition] = useState('');
  const [sort, setSort] = useState('ranking');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const debounce = useRef<NodeJS.Timeout | null>(null);
  const activeRequest = useRef(0);
  const lastRouteCategory = useRef<string | null | undefined>(undefined);
  const skeletonItems = useMemo(() => Array.from({ length: 6 }, (_, i) => `skel-${i}`), []);

  useEffect(() => {
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, []);

  useEffect(() => {
    if (!route?.params?.openFilters) return;
    const frame = requestAnimationFrame(() => {
      setShowFilters(true);
      navigation.setParams({ openFilters: undefined });
    });
    return () => cancelAnimationFrame(frame);
  }, [navigation, route?.params?.openFilters]);

  const doSearch = useCallback(async (q: string, cond: string, cat: string | null, sortBy: string) => {
    const requestId = activeRequest.current + 1;
    activeRequest.current = requestId;
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
      if (requestId !== activeRequest.current) return;
      setResults(res.data.listings || []);
    } catch {
      if (requestId === activeRequest.current) setResults([]);
    } finally {
      if (requestId === activeRequest.current) {
        setLoading(false);
        if (cat) Keyboard.dismiss();
      }
    }
  }, [location, maxPrice, minPrice]);

  useEffect(() => {
    const routeCategory = route?.params?.category_slug || null;
    if (lastRouteCategory.current === routeCategory) return undefined;
    lastRouteCategory.current = routeCategory;
    if (!routeCategory) {
      setCategory(null);
      setLoading(false);
      setSearched(false);
      setResults([]);
      return undefined;
    }

    setCategory(routeCategory);
    setLoading(true);
    setSearched(true);
    return afterInteractions(() => doSearch('', condition, routeCategory, sort));
  }, [condition, doSearch, route?.params?.category_slug, sort]);

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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Svg pointerEvents="none" style={s.screenBg} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="searchCanvas" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFF8EE" stopOpacity="1" />
            <Stop offset="0.62" stopColor="#FFFDF8" stopOpacity="1" />
            <Stop offset="1" stopColor="#EAF4F1" stopOpacity="1" />
          </LinearGradient>
          <RadialGradient id="searchClay" cx="6%" cy="8%" r="52%">
            <Stop offset="0" stopColor="#D29472" stopOpacity="0.13" />
            <Stop offset="1" stopColor="#D29472" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="searchTeal" cx="94%" cy="38%" r="58%">
            <Stop offset="0" stopColor="#2F766B" stopOpacity="0.10" />
            <Stop offset="1" stopColor="#2F766B" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#searchCanvas)" />
        <Circle cx="4" cy="8" r="46" fill="url(#searchClay)" />
        <Circle cx="96" cy="38" r="48" fill="url(#searchTeal)" />
      </Svg>
      <View style={s.top}>
        <View style={s.searchRow}>
          <TouchableOpacity
            activeOpacity={0.76}
            onPress={() => navigation.goBack()}
            style={s.topIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ArrowLeft size={21} strokeWidth={2.2} color={C.text} />
          </TouchableOpacity>
          <TextInput
            style={s.input}
            placeholder="Search mobiles, laptops, toys..."
            placeholderTextColor={C.text4}
            value={query}
            onChangeText={onText}
            autoFocus={false}
            returnKeyType="search"
            onSubmitEditing={() => doSearch(query, condition, category, sort)}
          />
          {query.length > 0 && (
            <TouchableOpacity
              activeOpacity={0.76}
              onPress={() => { setQuery(''); setResults([]); setSearched(false); }}
              style={s.topIconBtn}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <X size={19} strokeWidth={2.2} color={C.text2} />
            </TouchableOpacity>
          )}
          <View style={s.filterAnchor}>
            <TouchableOpacity
              activeOpacity={0.76}
              onPress={() => setShowFilters(true)}
              style={s.topIconBtn}
              accessibilityRole="button"
              accessibilityLabel="Open filters"
            >
              <SlidersHorizontal size={20} strokeWidth={2.1} color={C.text} />
            </TouchableOpacity>
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
                requestAnimationFrame(() => doSearch(query, condition, n, sort));
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
                requestAnimationFrame(() => doSearch(query, n, category, sort));
              }}
            />
          ))}
        </ScrollView>
      </View>

      <View style={s.statusBar}>
        <View style={s.statusLocation}>
          <MapPin size={14} strokeWidth={2.2} color={C.petrolText} />
          <Text style={s.statusText}>
            {location ? location.city : 'All cities'}
            {searched ? ` · ${results.length} result${results.length !== 1 ? 's' : ''}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowFilters(true)}>
          <Text style={s.sortLabel}>
            {SORTS.find(o => o.key === sort)?.label || 'Sort'} ▾
          </Text>
        </TouchableOpacity>
      </View>

      <View style={s.resultsFrame}>
        {loading && results.length > 0 && (
          <View style={s.updatingPill} pointerEvents="none">
            <ActivityIndicator size="small" color={C.petrolDeep} />
            <Text style={s.updatingText}>Updating</Text>
          </View>
        )}
        {!loading && !searched && results.length === 0 && (
          <SearchStarter />
        )}
        {!loading && searched && results.length === 0 && (
          <View style={s.empty}>
            <View style={s.emptyIcon}>
              <Sparkles size={21} strokeWidth={2.1} color={C.petrol} />
            </View>
            <Text style={s.emptyTitle}>
              {query ? `Nothing found for "${query}"` : 'No items found'}
            </Text>
            <Text style={s.emptySub}>Try another category or clear filters.</Text>
          </View>
        )}
        {(loading && results.length === 0) || results.length > 0 ? (
          <FlatList
            data={loading && results.length === 0 ? skeletonItems : results}
            keyExtractor={(item: Listing | string) => typeof item === 'string' ? item : item.id}
            numColumns={2}
            columnWrapperStyle={s.gridRow}
            contentContainerStyle={s.gridPadding}
            getItemLayout={getCardLayout(sw)}
            renderItem={({ item }) => (
              typeof item === 'string' ? (
                <SkeletonCard cardWidth={cardWidth} />
              ) : (
                <ListingCard
                  listing={item}
                  onPress={l => navigation.navigate('ListingDetail', { listingId: l.id, initialListing: l })}
                  onBuySafely={openBuySafely}
                  onMakeOffer={openMakeOffer}
                  showDistance={!!location}
                  cardWidth={cardWidth}
                />
              )
            )}
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            maxToRenderPerBatch={6}
            windowSize={5}
            initialNumToRender={6}
          />
        ) : null}
      </View>

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

function SearchStarter() {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Sparkles size={21} strokeWidth={2.1} color={C.petrol} />
      </View>
      <Text style={s.emptyTitle}>Search trusted items near you</Text>
      <Text style={s.emptySub}>Mobiles, laptops, home items and kids products.</Text>
      <View style={s.emptyPills}>
        <Text style={s.emptyPill}>Seller checked</Text>
        <Text style={s.emptyPill}>Safe payment</Text>
        <Text style={s.emptyPill}>Home handover</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  screenBg: {
    ...StyleSheet.absoluteFillObject,
  },
  top: {
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(224, 203, 188, 0.82)',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.xl,
    paddingVertical: S.sm,
  },
  input: { flex: 1, fontSize: T.size.md, color: C.text, paddingVertical: 0 },
  topIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
    alignItems: 'center',
    paddingHorizontal: S.xl,
    paddingVertical: S.sm,
  },
  statusLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    flex: 1,
    minWidth: 0,
  },
  statusText: { fontSize: T.size.sm, color: C.text3 },
  sortLabel: { fontSize: T.size.sm, color: C.petrolDeep, fontWeight: T.weight.semi },

  resultsFrame: {
    flex: 1,
    minHeight: 420,
  },
  gridRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },
  gridPadding: { paddingBottom: S.xxxl * 3 },
  updatingPill: {
    position: 'absolute',
    top: S.xs,
    alignSelf: 'center',
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    paddingHorizontal: S.sm,
    paddingVertical: S.xs,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255,253,248,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.18)',
    ...Shadow.subtle,
  },
  updatingText: {
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
    color: C.petrolDeep,
  },

  empty: {
    margin: S.xl,
    marginTop: S.xxxl,
    paddingVertical: S.xxl,
    paddingHorizontal: S.lg,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.86)',
    backgroundColor: 'rgba(255,253,248,0.86)',
    alignItems: 'center',
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.petrolLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: S.md,
  },
  emptyTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text, textAlign: 'center' },
  emptySub: {
    marginTop: S.xs,
    fontSize: T.size.base,
    lineHeight: 20,
    color: C.text2,
    textAlign: 'center',
  },
  emptyPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: S.xs,
    marginTop: S.md,
  },
  emptyPill: {
    overflow: 'hidden',
    borderRadius: R.pill,
    backgroundColor: '#EEF8F5',
    color: C.petrolText,
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
    paddingHorizontal: S.sm,
    paddingVertical: S.xs,
  },

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
