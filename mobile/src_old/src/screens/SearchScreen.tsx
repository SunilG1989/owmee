/**
 * SearchScreen
 *
 * India UX requirements:
 * - Search must work fast on budget Androids (debounced, no keystroke-by-keystroke API calls)
 * - "No results" → show fallback city + "Be the first to list" CTA
 * - kids_only toggle prominent
 * - Saved search CTA on empty state
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, Radius, Typography } from '../utils/tokens';
import { Listings } from '../services/api';
import type { Listing } from '../services/api';
import { ListingCard } from '../components/listing/ListingCard';

const CONDITIONS = ['All', 'new', 'like_new', 'good', 'fair'];
const CONDITION_LABELS: Record<string, string> = {
  All: 'All', new: 'New', like_new: 'Like new', good: 'Good', fair: 'Fair',
};

export default function SearchScreen({ navigation }: any) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [kidsOnly, setKidsOnly] = useState(false);
  const [condition, setCondition] = useState('All');
  const debounceRef = useRef<any>(null);

  const doSearch = useCallback(async (q: string, cond: string, kids: boolean) => {
    if (q.trim().length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    setSearched(true);
    try {
      const res = await Listings.search(q.trim(), {
        condition: cond !== 'All' ? cond : undefined,
        kids_only: kids ? true : undefined,
        limit: 30,
      });
      setResults(res.data.listings || []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const onChangeText = (text: string) => {
    setQuery(text);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text, condition, kidsOnly), 500);
  };

  const onFilterChange = (cond: string, kids: boolean) => {
    setCondition(cond);
    setKidsOnly(kids);
    if (query.trim().length >= 2) doSearch(query, cond, kids);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Search input */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backIcon}>←</Text>
        </TouchableOpacity>
        <TextInput
          style={s.input}
          placeholder="search phones, laptops, toys..."
          placeholderTextColor={Colors.text4}
          value={query}
          onChangeText={onChangeText}
          autoFocus
          returnKeyType="search"
          onSubmitEditing={() => doSearch(query, condition, kidsOnly)}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults([]); setSearched(false); }}>
            <Text style={s.clearIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filters}
      >
        {/* Kids toggle */}
        <TouchableOpacity
          style={[s.chip, kidsOnly && s.chipKids]}
          onPress={() => onFilterChange(condition, !kidsOnly)}
        >
          <Text style={[s.chipText, kidsOnly && s.chipTextKids]}>🧸 Kids only</Text>
        </TouchableOpacity>
        {/* Condition chips */}
        {CONDITIONS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[s.chip, condition === c && s.chipActive]}
            onPress={() => onFilterChange(c, kidsOnly)}
          >
            <Text style={[s.chipText, condition === c && s.chipTextActive]}>
              {CONDITION_LABELS[c]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Results */}
      {loading && <ActivityIndicator color={Colors.teal} style={{ marginTop: 32 }} />}

      {!loading && searched && results.length === 0 && (
        <View style={s.empty}>
          <Text style={s.emptyEmoji}>🔍</Text>
          <Text style={s.emptyTitle}>Nothing found for "{query}"</Text>
          <Text style={s.emptySub}>
            Be the first to list this in your city — you'll get 10× more visibility.
          </Text>
          <TouchableOpacity
            style={s.emptyBtn}
            onPress={() => navigation.navigate('Sell')}
          >
            <Text style={s.emptyBtnText}>List it →</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.saveSearch}>
            <Text style={s.saveSearchText}>🔔  Alert me when "{query}" is listed</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !searched && (
        <View style={s.suggestions}>
          <Text style={s.suggestLabel}>Popular searches</Text>
          {['iPhone 13', 'MacBook Pro', 'Sony headphones', 'Kids bicycle', 'Mixer grinder'].map(s2 => (
            <TouchableOpacity key={s2} style={s.suggestRow} onPress={() => {
              setQuery(s2);
              doSearch(s2, condition, kidsOnly);
            }}>
              <Text style={s.suggestIcon}>⌕</Text>
              <Text style={s.suggestText}>{s2}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!loading && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={s.grid}
          columnWrapperStyle={s.row}
          renderItem={({ item }) => (
            <ListingCard
              listing={item}
              onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}
            />
          )}
          ListHeaderComponent={
            <Text style={s.count}>{results.length} result{results.length !== 1 ? 's' : ''}</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  back: { padding: 4 },
  backIcon: { fontSize: 18, color: Colors.text3 },
  input: {
    flex: 1, fontSize: Typography.size.md, color: Colors.text,
    paddingVertical: 0,
  },
  clearIcon: { fontSize: 14, color: Colors.text4, padding: 4 },
  filters: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.full, borderWidth: 0.5, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.tealLight, borderColor: Colors.teal },
  chipKids: { backgroundColor: Colors.kidsBg, borderColor: Colors.kids },
  chipText: { fontSize: Typography.size.sm, color: Colors.text2 },
  chipTextActive: { color: Colors.teal, fontWeight: '500' },
  chipTextKids: { color: Colors.kids, fontWeight: '500' },
  grid: { padding: Spacing.lg, gap: Spacing.sm },
  row: { gap: Spacing.sm },
  count: { fontSize: Typography.size.sm, color: Colors.text3, marginBottom: Spacing.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyEmoji: { fontSize: 40, marginBottom: 16 },
  emptyTitle: { fontSize: Typography.size.lg, fontWeight: '500', color: Colors.text, marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: Typography.size.base, color: Colors.text3, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn: {
    backgroundColor: Colors.teal, borderRadius: Radius.md,
    paddingHorizontal: 24, paddingVertical: 12, marginBottom: Spacing.md,
  },
  emptyBtnText: { color: Colors.white, fontWeight: '500', fontSize: Typography.size.md },
  saveSearch: {
    paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: Radius.md, borderWidth: 0.5, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  saveSearchText: { fontSize: Typography.size.sm, color: Colors.text3 },
  suggestions: { padding: Spacing.lg },
  suggestLabel: { fontSize: Typography.size.sm, color: Colors.text4, marginBottom: Spacing.sm, textTransform: 'uppercase', letterSpacing: 0.8 },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.border2 },
  suggestIcon: { fontSize: 16, color: Colors.text4 },
  suggestText: { fontSize: Typography.size.md, color: Colors.text2 },
});
