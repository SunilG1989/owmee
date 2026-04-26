/**
 * OwmeeListingCard — Sprint 8 Phase 1
 *
 * Two variants:
 *   - feed: full card for the masonry explore feed (image + title + price + meta + Owmee Verified badge)
 *   - deal: compact card for the blockbuster deals strip (image + discount % + title + price + savings)
 *
 * Reads from the FeedListing type returned by /v1/feed/* endpoints.
 */
import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { C, T, S, R } from '../utils/tokens';
import { C8, pickCardBg } from './theme8';
import type { FeedListing } from '../services/api';

interface Props {
  listing: FeedListing;
  variant: 'deal' | 'feed';
  cardWidth?: number;
  aspectRatio?: number;
  index?: number;
  onPress: () => void;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return m <= 1 ? 'just now' : `${m}m ago`;
  }
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / (86400 * 7))}w ago`;
}

function formatPrice(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `₹${Math.round(n)}`;
}

function formatPriceFull(n: number | null | undefined): string {
  if (n == null) return '—';
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function firstImage(listing: FeedListing): string | null {
  if (listing.thumbnail_url) return listing.thumbnail_url;
  if (listing.image_urls && listing.image_urls.length > 0) return listing.image_urls[0];
  return null;
}

function fallbackEmojiForCategory(slug?: string | null): string {
  const map: Record<string, string> = {
    smartphones: '📱',
    laptops: '💻',
    'small-appliances': '🔌',
    'kids-utility': '🧸',
  };
  return slug ? (map[slug] || '🛍️') : '🛍️';
}

// ── DEAL VARIANT ─────────────────────────────────────────────────────────────

export function DealCard({ listing, onPress, index = 0 }: Props) {
  const img = firstImage(listing);
  const bg = pickCardBg(index);
  const emoji = fallbackEmojiForCategory(listing.category_slug);

  // Show city if it's not the user's local city (simple heuristic: distance > 50km or null)
  const showCity = listing.distance_km == null || listing.distance_km > 50;
  const distanceText = showCity
    ? listing.city || ''
    : listing.distance_km != null
      ? `${listing.distance_km.toFixed(1)}km`
      : '';

  const savingsAmount =
    listing.original_price != null && listing.original_price > listing.price
      ? listing.original_price - listing.price
      : null;

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={s.dealCard}>
      {listing.discount_pct != null && listing.discount_pct > 0 && (
        <View style={s.discountBadge}>
          <Text style={s.discountText}>−{Math.round(listing.discount_pct)}%</Text>
        </View>
      )}
      <View style={[s.dealImg, { backgroundColor: bg }]}>
        {img ? (
          <Image source={{ uri: img }} style={s.imgFill} resizeMode="cover" />
        ) : (
          <Text style={s.emojiFallback}>{emoji}</Text>
        )}
      </View>
      <View style={s.dealMeta}>
        <Text style={s.dealTitle} numberOfLines={1}>{listing.title}</Text>
        <View style={s.dealPriceRow}>
          <Text style={s.dealPrice}>{formatPriceFull(listing.price)}</Text>
          {listing.original_price != null && (
            <Text style={s.dealStrike}>{formatPrice(listing.original_price)}</Text>
          )}
        </View>
        {savingsAmount != null && (
          <Text style={s.dealSave}>
            Save {formatPrice(savingsAmount)}{distanceText ? ` · ${distanceText}` : ''}
          </Text>
        )}
        {savingsAmount == null && distanceText && (
          <Text style={s.dealSave}>{distanceText}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── FEED VARIANT (masonry) ───────────────────────────────────────────────────

export function FeedCard({ listing, onPress, cardWidth, aspectRatio = 1, index = 0 }: Props) {
  const img = firstImage(listing);
  const bg = pickCardBg(index);
  const emoji = fallbackEmojiForCategory(listing.category_slug);

  const meta = (() => {
    const parts: string[] = [];
    if (listing.seller_name) parts.push(listing.seller_name);
    if (listing.distance_km != null) {
      parts.push(`${listing.distance_km.toFixed(1)}km`);
    } else if (listing.shipping_eligible && listing.city) {
      // Out-of-local listing — show city instead of distance
      // handled separately below
    }
    const tAgo = timeAgo(listing.created_at);
    if (tAgo) parts.push(tAgo);
    return parts.join(' · ');
  })();

  const showShipping = listing.shipping_eligible && listing.distance_km == null;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[s.feedCard, cardWidth ? { width: cardWidth } : null]}
    >
      <View style={[s.feedImgWrap, { aspectRatio, backgroundColor: bg }]}>
        {img ? (
          <Image source={{ uri: img }} style={s.imgFill} resizeMode="cover" />
        ) : (
          <Text style={s.emojiFallback}>{emoji}</Text>
        )}
        {listing.is_owmee_verified && (
          <View style={s.verifiedBadge}>
            <Text style={s.verifiedText}>✓ Verified</Text>
          </View>
        )}
      </View>
      <View style={s.feedMeta}>
        <Text style={s.feedTitle} numberOfLines={1}>{listing.title}</Text>
        <Text style={s.feedPrice}>{formatPriceFull(listing.price)}</Text>
        {showShipping ? (
          <Text style={s.shipText}>📦 {listing.city || 'Other city'} · ships</Text>
        ) : (
          <Text style={s.feedMetaLine} numberOfLines={1}>{meta}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── DEFAULT EXPORT ───────────────────────────────────────────────────────────

export default function OwmeeListingCard(props: Props) {
  if (props.variant === 'deal') return <DealCard {...props} />;
  return <FeedCard {...props} />;
}

const s = StyleSheet.create({
  // shared
  imgFill: { width: '100%', height: '100%' },
  emojiFallback: { fontSize: 48 },

  // deal variant
  dealCard: {
    width: 152,
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(186,117,23,0.15)',
    marginRight: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  discountBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: C8.dealsBadgeBg,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 5,
    zIndex: 2,
  },
  discountText: {
    fontSize: 12,
    fontWeight: '700',
    color: C8.dealsBadgeText,
  },
  dealImg: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dealMeta: {
    padding: 10,
    paddingTop: 8,
  },
  dealTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: C.ink || C.text,
    marginBottom: 4,
  },
  dealPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginBottom: 4,
  },
  dealPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: C.ink || C.text,
  },
  dealStrike: {
    fontSize: 11,
    color: C.text3 || '#999',
    textDecorationLine: 'line-through',
  },
  dealSave: {
    fontSize: 11,
    fontWeight: '600',
    color: C8.dealsSubtitle,
  },

  // feed variant
  feedCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#eee',
    marginBottom: 6,
  },
  feedImgWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  verifiedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: C8.verifiedBg,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 2,
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: '600',
    color: C8.verifiedText,
  },
  feedMeta: {
    padding: 10,
    paddingTop: 8,
  },
  feedTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: C.ink || C.text,
    marginBottom: 4,
  },
  feedPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: C.ink || C.text,
    marginBottom: 4,
  },
  feedMetaLine: {
    fontSize: 10,
    color: C.text3 || '#888',
  },
  shipText: {
    fontSize: 10,
    fontWeight: '600',
    color: C8.shipText,
  },
});
