/**
 * HomeScreen — Sprint 8 / 2026-05-02 redesign
 *
 * Layout (top → bottom):
 *   1. Header: logo · centered location chip · notifications bell
 *   2. Hero card (deep petrol) — story + trust flow + 2 CTAs
 *   3. Search bar (taps into Search tab)
 *   4. Trust chips (mint / blue / amber)
 *   5. Category rail — Mobiles · Laptops · Kids · Books · Home Appliances
 *   6. Sell banner
 *   7. "Verified deals near you" + Filter
 *   8. Masonry feed (2 columns, infinite scroll)
 *
 * Auth & gating:
 *   - Bell: AuthFlow if guest, else Notifications
 *   - Hero "Sell from home" + SellBlock CTA: AuthFlow if guest, else Sell tab
 *   - Card tap: ListingDetail (works for guests too)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl,
  ActivityIndicator, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R, Shadow, pickAspectRatio } from '../utils/tokens';
import { IconButton } from '../components/ui';
import type { TabScreen } from '../navigation/types';
import { Feed, type FeedListing } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLocation } from '../hooks/useLocation';
import HeroCard from '../components/HeroCard';
import CategoryRail, { type CategoryDef } from '../components/CategoryRail';
import SellBlock from '../components/SellBlock';
import { FeedCard } from '../components/OwmeeListingCard';

export default function HomeScreen({ navigation }: TabScreen<'Home'>) {
  const { isAuthenticated } = useAuthStore();
  const { location } = useLocation();
  const { width: sw } = useWindowDimensions();

  const cardWidth = useMemo(() => Math.floor((sw - S.sm * 2 - (S.xs + 2)) / 2), [sw]);

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
  const listRef = useRef<FlatList>(null);
  const listingsOffsetY = useRef<number>(0);

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
      setFeedItems(prev => {
        const seen = new Set(prev.map(i => i.id));
        const fresh = (data.items || []).filter(i => !seen.has(i.id));
        return [...prev, ...fresh];
      });
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
    await loadFeed(true);
    setRefreshing(false);
  }, [loadFeed]);

  useEffect(() => {
    loadFeed(true);
  }, [loadFeed]);

  // Refetch when location changes (after user picks a new one in LocationPickerScreen)
  const lastLocationKey = useRef<string>('');
  useEffect(() => {
    if (!location) return;
    const key = `${location.city}-${location.lat?.toFixed(2)}-${location.lng?.toFixed(2)}`;
    if (lastLocationKey.current && lastLocationKey.current !== key) {
      loadFeed(true);
    }
    lastLocationKey.current = key;
  }, [location, loadFeed]);

  const handleCardPress = (l: FeedListing) => {
    navigation.navigate('ListingDetail', { listingId: l.id });
  };

  const handleSellPress = () => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    // Sprint 6a: phone OTP is sufficient to list. KYC is the badge, not a gate.
    (navigation as any).navigate('Sell');
  };

  const handleLocationPress = () => {
    (navigation as any).navigate('LocationPicker');
  };

  const handleNotifPress = () => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    navigation.navigate('Notifications');
  };

  const handleSearchPress = () => navigation.navigate('Search');

  const handleCategoryPress = (cat: CategoryDef) => {
    if (!cat.slug) return; // Books — slug not yet in backend taxonomy
    navigation.navigate('Search', { category_slug: cat.slug });
  };

  const handleBrowsePress = () => {
    listRef.current?.scrollToOffset({
      offset: Math.max(0, listingsOffsetY.current - 12),
      animated: true,
    });
  };

  // Location label — fall back to "HSR Layout" per spec when no location set
  const locationLabel = useMemo(() => {
    if (location?.locality) return location.locality;
    if (location?.label) return location.label;
    if (location?.city) return location.city;
    return 'HSR Layout';
  }, [location]);

  // ── Header section (rendered as ListHeaderComponent) ────────────────────
  const Header = useMemo(() => () => (
    <View>
      {/* Top bar — logo + address (chip-next-to-logo) · bell right. */}
      <View style={s.hdr}>
        <Text style={s.logo}>
          <Text style={{ color: C.text }}>ow</Text>
          <Text style={{ color: C.coral }}>mee</Text>
        </Text>

        <TouchableOpacity
          onPress={handleLocationPress}
          activeOpacity={0.85}
          style={s.locChip}
        >
          <Text style={s.locPin} allowFontScaling={false}>📍</Text>
          <Text style={s.locName} numberOfLines={1}>{locationLabel}</Text>
          <Text style={s.locArrow} allowFontScaling={false}>▾</Text>
        </TouchableOpacity>

        <View style={s.hdrSpacer} />

        <View style={s.bellWrap}>
          <IconButton icon="🔔" onPress={handleNotifPress} a11y="Notifications" size="sm" />
          <View style={s.bellDot} />
        </View>
      </View>

      {/* Search bar at the top — Ajio/Myntra pattern: search is the
          single most-used affordance, sits above the marketing hero. */}
      <TouchableOpacity
        onPress={handleSearchPress}
        activeOpacity={0.8}
        style={s.search}
      >
        <Text style={s.searchIcon} allowFontScaling={false}>🔍</Text>
        <Text style={s.searchPh} numberOfLines={1}>
          Search iPhone, laptop, books, appliances...
        </Text>
        <Text style={s.searchMic} allowFontScaling={false}>🎤</Text>
      </TouchableOpacity>

      <HeroCard onBrowse={handleBrowsePress} onSell={handleSellPress} />

      <CategoryRail
        onSeeAll={handleSearchPress}
        onCategoryPress={handleCategoryPress}
      />

      {/* Listings header */}
      <View
        style={s.listingsHdr}
        onLayout={e => { listingsOffsetY.current = e.nativeEvent.layout.y; }}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.sectionTitle}>Verified deals near you</Text>
          <Text style={s.sectionSub}>
            {currentRadius >= 500
              ? 'Items from across your state'
              : `Trusted items available within ${currentRadius} km`}
          </Text>
        </View>
        {/* Filter is a placeholder — bottom-sheet sort/filter UI is a
            follow-up. Tapping does nothing today; do NOT route to Search
            (that surprised users in testing). */}
        <TouchableOpacity activeOpacity={0.85} style={s.filterBtn} onPress={() => { /* TODO: filter sheet */ }}>
          <Text style={s.filterIcon} allowFontScaling={false}>≡</Text>
          <Text style={s.filterText}>Filter</Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [locationLabel, currentRadius, isAuthenticated]);

  // ── Footer ─────────────────────────────────────────────────────────────
  // SellBlock lives below the feed: surface the "act as a seller" pitch
  // after the user has seen actual listings — never push listings off the
  // first viewport with marketing chrome.
  const Footer = () => (
    <View>
      {feedItems.length > 0 && <SellBlock onPress={handleSellPress} />}
      {loadingMore.current && (
        <View style={s.footerLoading}>
          <ActivityIndicator size="small" color={C.petrol} />
        </View>
      )}
      {!loadingMore.current && !hasMore && feedItems.length > 0 && (
        <Text style={s.endHint}>↑ that's everything for now — pull to refresh</Text>
      )}
      {!loadingMore.current && hasMore && feedItems.length > 0 && (
        <Text style={s.endHint}>↓ keep scrolling — fresh listings load as you go</Text>
      )}
      {feedItems.length === 0 && <View style={{ height: 60 }} />}
    </View>
  );

  // ── Empty / error states ───────────────────────────────────────────────
  const EmptyState = () => {
    if (feedLoading) {
      return (
        <View style={s.emptyWrap}>
          <ActivityIndicator color={C.petrol} />
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

  // ── Two-column masonry split ───────────────────────────────────────────
  const { leftColumn, rightColumn } = useMemo(() => {
    const left: { item: FeedListing; idx: number }[] = [];
    const right: { item: FeedListing; idx: number }[] = [];
    feedItems.forEach((item, idx) => {
      if (idx % 2 === 0) left.push({ item, idx });
      else right.push({ item, idx });
    });
    return { leftColumn: left, rightColumn: right };
  }, [feedItems]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <FlatList
        ref={listRef}
        data={[1]}
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
            tintColor={C.petrol}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        showsVerticalScrollIndicator={false}
      />

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

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },

  // ── Header ──────────────────────────────────────────────────────────
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingTop: S.sm,
    paddingBottom: S.sm,
    backgroundColor: C.bone,
    gap: S.sm + 2,
  },
  hdrSpacer: { flex: 1 },
  logo: {
    fontSize: T.size.xl + 4,
    fontWeight: T.weight.heavy,
    color: C.petrolNight,
    letterSpacing: -1,
  },
  locChip: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs + 1,
    paddingHorizontal: S.sm + 2,
    borderRadius: R.pill,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    maxWidth: 160,
    ...Shadow.subtle,
  },
  locPin: { fontSize: T.size.base },
  locName: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: C.text,
    flexShrink: 1,
  },
  locArrow: { fontSize: T.size.sm, color: C.text2 },
  bellWrap: { position: 'relative' },
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.red,
  },

  // ── Search ──────────────────────────────────────────────────────────
  search: {
    marginHorizontal: S.lg,
    marginTop: S.xs,
    marginBottom: S.xs,
    paddingHorizontal: S.md,
    height: 50,
    borderRadius: R.lg,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm + 2,
    ...Shadow.subtle,
  },
  searchIcon: { fontSize: T.size.md, color: C.text3 },
  searchPh: {
    flex: 1,
    fontSize: T.size.md - 1,
    color: C.text3,
    fontWeight: T.weight.medium,
  },
  searchMic: { fontSize: T.size.md, color: C.text3 },

  // ── Listings header ─────────────────────────────────────────────────
  listingsHdr: {
    marginTop: S.xl,
    paddingHorizontal: S.lg,
    paddingBottom: S.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sectionTitle: {
    fontSize: T.size.xl,
    fontWeight: T.weight.heavy,
    color: C.text,
    letterSpacing: -0.3,
  },
  sectionSub: {
    marginTop: 2,
    fontSize: T.size.base,
    color: C.text3,
    fontWeight: T.weight.medium,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs + 2,
    height: 38,
    paddingHorizontal: S.md,
    borderRadius: R.md,
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 4,
  },
  filterIcon: {
    fontSize: T.size.md,
    color: C.text,
    fontWeight: T.weight.heavy,
  },
  filterText: {
    fontSize: T.size.base,
    color: C.text,
    fontWeight: T.weight.heavy,
  },

  // ── Masonry grid ────────────────────────────────────────────────────
  masonry: {
    flexDirection: 'row',
    paddingHorizontal: S.sm,
    gap: S.xs + 2,
  },
  masonryCol: {
    flex: 1,
    gap: S.xs + 2,
  },

  // ── Footer / hints ──────────────────────────────────────────────────
  footerLoading: {
    paddingVertical: S.xl,
    alignItems: 'center',
  },
  endHint: {
    textAlign: 'center',
    paddingVertical: S.lg,
    paddingBottom: S.xxl,
    color: C.text4,
    fontSize: T.size.sm,
  },

  // ── Empty / error ───────────────────────────────────────────────────
  emptyWrap: {
    paddingVertical: S.xxxl + S.xxxl,
    alignItems: 'center',
    paddingHorizontal: S.xxxl,
  },
  emptyEmoji: { fontSize: T.size.display + 10, marginBottom: S.md },
  emptyTitle: {
    fontSize: T.size.lg,
    fontWeight: T.weight.semi,
    color: C.text,
    marginBottom: S.xs + 2,
  },
  emptySub: {
    fontSize: T.size.base,
    color: C.text3,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Guest bar ───────────────────────────────────────────────────────
  guestBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.xs + 2,
    backgroundColor: C.ink,
    paddingVertical: S.md + 2,
    paddingHorizontal: S.lg,
  },
  guestText: {
    fontSize: T.size.base,
    color: C.white,
    fontWeight: T.weight.medium,
  },
  guestArrow: { fontSize: T.size.sm + 1, color: C.coral },
});
