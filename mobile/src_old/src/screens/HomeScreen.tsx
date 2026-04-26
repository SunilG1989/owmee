/**
 * HomeScreen
 *
 * Structure (from design v3):
 * 1. Status bar + logo + notifications
 * 2. Search bar
 * 3. Category shortcuts
 * 4. Featured verified deal (ink/dark hero — B accent)
 * 5. Activity ticker ("12 verified listings today")
 * 6. Nearby listings grid
 *
 * India UX:
 * - Shows real activity immediately — "14 deals today"
 * - KYC verified dot on every card
 * - Kids category uses warm accent
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Dimensions, RefreshControl, StatusBar, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Radius, Shadow } from '../utils/tokens';
import { Listings, Notifications } from '../services/api';
import type { Listing, ActivityFeed, Category } from '../services/api';
import { ListingCard, SectionHeader, ActivityTicker, SkeletonCard } from '../components/listing/ListingCard';
import type { AppStackParams } from '../navigation/RootNavigator';

const { width } = Dimensions.get('window');

type Nav = NativeStackNavigationProp<AppStackParams>;

// ── Category config ───────────────────────────────────────────────────────────

const CATEGORIES = [
  { slug: 'smartphones', label: 'Phones', icon: '📱', warm: false },
  { slug: 'laptops-tablets', label: 'Laptops', icon: '💻', warm: false },
  { slug: 'audio', label: 'Audio', icon: '🎧', warm: false },
  { slug: 'kids-utility', label: 'Kids', icon: '🧸', warm: true },
  { slug: '__more', label: 'More', icon: '+', warm: false, isMore: true },
] as const;

// ── Hero card (B premium dark treatment) ─────────────────────────────────────

function HeroCard({ listing, onPress }: { listing: Listing; onPress: () => void }) {
  const price = parseFloat(listing.price).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return (
    <TouchableOpacity style={styles.hero} onPress={onPress} activeOpacity={0.9}>
      <View style={styles.heroText}>
        <Text style={styles.heroEyebrow}>verified deal</Text>
        <Text style={styles.heroTitle} numberOfLines={2}>{listing.title}</Text>
        <Text style={styles.heroMeta}>
          {listing.locality ?? listing.city} · {listing.condition === 'like_new' ? 'Like new' : listing.condition}
        </Text>
        <View style={styles.heroPrice}>
          <Text style={styles.heroPriceText}>₹{price}</Text>
          <Text style={styles.heroArrow}> →</Text>
        </View>
      </View>
      <Text style={styles.heroEmoji}>💻</Text>
    </TouchableOpacity>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();

  const [listings, setListings] = useState<Listing[]>([]);
  const [featuredListing, setFeaturedListing] = useState<Listing | null>(null);
  const [activity, setActivity] = useState<ActivityFeed | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [city] = useState('Bengaluru'); // TODO: from user location

  const load = useCallback(async () => {
    try {
      const [browseRes, activityRes, unreadRes] = await Promise.allSettled([
        Listings.browse({ city, limit: 10 }),
        Listings.activity(city),
        Notifications.unreadCount(),
      ]);

      if (browseRes.status === 'fulfilled') {
        const all = browseRes.value.data.listings;
        // Separate featured (first high-value verified item) from grid
        const featured = all.find(l => l.seller_verified && parseFloat(l.price) > 30000);
        setFeaturedListing(featured ?? null);
        setListings(all.filter(l => l !== featured).slice(0, 8));
      }
      if (activityRes.status === 'fulfilled') {
        setActivity(activityRes.value.data);
      }
      if (unreadRes.status === 'fulfilled') {
        setUnreadCount(unreadRes.value.data.unread_count);
      }
    } catch (e) {
      // Silent fail — show empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [city]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surface} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.teal} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>
            owm<Text style={styles.logoAccent}>ee</Text>
          </Text>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.notifBtn}
              onPress={() => {}}
              activeOpacity={0.7}
            >
              <Text style={styles.notifIcon}>🔔</Text>
              {unreadCount > 0 && (
                <View style={styles.notifDot}>
                  <Text style={styles.notifDotText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Search bar */}
        <TouchableOpacity
          style={styles.search}
          onPress={() => navigation.navigate('MainTabs', { screen: 'Search' } as any)}
          activeOpacity={0.8}
        >
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.searchPlaceholder}>search phones, laptops, kids items...</Text>
          <View style={styles.searchFilter}>
            <Text style={styles.searchFilterText}>⊟</Text>
          </View>
        </TouchableOpacity>

        {/* Categories */}
        <View style={styles.categories}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.slug}
              style={styles.catItem}
              onPress={() => {
                if (cat.slug === 'kids-utility') {
                  navigation.navigate('KidsSection');
                }
              }}
              activeOpacity={0.7}
            >
              <View style={[
                styles.catIcon,
                cat.warm && styles.catIconWarm,
                (cat as any).isMore && styles.catIconMore,
              ]}>
                <Text style={[styles.catEmoji, (cat as any).isMore && styles.catMoreText]}>
                  {cat.icon}
                </Text>
              </View>
              <Text style={[styles.catLabel, cat.warm && styles.catLabelWarm]}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Featured hero — only if we have a good listing */}
        {featuredListing && (
          <View style={styles.heroContainer}>
            <HeroCard
              listing={featuredListing}
              onPress={() => navigation.navigate('ListingDetail', { listingId: featuredListing.id })}
            />
          </View>
        )}

        {/* Activity ticker */}
        {activity && (
          <ActivityTicker
            deals={activity.ticker_deals}
            listings={activity.ticker_listings}
          />
        )}

        {/* Nearby listings */}
        <SectionHeader
          title={`Nearby · ${city}`}
          subtitle={activity ? `${activity.total_active_listings} verified listings` : undefined}
          onSeeAll={() => {}}
        />

        {loading ? (
          <View style={styles.grid}>
            {[1, 2, 3, 4].map(k => <SkeletonCard key={k} />)}
          </View>
        ) : listings.length === 0 ? (
          <EmptyState city={city} />
        ) : (
          <View style={styles.grid}>
            {listings.map(l => (
              <ListingCard
                key={l.id}
                listing={l}
                onPress={() => navigation.navigate('ListingDetail', { listingId: l.id })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Empty state — turns "no results" into an acquisition moment ───────────────

function EmptyState({ city }: { city: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>🏙️</Text>
      <Text style={styles.emptyTitle}>First listings in {city}?</Text>
      <Text style={styles.emptyText}>
        Be the first to list something here — you'll get 10× more visibility to all buyers.
      </Text>
      <TouchableOpacity style={styles.emptyBtn} activeOpacity={0.8}>
        <Text style={styles.emptyBtnText}>List something now →</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.surface,
  },
  scroll: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  content: {
    paddingBottom: Spacing.xxxl,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    backgroundColor: Colors.surface,
  },
  logo: {
    fontSize: 20,
    fontWeight: '500',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  logoAccent: {
    color: Colors.teal,
  },
  headerActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
  },
  notifBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderWidth: 0.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    backgroundColor: Colors.surface,
  },
  notifIcon: {
    fontSize: 15,
  },
  notifDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.warm,
    borderWidth: 1.5,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDotText: {
    fontSize: 5,
    color: Colors.white,
    fontWeight: '700',
  },

  // Search
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.screen,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
    backgroundColor: '#F5F5F3',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
  },
  searchIcon: {
    fontSize: 16,
    color: Colors.text4,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 13,
    color: Colors.text4,
  },
  searchFilter: {
    width: 24,
    height: 24,
    borderRadius: 7,
    backgroundColor: Colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchFilterText: {
    fontSize: 12,
    color: Colors.white,
    fontWeight: '600',
  },

  // Categories
  categories: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
    gap: 8,
    backgroundColor: Colors.surface,
  },
  catItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  catIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.tealLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(15,110,86,0.15)',
  },
  catIconWarm: {
    backgroundColor: Colors.kidsLight,
    borderColor: 'rgba(255,154,92,0.2)',
  },
  catIconMore: {
    backgroundColor: Colors.border2,
    borderColor: Colors.border,
  },
  catEmoji: {
    fontSize: 20,
  },
  catMoreText: {
    fontSize: 16,
    color: Colors.text3,
    fontWeight: '300',
  },
  catLabel: {
    fontSize: 9,
    color: Colors.text2,
    fontWeight: '500',
    textAlign: 'center',
  },
  catLabelWarm: {
    color: Colors.kids,
  },

  // Hero
  heroContainer: {
    paddingHorizontal: Spacing.screen,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  hero: {
    backgroundColor: Colors.ink,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    overflow: 'hidden',
  },
  heroText: {
    flex: 1,
  },
  heroEyebrow: {
    fontSize: 8,
    letterSpacing: 0.1,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 5,
  },
  heroTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.white,
    lineHeight: 19,
    marginBottom: 3,
  },
  heroMeta: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
  },
  heroPrice: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: Radius.full,
    paddingVertical: 5,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  heroPriceText: {
    fontSize: 11,
    color: Colors.white,
    fontWeight: '500',
  },
  heroArrow: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  heroEmoji: {
    fontSize: 38,
    opacity: 0.9,
  },

  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.screen,
    gap: Spacing.sm,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xxxl,
    paddingVertical: Spacing.xxxl,
    gap: Spacing.sm,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.text,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: Colors.text3,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyBtn: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.teal,
    borderRadius: Radius.full,
  },
  emptyBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.white,
  },
});
