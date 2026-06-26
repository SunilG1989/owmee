/**
 * HomeScreen — Sprint 8 / 2026-05-02 redesign
 *
 * Layout (top → bottom):
 *   1. Header: logo · centered location chip · notifications bell
 *   2. Search bar (taps into Search tab)
 *   3. Hero carousel — SafeTrade · Assist · Payment protected
 *   4. Category rail — Phones · Laptops · Books · Kids & Toys · Appliances
 *   5. "Trusted listings nearby" + Filter
 *   6. Horizontal catalog rows (single column, infinite scroll)
 *
 * Auth & gating:
 *   - Bell: AuthFlow if guest, else Notifications
 *   - Hero "Sell from home": AuthFlow if guest, else Sell tab
 *   - Card tap: ListingDetail (works for guests too)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl,
  ActivityIndicator, Alert, ScrollView, Image, type ImageSourcePropType,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop,
} from 'react-native-svg';
import {
  Bell, ChevronDown, ChevronRight, MapPin, Search,
  SlidersHorizontal,
} from 'lucide-react-native';
import { C, T, S, R, Shadow } from '../utils/tokens';
import type { TabScreen } from '../navigation/types';
import { Feed, Listings, Wishlist, type FeedListing } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLocation } from '../hooks/useLocation';
import HeroCard from '../components/HeroCard';
import CategoryRail, { type CategoryDef } from '../components/CategoryRail';
import { FeedCard } from '../components/OwmeeListingCard';
import OwmeeLogo from '../components/OwmeeLogo';
import { Button } from '../components/ui';
import { parseApiError } from '../utils/errors';
import { locationDisplayLabel } from '../utils/addressLocation';
import { afterInteractions } from '../utils/schedule';

const HOME_SECTION_GAP = S.sm;
const SEARCH_PREFETCH_SLUGS = ['smartphones', 'laptops', 'kids-utility', 'small-appliances'];

const RECENT_FALLBACK_IMAGES: Record<string, ImageSourcePropType> = {
  smartphones: require('../../assets/owmee/home/cat-mobile-photo-v2.png'),
  phones: require('../../assets/owmee/home/cat-mobile-photo-v2.png'),
  laptops: require('../../assets/owmee/home/cat-laptop-photo-v2.png'),
  'kids-utility': require('../../assets/owmee/home/cat-kids-photo-v2.png'),
  kids: require('../../assets/owmee/home/cat-kids-photo-v2.png'),
  'small-appliances': require('../../assets/owmee/home/cat-appliances-photo-v2.png'),
  appliances: require('../../assets/owmee/home/cat-appliances-photo-v2.png'),
  books: require('../../assets/owmee/home/cat-books-photo-v2.png'),
  others: require('../../assets/owmee/home/cat-books-photo-v2.png'),
};

function recentImageSource(item: FeedListing): ImageSourcePropType {
  const url = [...(item.image_urls || []), item.thumbnail_url]
    .find(u => !!u && u.startsWith('https://') && !/(localhost|127\.0\.0\.1|192\.168\.|10\.0\.|file:\/\/)/i.test(u));
  if (url) return { uri: url };
  return (item.category_slug && RECENT_FALLBACK_IMAGES[item.category_slug])
    ? RECENT_FALLBACK_IMAGES[item.category_slug]
    : RECENT_FALLBACK_IMAGES.smartphones;
}

function recentPostedLabel(iso?: string | null): string {
  if (!iso) return 'Recently listed';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Recently listed';
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return minutes <= 1 ? 'Just listed' : `Posted ${minutes}m ago`;
  }
  if (seconds < 86400) return `Posted ${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `Posted ${Math.floor(seconds / 86400)}d ago`;
  return 'Recently listed';
}

function recentDealSignal(item: FeedListing): string | null {
  const discountPct = item.discount_pct
    ?? (
      item.original_price != null && item.original_price > item.price
        ? Math.round((1 - item.price / item.original_price) * 100)
        : null
  );
  if (discountPct != null && discountPct >= 20) return 'Great deal';
  if (discountPct != null && discountPct >= 8) return 'Price dropped';
  return null;
}

export default function HomeScreen({ navigation }: TabScreen<'Home'>) {
  const { isAuthenticated } = useAuthStore();
  const { location } = useLocation();

  // Explore feed state
  const [feedItems, setFeedItems] = useState<FeedListing[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [currentRadius, setCurrentRadius] = useState<number>(15);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());

  const loadingMore = useRef(false);
  const listRef = useRef<FlatList<FeedListing>>(null);
  const listingsOffsetY = useRef<number>(0);

  const recentItems = useMemo(() => (
    [...feedItems]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 6)
  ), [feedItems]);

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
      setFeedError('Listings are taking longer to load. Pull down to try again.');
      setFeedItems([]);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || feedLoading || !hasMore) return;
    loadingMore.current = true;
    setIsLoadingMore(true);
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
      setIsLoadingMore(false);
    }
  }, [page, cursor, hasMore, feedLoading]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadFeed(true);
    setRefreshing(false);
  }, [loadFeed]);

  useEffect(() => {
    loadFeed(true);
  }, [loadFeed]);

  useEffect(() => {
    if (feedLoading) return undefined;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const cancelTask = afterInteractions(() => {
      SEARCH_PREFETCH_SLUGS.forEach((slug, index) => {
        timers.push(setTimeout(() => {
          const params: any = { category_slug: slug, limit: 30 };
          if (location) {
            params.lat = location.lat;
            params.lng = location.lng;
            params.radius_km = 50;
            params.city = location.city;
          }
          Listings.browse(params).catch(() => {});
        }, 220 * index));
      });
    });
    return () => {
      cancelTask();
      timers.forEach(clearTimeout);
    };
  }, [feedLoading, location]);

  useEffect(() => {
    if (!isAuthenticated) {
      setSavedIds(new Set());
      return;
    }
    let alive = true;
    Wishlist.list()
      .then(res => {
        if (!alive) return;
        const ids = (res.data?.wishlist || [])
          .map((item: any) => item?.listing_id)
          .filter(Boolean);
        setSavedIds(new Set(ids));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [isAuthenticated]);

  // Refetch when location changes after the user updates their saved address.
  const lastLocationKey = useRef<string>('');
  useEffect(() => {
    if (!location) return;
    const key = `${location.city}-${location.lat?.toFixed(2)}-${location.lng?.toFixed(2)}`;
    if (lastLocationKey.current && lastLocationKey.current !== key) {
      loadFeed(true);
    }
    lastLocationKey.current = key;
  }, [location, loadFeed]);

  const handleCardPress = useCallback((l: FeedListing) => {
    navigation.navigate('ListingDetail', { listingId: l.id, initialListing: l });
  }, [navigation]);

  const handleMakeOffer = useCallback((l: FeedListing) => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    navigation.navigate('ListingDetail', { listingId: l.id, openOffer: true, initialListing: l });
  }, [isAuthenticated, navigation]);

  const handleWishlistPress = useCallback(async (l: FeedListing) => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }

    const wasSaved = savedIds.has(l.id);
    setSavedIds(prev => {
      const next = new Set(prev);
      if (wasSaved) next.delete(l.id);
      else next.add(l.id);
      return next;
    });

    try {
      if (wasSaved) await Wishlist.remove(l.id);
      else await Wishlist.add(l.id);
    } catch (e: any) {
      setSavedIds(prev => {
        const next = new Set(prev);
        if (wasSaved) next.add(l.id);
        else next.delete(l.id);
        return next;
      });
      Alert.alert('Could not update saved item', parseApiError(e, 'Please try again.'));
    }
  }, [isAuthenticated, navigation, savedIds]);

  const handleSellPress = () => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    // Sprint 6a: phone OTP is sufficient to list. KYC is the badge, not a gate.
    (navigation as any).navigate('Sell');
  };

  const handleLocationPress = () => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    (navigation as any).navigate('AddressPicker', { returnTo: 'MainTabs' });
  };

  const handleNotifPress = () => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    navigation.navigate('Notifications');
  };

  const handleSearchPress = () => navigation.navigate('Search', { category_slug: undefined });
  const handleFilterPress = () => navigation.navigate('Search', { category_slug: undefined, openFilters: true });

  const handleCategoryPress = (cat: CategoryDef) => {
    if (cat.query) {
      navigation.navigate('Search', { query: cat.query });
      return;
    }
    if (!cat.slug) {
      navigation.navigate('Search');
      return;
    }
    navigation.navigate('Search', { category_slug: cat.slug });
  };

  const handleBrowsePress = () => {
    listRef.current?.scrollToOffset({
      offset: Math.max(0, listingsOffsetY.current - 12),
      animated: true,
    });
  };

  const feedKeyExtractor = useCallback((item: FeedListing) => item.id, []);

  const renderFeedItem = useCallback(({ item, index }: { item: FeedListing; index: number }) => (
    <FeedCard
      listing={item}
      variant="feed"
      index={index}
      onPress={() => handleCardPress(item)}
      onMakeOffer={() => handleMakeOffer(item)}
      onWishlist={() => handleWishlistPress(item)}
      isWishlisted={savedIds.has(item.id)}
    />
  ), [handleCardPress, handleMakeOffer, handleWishlistPress, savedIds]);

  // Location label — show the saved address area, not just the city, so
  // users can see that their updated address actually took effect.
  const locationLabel = useMemo(() => {
    if (!isAuthenticated) return 'Bengaluru';
    if (!location) return 'Set area';
    return location.locality || location.city || location.label || locationDisplayLabel(location, 'Set area');
  }, [isAuthenticated, location]);

  // ── Header section (rendered as ListHeaderComponent) ────────────────────
  const Header = useMemo(() => () => (
    <View>
      {/* Top bar — full wordmark + location + notifications. */}
      <View style={s.hdr}>
        <OwmeeLogo textSize={29} variant="home" />

        <TouchableOpacity
          onPress={handleLocationPress}
          activeOpacity={0.85}
          style={s.locChip}
          accessibilityRole="button"
          accessibilityLabel="Change location"
        >
          <MapPin size={15} strokeWidth={2.2} color={C.text2} />
          <Text style={s.locName} numberOfLines={1}>{locationLabel}</Text>
          <ChevronDown size={14} strokeWidth={2.2} color={C.text2} />
        </TouchableOpacity>

        <View style={s.hdrSpacer} />

        <View style={s.bellWrap}>
          <TouchableOpacity
            onPress={handleNotifPress}
            activeOpacity={0.76}
            style={s.bellBtn}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Bell size={22} strokeWidth={2.1} color={C.text} />
          </TouchableOpacity>
          <View style={s.bellDot} />
        </View>
      </View>

      {/* Search bar at the top — Ajio/Myntra pattern: search is the
          single most-used affordance, sits above the marketing hero. */}
      <View
        style={s.search}
      >
        <TouchableOpacity
          onPress={handleSearchPress}
          activeOpacity={0.8}
          style={s.searchMain}
          accessibilityRole="button"
          accessibilityLabel="Search items"
        >
          <Search size={21} strokeWidth={1.8} color={C.text} />
          <Text style={s.searchPh} numberOfLines={1}>
            Find trusted resale nearby
          </Text>
        </TouchableOpacity>
        <View style={s.searchDivider} />
        <TouchableOpacity
          onPress={handleFilterPress}
          activeOpacity={0.78}
          style={s.filterBtn}
          accessibilityRole="button"
          accessibilityLabel="Open filters"
        >
          <SlidersHorizontal size={20} strokeWidth={2} color={C.text} />
        </TouchableOpacity>
      </View>

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
        <View style={s.listingsTitleRow}>
          <Text style={s.sectionTitle}>Trusted listings nearby</Text>
          <View style={s.radiusHint}>
            <MapPin size={12} strokeWidth={2.2} color={C.petrolText} />
            <Text style={s.radiusText}>
              {currentRadius >= 500 ? 'Across state' : `Within ${currentRadius} km`}
            </Text>
          </View>
        </View>
        <TouchableOpacity activeOpacity={0.75} style={s.seeAllLink} onPress={handleSearchPress}>
          <Text style={s.seeAllText}>See all</Text>
          <ChevronRight size={14} strokeWidth={2.3} color={C.petrolText} />
        </TouchableOpacity>
      </View>
    </View>
  ), [locationLabel, currentRadius, isAuthenticated]);

  // ── Footer ─────────────────────────────────────────────────────────────
  const Footer = () => (
    <View>
      {!feedLoading && !feedError && recentItems.length > 0 && (
        <RecentListingsSection
          items={recentItems}
          onItemPress={handleCardPress}
          onSeeAll={handleSearchPress}
        />
      )}
      {isLoadingMore && (
        <View style={s.footerLoading}>
          <ActivityIndicator size="small" color={C.petrol} />
        </View>
      )}
      {!isLoadingMore && <View style={s.footerSpacer} />}
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
          <Text style={s.emptyTitle}>Could not load listings</Text>
          <Text style={s.emptySub}>{feedError}</Text>
          <Button
            label="Retry"
            variant="primary"
            size="sm"
            onPress={() => loadFeed(true)}
            style={s.emptyBtn}
          />
        </View>
      );
    }
    return (
      <View style={s.emptyWrap}>
        <Text style={s.emptyEmoji}>📦</Text>
        <Text style={s.emptyTitle}>No trusted items nearby yet</Text>
        <Text style={s.emptySub}>Try again later or change your location.</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <Svg pointerEvents="none" style={s.screenBg} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="homeCanvas" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F0D6C5" stopOpacity="1" />
            <Stop offset="0.34" stopColor={C.bone} stopOpacity="1" />
            <Stop offset="0.68" stopColor={C.surface} stopOpacity="1" />
            <Stop offset="1" stopColor="#DCEDE8" stopOpacity="1" />
          </LinearGradient>
          <LinearGradient id="warmRibbon" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.ctaSecondary} stopOpacity="0.16" />
            <Stop offset="0.58" stopColor="#F2D6C7" stopOpacity="0.08" />
            <Stop offset="1" stopColor="#F2D6C7" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="greenRibbon" x1="1" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.petrol} stopOpacity="0.12" />
            <Stop offset="0.72" stopColor={C.aqua} stopOpacity="0.06" />
            <Stop offset="1" stopColor={C.aqua} stopOpacity="0" />
          </LinearGradient>
          <RadialGradient id="tealGlow" cx="86%" cy="10%" r="58%">
            <Stop offset="0" stopColor={C.petrol} stopOpacity="0.13" />
            <Stop offset="1" stopColor={C.petrol} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="clayGlow" cx="4%" cy="28%" r="50%">
            <Stop offset="0" stopColor={C.ctaSecondary} stopOpacity="0.13" />
            <Stop offset="1" stopColor={C.ctaSecondary} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#homeCanvas)" />
        <Path
          d="M-14 8 C16 -2 36 4 58 13 C76 20 91 22 114 14 L114 0 L-14 0 Z"
          fill="url(#warmRibbon)"
        />
        <Path
          d="M106 52 C82 58 67 73 49 85 C29 98 12 102 -10 94 L-10 100 L106 100 Z"
          fill="url(#greenRibbon)"
        />
        <Circle cx="88" cy="10" r="47" fill="url(#tealGlow)" />
        <Circle cx="0" cy="31" r="38" fill="url(#clayGlow)" />
      </Svg>
      <FlatList
        ref={listRef}
        data={feedItems}
        keyExtractor={feedKeyExtractor}
        ListHeaderComponent={Header}
        ListFooterComponent={Footer}
        ListEmptyComponent={EmptyState}
        renderItem={renderFeedItem}
        extraData={savedIds}
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
        contentContainerStyle={s.listContent}
        // Virtualization: the feed can grow long; cap mounted rows so scroll
        // stays smooth (mirrors OffersScreen).
        removeClippedSubviews
        windowSize={5}
        maxToRenderPerBatch={8}
        initialNumToRender={6}
      />
    </SafeAreaView>
  );
}

function RecentListingsSection({
  items,
  onItemPress,
  onSeeAll,
}: {
  items: FeedListing[];
  onItemPress: (item: FeedListing) => void;
  onSeeAll: () => void;
}) {
  if (items.length === 0) return null;

  return (
    <View style={s.recentSection}>
      <View style={s.recentHead}>
        <View style={s.recentTitleBlock}>
          <Text style={s.recentTitle}>Fresh listings near you</Text>
          <Text style={s.recentSub}>Recently added items with safer delivery.</Text>
        </View>
        <TouchableOpacity activeOpacity={0.75} style={s.recentSeeAll} onPress={onSeeAll}>
          <Text style={s.recentSeeAllText}>See all</Text>
          <ChevronRight size={14} strokeWidth={2.3} color={C.petrolText} />
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.recentRow}
      >
        {items.map(item => {
          const signal = recentDealSignal(item);
          return (
            <TouchableOpacity
              key={`recent-${item.id}`}
              activeOpacity={0.86}
              style={s.recentCard}
              onPress={() => onItemPress(item)}
              accessibilityRole="button"
              accessibilityLabel={`Open recently listed ${item.title}`}
            >
              <View style={s.recentImageStage}>
                <Image
                  source={recentImageSource(item)}
                  style={s.recentImage}
                  resizeMode="contain"
                  resizeMethod="resize"
                />
              </View>
              <View style={s.recentCopy}>
                <Text style={s.recentCardTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={s.recentPrice} numberOfLines={1}>
                  ₹{Math.round(item.price).toLocaleString('en-IN')}
                  {signal ? ` · ${signal}` : ''}
                </Text>
                <Text style={s.recentTime} numberOfLines={1}>
                  {recentPostedLabel(item.created_at)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  screenBg: {
    ...StyleSheet.absoluteFillObject,
  },

  // ── Header ──────────────────────────────────────────────────────────
  listContent: {
    paddingBottom: S.xxxl,
  },

  // ── Header ──────────────────────────────────────────────────────────
  hdr: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingTop: S.sm,
    paddingBottom: S.xs + 2,
    backgroundColor: 'transparent',
    gap: S.sm,
  },
  hdrSpacer: { flex: 1 },
  locChip: {
    height: 31,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs + 2,
    paddingHorizontal: S.sm + 2,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.90)',
    flexShrink: 1,
    maxWidth: 158,
    ...Shadow.subtle,
  },
  locName: {
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.medium,
    color: C.text2,
    flexShrink: 1,
  },
  bellWrap: { position: 'relative' },
  bellBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.coral,
    borderWidth: 1,
    borderColor: C.bone2,
  },

  // ── Search ──────────────────────────────────────────────────────────
  search: {
    marginHorizontal: S.lg,
    marginTop: S.xs,
    height: 44,
    borderRadius: R.md,
    backgroundColor: 'rgba(255, 253, 248, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.90)',
    flexDirection: 'row',
    alignItems: 'center',
    ...Shadow.subtle,
  },
  searchMain: {
    flex: 1,
    height: '100%',
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingLeft: S.sm + 2,
  },
  searchPh: {
    flex: 1,
    fontSize: T.size.md,
    color: C.text2,
    fontWeight: T.weight.medium,
  },
  searchDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(224, 203, 188, 0.90)',
  },
  filterBtn: {
    width: 42,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopRightRadius: R.md,
    borderBottomRightRadius: R.md,
  },
  // ── Listings header ─────────────────────────────────────────────────
  listingsHdr: {
    marginTop: HOME_SECTION_GAP,
    paddingHorizontal: S.lg,
    paddingBottom: S.xs + 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },
  listingsTitleRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs + 2,
  },
  sectionTitle: {
    fontSize: T.size.base + 1,
    fontWeight: T.weight.heavy,
    color: C.text,
    letterSpacing: 0,
    flexShrink: 1,
  },
  radiusHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: S.xs + 1,
    paddingVertical: 2,
    borderRadius: R.pill,
    backgroundColor: 'rgba(241, 248, 246, 0.80)',
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.10)',
  },
  radiusText: {
    fontSize: T.size.xs,
    color: C.petrolText,
    fontWeight: T.weight.medium,
  },
  seeAllLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 24,
    paddingLeft: S.sm,
  },
  seeAllText: {
    fontSize: T.size.sm,
    color: C.petrolText,
    fontWeight: T.weight.medium,
  },

  // ── Recently listed ─────────────────────────────────────────────────
  recentSection: {
    marginTop: S.md,
    paddingBottom: S.md,
  },
  recentHead: {
    paddingHorizontal: S.lg,
    paddingBottom: S.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.md,
  },
  recentTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  recentTitle: {
    fontSize: T.size.base + 2,
    color: C.text,
    fontWeight: T.weight.heavy,
  },
  recentSub: {
    marginTop: 2,
    fontSize: T.size.xs,
    color: C.text3,
    fontWeight: T.weight.medium,
  },
  recentSeeAll: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: S.sm,
  },
  recentSeeAllText: {
    fontSize: T.size.sm,
    color: C.petrolText,
    fontWeight: T.weight.medium,
  },
  recentRow: {
    paddingHorizontal: S.md,
    gap: S.sm,
  },
  recentCard: {
    width: 154,
    minHeight: 194,
    borderRadius: R.md,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,253,248,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.68)',
    ...Shadow.subtle,
  },
  recentImageStage: {
    width: '100%',
    height: 112,
    padding: S.xs + 1,
    backgroundColor: '#FEFBF4',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(224, 203, 188, 0.42)',
  },
  recentImage: {
    width: '100%',
    height: '100%',
  },
  recentCopy: {
    paddingHorizontal: S.sm,
    paddingTop: S.xs + 2,
    paddingBottom: S.sm,
  },
  recentCardTitle: {
    minHeight: 32,
    fontSize: T.size.sm + 1,
    lineHeight: T.size.sm + 5,
    color: C.text,
    fontWeight: T.weight.heavy,
  },
  recentPrice: {
    marginTop: S.xs,
    fontSize: T.size.sm + 2,
    color: C.ink,
    fontWeight: T.weight.heavy,
  },
  recentTime: {
    marginTop: 2,
    fontSize: T.size.xs,
    color: C.text3,
    fontWeight: T.weight.medium,
  },

  // ── Footer / hints ──────────────────────────────────────────────────
  footerLoading: {
    paddingVertical: S.xl,
    alignItems: 'center',
  },
  footerSpacer: { height: S.xxxl },

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
  emptyBtn: {
    marginTop: S.lg,
    minWidth: 108,
  },
});
