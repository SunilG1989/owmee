/**
 * HomeScreen — Sprint 8 Phase 1 redesign
 *
 * Layout (top → bottom):
 *   1. Compact header: logo + location pill (tappable to re-pick) + bell
 *   2. Search bar
 *   3. Blockbuster deals strip (amber, hidden if <3 deals)
 *   4. Standalone sell block
 *   5. "Explore near you" section header with subtle radius hint
 *   6. Masonry feed (2 columns, varying card heights, infinite scroll)
 *
 * Data sources:
 *   - Feed.blockbusterDeals() on mount and on pull-to-refresh
 *   - Feed.explore(page, cursor) on mount, refresh, and end-reached
 *
 * Auth & gating:
 *   - Header bell: AuthFlow modal if guest, else Notifications
 *   - Sell block CTA: AuthFlow if guest, KycRequiredForAction if not verified, else CreateListing
 *   - Card tap: ListingDetail (works for guests too)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl,
  ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R } from '../utils/tokens';
import { C8 } from '../components/theme8';
import type { TabScreen } from '../navigation/types';
import { Feed, type FeedListing } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLocation } from '../hooks/useLocation';
import BlockbusterDealsStrip from '../components/BlockbusterDealsStrip';
import SellBlock from '../components/SellBlock';
import { FeedCard } from '../components/OwmeeListingCard';
import { pickAspectRatio } from '../components/theme8';

const PAGE_LIMIT = 20;

export default function HomeScreen({ navigation }: TabScreen<'Home'>) {
  const { isAuthenticated, kycStatus } = useAuthStore();
  const { location } = useLocation();
  const { width: sw } = useWindowDimensions();

  // Card width: account for outer padding (8) + gap between columns (6)
  const cardWidth = useMemo(() => Math.floor((sw - 8 * 2 - 6) / 2), [sw]);

  // Deals strip state
  const [deals, setDeals] = useState<FeedListing[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);

  // Explore feed state
  const [feedItems, setFeedItems] = useState<FeedListing[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [currentRadius, setCurrentRadius] = useState<number>(15);

  const loadingMore = useRef(false);

  const loadDeals = useCallback(async () => {
    setDealsLoading(true);
    try {
      const res = await Feed.blockbusterDeals();
      setDeals(res.data.items || []);
    } catch (e: any) {
      // SPRINT8_DEBUG
      const msg =
        e?.response?.status
          ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data || {}).slice(0, 200)}`
          : e?.message ? `JS: ${e.message}` : 'Unknown';
      console.warn('[HomeScreen.loadDeals]', msg, e);
      setDeals([]);
    } finally {
      setDealsLoading(false);
    }
  }, []);

  const loadFeed = useCallback(async (resetPage = false) => {
    if (resetPage) {
      setFeedLoading(true);
      setFeedError(null);
    }
    try {
      const res = await Feed.explore(0, null);
      const data = res.data;
      setFeedItems(data.items || []);
      setCursor(data.next_cursor);
      setPage(data.page);
      setHasMore(!!data.next_cursor);
      setCurrentRadius(data.current_radius_km);
    } catch (e: any) {
      // SPRINT8_DEBUG: surface the actual error so we can see what's failing
      const msg =
        e?.response?.status
          ? `HTTP ${e.response.status}: ${JSON.stringify(e.response.data || {}).slice(0, 200)}`
          : e?.message
            ? `JS error: ${e.message}`
            : `Unknown: ${JSON.stringify(e).slice(0, 200)}`;
      console.warn('[HomeScreen.loadFeed]', msg, e);
      setFeedError(msg);
      setFeedItems([]);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || !hasMore) return;
    loadingMore.current = true;
    try {
      const nextPage = page + 1;
      const res = await Feed.explore(nextPage, cursor);
      const data = res.data;
      setFeedItems(prev => [...prev, ...(data.items || [])]);
      setCursor(data.next_cursor);
      setPage(data.page);
      setHasMore(!!data.next_cursor);
      setCurrentRadius(data.current_radius_km);
    } catch {
      // Silent — user can pull to retry
    } finally {
      loadingMore.current = false;
    }
  }, [page, cursor, hasMore]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadDeals(), loadFeed(true)]);
    setRefreshing(false);
  }, [loadDeals, loadFeed]);

  useEffect(() => {
    loadDeals();
    loadFeed(true);
  }, [loadDeals, loadFeed]);

  // Refetch when location changes (after user picks a new one in LocationPickerScreen)
  const lastLocationKey = useRef<string>('');
  useEffect(() => {
    if (!location) return;
    const key = `${location.city}-${location.lat?.toFixed(2)}-${location.lng?.toFixed(2)}`;
    if (lastLocationKey.current && lastLocationKey.current !== key) {
      loadDeals();
      loadFeed(true);
    }
    lastLocationKey.current = key;
  }, [location, loadDeals, loadFeed]);

  const handleCardPress = (l: FeedListing) => {
    navigation.navigate('ListingDetail', { listingId: l.id });
  };

  const handleSellPress = () => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    if (kycStatus !== 'verified') {
      navigation.navigate('KycRequiredForAction', {
        actionLabel: 'List an item',
        returnTo: 'Home',
      });
      return;
    }
    // Verified — go to Sell tab
    (navigation as any).navigate('Sell');
  };

  const handleLocationPress = () => {
    // Re-entry to the location picker. Navigates to AuthFlow which is a
    // catch-all modal, but we want LocationPicker. Instead, push the
    // LocationPicker route name; if it exists in the stack it'll show,
    // otherwise the user can use the city picker fallback.
    (navigation as any).navigate('LocationPicker');
  };

  const handleNotifPress = () => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    navigation.navigate('Notifications');
  };

  // ── Header (rendered as ListHeaderComponent) ──────────────────────────────

  const Header = useMemo(() => () => (
    <View>
      {/* Top bar */}
      <View style={s.hdr}>
        <View style={s.hdrLeft}>
          <Text style={s.logo}>
            owm<Text style={{ color: C.honey }}>ee</Text>
          </Text>
          <TouchableOpacity onPress={handleLocationPress} style={s.locPill}>
            <Text style={s.locPin}>📍</Text>
            <Text style={s.locName} numberOfLines={1}>
              {location?.city || 'Set location'}
            </Text>
            <Text style={s.locArrow}>▾</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={handleNotifPress}>
          <Text style={s.bell}>🔔</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <TouchableOpacity
        style={s.search}
        onPress={() => navigation.navigate('Search')}
        activeOpacity={0.7}
      >
        <Text style={s.searchIcon}>🔍</Text>
        <Text style={s.searchPh}>Search anything…</Text>
        <Text style={s.searchMic}>🎤</Text>
      </TouchableOpacity>

      {/* Blockbuster deals strip */}
      <BlockbusterDealsStrip
        deals={deals}
        loading={dealsLoading}
        onDealPress={handleCardPress}
        onSeeAll={() => navigation.navigate('Search')}
      />

      {/* Sell block */}
      <SellBlock onPress={handleSellPress} />

      {/* Section header */}
      <View style={s.sectionHdr}>
        <View>
          <Text style={s.sectionTitle}>Explore near you</Text>
          <Text style={s.sectionSub}>
            {currentRadius >= 500
              ? 'Items from across your state'
              : `Items within ${currentRadius}km, plus great deals from nearby cities`}
          </Text>
        </View>
      </View>
    </View>
  ), [location, deals, dealsLoading, currentRadius, isAuthenticated, kycStatus]);

  // ── Footer (rendered as ListFooterComponent) ──────────────────────────────

  const Footer = () => {
    if (loadingMore.current) {
      return (
        <View style={s.footerLoading}>
          <ActivityIndicator size="small" color={C.honey} />
        </View>
      );
    }
    if (!hasMore && feedItems.length > 0) {
      return (
        <Text style={s.endHint}>
          ↑ that's everything for now — pull to refresh
        </Text>
      );
    }
    if (hasMore && feedItems.length > 0) {
      return (
        <Text style={s.endHint}>
          ↓ keep scrolling — fresh listings load as you go
        </Text>
      );
    }
    return <View style={{ height: 60 }} />;
  };

  // ── Empty / error states ──────────────────────────────────────────────────

  const EmptyState = () => {
    if (feedLoading) {
      return (
        <View style={s.emptyWrap}>
          <ActivityIndicator color={C.honey} />
        </View>
      );
    }
    if (feedError) {
      return (
        <View style={s.emptyWrap}>
          <Text style={s.emptyEmoji}>⚠️</Text>
          <Text style={s.emptyTitle}>Could not load</Text>
          <Text style={s.emptySub}>{feedError}</Text>
        </View>
      );
    }
    return (
      <View style={s.emptyWrap}>
        <Text style={s.emptyEmoji}>📦</Text>
        <Text style={s.emptyTitle}>No listings nearby yet</Text>
        <Text style={s.emptySub}>Be the first to list something in {location?.city || 'your city'}!</Text>
      </View>
    );
  };

  // ── Two-column masonry: split items into left/right columns ────────────────

  const { leftColumn, rightColumn } = useMemo(() => {
    const left: { item: FeedListing; idx: number }[] = [];
    const right: { item: FeedListing; idx: number }[] = [];
    feedItems.forEach((item, idx) => {
      // Distribute by index parity for stable layout. Better than tracking
      // column heights since aspect ratio is deterministic per index.
      if (idx % 2 === 0) left.push({ item, idx });
      else right.push({ item, idx });
    });
    return { leftColumn: left, rightColumn: right };
  }, [feedItems]);

  // ── Render the masonry feed inside FlatList using a single "row" approach.
  // We treat the entire two-column block as one FlatList "item" so infinite
  // scroll, header, footer, refresh control all work naturally.

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <FlatList
        data={[1]}  // Single placeholder — masonry is rendered inline
        keyExtractor={() => 'masonry'}
        ListHeaderComponent={Header}
        ListFooterComponent={Footer}
        renderItem={() => {
          if (feedItems.length === 0) return <EmptyState />;
          return (
            <View style={s.masonry}>
              <View style={s.masonryCol}>
                {leftColumn.map(({ item, idx }) => (
                  <FeedCard
                    key={item.id}
                    listing={item}
                    variant="feed"
                    cardWidth={cardWidth}
                    aspectRatio={pickAspectRatio(idx)}
                    index={idx}
                    onPress={() => handleCardPress(item)}
                  />
                ))}
              </View>
              <View style={s.masonryCol}>
                {rightColumn.map(({ item, idx }) => (
                  <FeedCard
                    key={item.id}
                    listing={item}
                    variant="feed"
                    cardWidth={cardWidth}
                    aspectRatio={pickAspectRatio(idx)}
                    index={idx}
                    onPress={() => handleCardPress(item)}
                  />
                ))}
              </View>
            </View>
          );
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.honey}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        showsVerticalScrollIndicator={false}
      />

      {/* Guest sign-in nudge (matches existing pattern) */}
      {!isAuthenticated && (
        <TouchableOpacity
          style={s.guestBar}
          onPress={() => navigation.navigate('AuthFlow')}
        >
          <Text style={s.guestText}>Sign in to make offers and transact</Text>
          <Text style={s.guestArrow}>→</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5f5f5' },

  // Header
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#fff',
  },
  hdrLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  logo: {
    fontSize: 20,
    fontWeight: '700',
    color: C.ink || C.text,
    letterSpacing: -0.5,
  },
  locPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  locPin: { fontSize: 12 },
  locName: {
    fontSize: 13,
    fontWeight: '500',
    color: C.ink || C.text,
    flex: 1,
  },
  locArrow: { fontSize: 11, color: C.text3 || '#999' },
  bell: { fontSize: 18 },

  // Search
  search: {
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchIcon: { fontSize: 14 },
  searchPh: {
    flex: 1,
    fontSize: 13,
    color: C.text4 || '#888',
  },
  searchMic: { fontSize: 14 },

  // Section header (between sell block and feed)
  sectionHdr: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: C.ink || C.text,
  },
  sectionSub: {
    fontSize: 11,
    color: C.text3 || '#888',
    marginTop: 2,
  },

  // Masonry grid
  masonry: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    gap: 6,
  },
  masonryCol: {
    flex: 1,
    gap: 6,
  },

  // Footer hint
  footerLoading: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  endHint: {
    textAlign: 'center',
    paddingVertical: 16,
    paddingBottom: 24,
    color: C.text4 || '#999',
    fontSize: 11,
  },

  // Empty / error
  emptyWrap: {
    paddingVertical: 60,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    color: C.text3 || '#888',
    textAlign: 'center',
    lineHeight: 18,
  },

  // Guest bar
  guestBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.ink || '#1a1a1a',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  guestText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '500',
  },
  guestArrow: { fontSize: 14, color: C.honey },
});
