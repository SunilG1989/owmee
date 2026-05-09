/**
 * HomeScreen — Sprint 8 / 2026-05-02 redesign
 *
 * Layout (top → bottom):
 *   1. Header: logo · centered location chip · notifications bell
 *   2. Hero carousel — SafeTrade · Assist · Payment protected
 *   3. Search bar (taps into Search tab)
 *   4. Trust chips (mint / blue / amber)
 *   5. Category rail — Mobiles · Laptops · Kids · Books · Home Appliances
 *   6. Sell banner
 *   7. "Trusted deals near you" + Filter
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
  ActivityIndicator, Alert, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Circle, Defs, LinearGradient, RadialGradient, Rect, Stop,
} from 'react-native-svg';
import {
  Bell, ChevronDown, ChevronRight, CreditCard, MapPin, Search,
  ShieldCheck, SlidersHorizontal, Truck,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { C, T, S, R, Shadow, pickAspectRatio } from '../utils/tokens';
import type { TabScreen } from '../navigation/types';
import { Feed, Wishlist, type FeedListing } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLocation } from '../hooks/useLocation';
import HeroCard from '../components/HeroCard';
import CategoryRail, { type CategoryDef } from '../components/CategoryRail';
import SellBlock from '../components/SellBlock';
import { FeedCard } from '../components/OwmeeListingCard';
import { parseApiError } from '../utils/errors';
import { locationDisplayLabel } from '../utils/addressLocation';

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
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());

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

  const handleCardPress = (l: FeedListing) => {
    navigation.navigate('ListingDetail', { listingId: l.id });
  };

  const handleBuySafely = (l: FeedListing) => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    navigation.navigate('Checkout', { listingId: l.id });
  };

  const handleMakeOffer = (l: FeedListing) => {
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    navigation.navigate('ListingDetail', { listingId: l.id, openOffer: true });
  };

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

  const handleSearchPress = () => navigation.navigate('Search');
  const handleFilterPress = () => navigation.navigate('Search', { openFilters: true });

  const handleCategoryPress = (cat: CategoryDef) => {
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

  // Location label — show the saved address area, not just the city, so
  // users can see that their updated address actually took effect.
  const locationLabel = useMemo(() => {
    return locationDisplayLabel(location, isAuthenticated ? 'Set location' : 'Bengaluru');
  }, [isAuthenticated, location]);

  // ── Header section (rendered as ListHeaderComponent) ────────────────────
  const Header = useMemo(() => () => (
    <View>
      {/* Top bar — logo + address (chip-next-to-logo) · bell right. */}
      <View style={s.hdr}>
        <Text style={s.logo}>
          <Text style={{ color: '#1A1F1F' }}>ow</Text>
          <Text style={{ color: '#BB684F' }}>mee</Text>
        </Text>

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
          <Search size={23} strokeWidth={1.8} color={C.text} />
          <Text style={s.searchPh} numberOfLines={1}>
            Search mobiles, laptops, furniture...
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
          <SlidersHorizontal size={21} strokeWidth={2} color={C.text} />
        </TouchableOpacity>
      </View>

      <View style={s.trustRow}>
        <TrustChip icon={ShieldCheck} label="Seller checked" />
        <TrustChip icon={CreditCard} label="Safe payment" />
        <TrustChip icon={Truck} label="Home handover" />
      </View>

      <HeroCard onBrowse={handleBrowsePress} onSell={handleSellPress} />

      <CategoryRail
        onSeeAll={handleSearchPress}
        onCategoryPress={handleCategoryPress}
      />

      <SellBlock onPress={handleSellPress} />

      {/* Listings header */}
      <View
        style={s.listingsHdr}
        onLayout={e => { listingsOffsetY.current = e.nativeEvent.layout.y; }}
      >
        <View style={s.listingsTitleBlock}>
          <Text style={s.sectionTitle}>Trusted deals near you</Text>
          <View style={s.radiusHint}>
            <MapPin size={15} strokeWidth={2.2} color={C.petrolText} />
            <Text style={s.radiusText}>
              {currentRadius >= 500 ? 'Across state' : `Within ${currentRadius} km`}
            </Text>
          </View>
        </View>
        <TouchableOpacity activeOpacity={0.75} style={s.seeAllLink} onPress={handleSearchPress}>
          <Text style={s.seeAllText}>See all</Text>
          <ChevronRight size={15} strokeWidth={2.3} color={C.petrolText} />
        </TouchableOpacity>
      </View>
    </View>
  ), [locationLabel, currentRadius, isAuthenticated]);

  // ── Footer ─────────────────────────────────────────────────────────────
  const Footer = () => (
    <View>
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
          <TouchableOpacity style={s.emptyBtn} onPress={() => loadFeed(true)} activeOpacity={0.8}>
            <Text style={s.emptyBtnText}>Retry</Text>
          </TouchableOpacity>
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
      <Svg pointerEvents="none" style={s.screenBg} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="homeCanvas" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F3E4D4" stopOpacity="1" />
            <Stop offset="0.42" stopColor="#FFF8EE" stopOpacity="1" />
            <Stop offset="1" stopColor="#EAF4F1" stopOpacity="1" />
          </LinearGradient>
          <RadialGradient id="tealGlow" cx="88%" cy="15%" r="58%">
            <Stop offset="0" stopColor="#2F766B" stopOpacity="0.16" />
            <Stop offset="1" stopColor="#2F766B" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="clayGlow" cx="5%" cy="42%" r="48%">
            <Stop offset="0" stopColor="#D29472" stopOpacity="0.16" />
            <Stop offset="1" stopColor="#D29472" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#homeCanvas)" />
        <Circle cx="90" cy="12" r="48" fill="url(#tealGlow)" />
        <Circle cx="2" cy="42" r="42" fill="url(#clayGlow)" />
      </Svg>
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
                    onBuySafely={() => handleBuySafely(item)}
                    onMakeOffer={() => handleMakeOffer(item)}
                    onWishlist={() => handleWishlistPress(item)}
                    isWishlisted={savedIds.has(item.id)}
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
                    onBuySafely={() => handleBuySafely(item)}
                    onMakeOffer={() => handleMakeOffer(item)}
                    onWishlist={() => handleWishlistPress(item)}
                    isWishlisted={savedIds.has(item.id)}
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
        contentContainerStyle={s.listContent}
      />
    </SafeAreaView>
  );
}

function TrustChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <View style={s.trustChip}>
      <View style={s.trustIcon}>
        <Icon size={13} strokeWidth={2.35} color="#2F766B" />
      </View>
      <Text style={s.trustText} numberOfLines={2}>{label}</Text>
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
    paddingBottom: S.sm,
    backgroundColor: 'transparent',
    gap: S.sm + 2,
  },
  hdrSpacer: { flex: 1 },
  logo: {
    fontSize: T.size.display + 1,
    fontWeight: T.weight.heavy,
    color: '#1A1F1F',
    letterSpacing: -0.6,
  },
  locChip: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs + 2,
    paddingHorizontal: S.md,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.90)',
    maxWidth: 144,
    ...Shadow.subtle,
  },
  locName: {
    fontSize: T.size.base,
    fontWeight: T.weight.medium,
    color: C.text2,
    flexShrink: 1,
  },
  bellWrap: { position: 'relative' },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    borderColor: '#F3E4D4',
  },

  // ── Search ──────────────────────────────────────────────────────────
  search: {
    marginHorizontal: S.lg,
    marginTop: S.xs,
    height: 52,
    borderRadius: R.xl - 1,
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
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
    gap: S.sm + 2,
    paddingLeft: S.md,
  },
  searchPh: {
    flex: 1,
    fontSize: T.size.base,
    color: '#68716F',
    fontWeight: T.weight.medium,
  },
  searchDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(224, 203, 188, 0.90)',
  },
  filterBtn: {
    width: 52,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopRightRadius: R.xl - 1,
    borderBottomRightRadius: R.xl - 1,
  },
  trustRow: {
    flexDirection: 'row',
    paddingHorizontal: S.lg,
    marginTop: S.sm + 2,
    gap: S.sm,
  },
  trustChip: {
    flex: 1,
    minHeight: 42,
    borderRadius: R.md + 1,
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.82)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.xs,
    paddingHorizontal: S.xs,
    paddingVertical: S.xs,
  },
  trustIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EEF8F5',
    borderWidth: 1,
    borderColor: 'rgba(47, 118, 107, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustText: {
    flexShrink: 1,
    color: '#205D58',
    fontSize: T.size.xs - 1,
    lineHeight: T.size.xs + 2,
    fontWeight: T.weight.medium,
    textAlign: 'center',
  },

  // ── Listings header ─────────────────────────────────────────────────
  listingsHdr: {
    marginTop: S.lg,
    paddingHorizontal: S.lg,
    paddingBottom: S.sm,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: S.md,
  },
  listingsTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    fontSize: T.size.lg,
    fontWeight: T.weight.heavy,
    color: C.text,
    letterSpacing: -0.3,
  },
  radiusHint: {
    marginTop: S.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
  },
  radiusText: {
    fontSize: T.size.base,
    color: C.petrolText,
    fontWeight: T.weight.medium,
  },
  seeAllLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 28,
    paddingLeft: S.sm,
  },
  seeAllText: {
    fontSize: T.size.base,
    color: C.petrolText,
    fontWeight: T.weight.medium,
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
    height: 40,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.petrol,
    paddingHorizontal: S.xl,
  },
  emptyBtnText: { color: C.white, fontSize: T.size.sm + 1, fontWeight: T.weight.semi },
});
