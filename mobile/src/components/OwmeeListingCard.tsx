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
import {
  View, Text, StyleSheet, Image, TouchableOpacity, type ImageSourcePropType,
} from 'react-native';
import { Heart, MapPin, ShieldCheck } from 'lucide-react-native';
import { C, T, S, R, Home, pickCardBg } from '../utils/tokens';
import type { FeedListing } from '../services/api';

interface Props {
  listing: FeedListing;
  variant: 'deal' | 'feed';
  cardWidth?: number;
  aspectRatio?: number;
  index?: number;
  onPress: () => void;
  onBuySafely?: () => void;
  onMakeOffer?: () => void;
  onWishlist?: () => void;
  isWishlisted?: boolean;
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

function formatDistance(km: number | null | undefined): string | null {
  if (km == null) return null;
  if (km < 0.1) return 'Nearby';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

// Trust only fully-qualified https image URLs from a known image host —
// localhost/file/relative URLs render as half-loaded noise instead of
// triggering onError, so we skip them entirely.
const TRUSTED_IMAGE_HOST_RX = /^https:\/\/[^/]+\.(r2\.cloudflarestorage\.com|r2\.dev|amazonaws\.com|cloudfront\.net|imgix\.net|cdn\.[^/]+)/i;
const FALLBACK_IMAGES: Record<string, ImageSourcePropType> = {
  smartphones: require('../../assets/owmee/home/cat-mobile-photo-v2.png'),
  phones: require('../../assets/owmee/home/cat-mobile-photo-v2.png'),
  laptops: require('../../assets/owmee/home/cat-laptop-photo-v2.png'),
  'small-appliances': require('../../assets/owmee/home/cat-appliances-photo-v2.png'),
  appliances: require('../../assets/owmee/home/cat-appliances-photo-v2.png'),
  'kids-utility': require('../../assets/owmee/home/cat-kids-photo-v2.png'),
  kids: require('../../assets/owmee/home/cat-kids-photo-v2.png'),
  books: require('../../assets/owmee/home/cat-books-photo-v2.png'),
};

function isTrustedImageUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  if (!u.startsWith('https://')) return false;
  if (/(localhost|127\.0\.0\.1|192\.168\.|10\.0\.|file:\/\/)/i.test(u)) return false;
  return TRUSTED_IMAGE_HOST_RX.test(u);
}

function firstImage(listing: FeedListing): string | null {
  const candidates = [listing.thumbnail_url, ...(listing.image_urls || [])];
  for (const url of candidates) {
    if (isTrustedImageUrl(url || null)) return url as string;
  }
  return null;
}

function fallbackImageForCategory(slug?: string | null): ImageSourcePropType {
  return slug && FALLBACK_IMAGES[slug]
    ? FALLBACK_IMAGES[slug]
    : FALLBACK_IMAGES.smartphones;
}

// ── DEAL VARIANT ─────────────────────────────────────────────────────────────

export function DealCard({ listing, onPress, index = 0 }: Props) {
  const img = firstImage(listing);
  const bg = pickCardBg(index);
  const fallbackImage = fallbackImageForCategory(listing.category_slug);

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
          <Image source={fallbackImage} style={s.imgFill} resizeMode="cover" />
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

export function FeedCard({
  listing, onPress, onBuySafely, onMakeOffer, onWishlist, isWishlisted = false, cardWidth, index = 0,
}: Props) {
  const img = firstImage(listing);
  const bg = pickCardBg(index);
  const fallbackImage = fallbackImageForCategory(listing.category_slug);

  const distanceText = formatDistance(listing.distance_km);
  const placeText = listing.city || (listing.shipping_eligible ? 'Delivery available' : null);

  const showOriginal =
    listing.original_price != null && listing.original_price > listing.price;

  const showDiscount =
    listing.discount_pct != null && listing.discount_pct > 0;

  const postedAgo = timeAgo(listing.created_at);
  const metaLine = [distanceText, placeText].filter(Boolean).join(' · ') || postedAgo;
  const isVerified = Boolean(listing.is_owmee_verified);
  const trustChips = [
    listing.warranty_active ? 'Warranty' : null,
    listing.bill_available ? 'Bill' : null,
    listing.box_available ? 'Box' : null,
    listing.is_negotiable ? 'Offer ok' : null,
  ].filter(Boolean).slice(0, 2) as string[];

  const handleBuySafely = () => {
    (onBuySafely || onPress)();
  };
  const handleMakeOffer = () => {
    (onMakeOffer || onPress)();
  };

  return (
    <View style={[s.feedCard, cardWidth ? { width: cardWidth } : null]}>
      <View style={[s.feedImgWrap, { backgroundColor: bg }]}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onPress}
          style={s.imagePressTarget}
          accessibilityRole="button"
          accessibilityLabel={`Open ${listing.title}`}
        >
          {img ? (
            <Image source={{ uri: img }} style={s.imgFill} resizeMode="cover" />
          ) : (
            <Image source={fallbackImage} style={s.imgFill} resizeMode="cover" />
          )}
        </TouchableOpacity>

        <View style={[s.verifiedBadge, !isVerified && s.safeIconBadge]}>
          <ShieldCheck size={12} strokeWidth={2.35} color={C.petrolDeep} />
          {isVerified ? (
            <Text style={s.verifiedBadgeText} numberOfLines={1}>
              Verified
            </Text>
          ) : null}
        </View>

        {showDiscount && (
          <View style={s.imageDealBadge}>
            <Text style={s.imageDealText}>{Math.round(listing.discount_pct!)}% off</Text>
          </View>
        )}

        <TouchableOpacity
          activeOpacity={0.72}
          style={[s.heartBtn, isWishlisted && s.heartBtnActive]}
          onPress={onWishlist || onPress}
          accessibilityRole="button"
          accessibilityLabel={isWishlisted ? 'Remove from saved items' : 'Save item'}
          accessibilityState={{ selected: isWishlisted }}
        >
          <Heart
            size={19}
            strokeWidth={2.1}
            color={isWishlisted ? C.coralDeep : C.text}
            fill={isWishlisted ? C.coralLight : 'transparent'}
          />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        style={s.feedMeta}
        accessibilityRole="button"
        accessibilityLabel={`Open ${listing.title}`}
      >
        <View style={s.priceBlock}>
          <Text style={s.feedPrice}>{formatPriceFull(listing.price)}</Text>
          {showOriginal && (
            <Text style={s.feedStrike}>{formatPriceFull(listing.original_price)}</Text>
          )}
        </View>

        <Text style={s.feedTitle} numberOfLines={2}>{listing.title}</Text>

        {trustChips.length > 0 && (
          <View style={s.proofRow}>
            {trustChips.map(chip => (
              <View key={chip} style={s.proofChip}>
                <Text style={s.proofText} numberOfLines={1}>{chip}</Text>
              </View>
            ))}
          </View>
        )}

        {metaLine ? (
          <View style={s.metaRow}>
            <MapPin size={11} strokeWidth={2.25} color={C.text3} />
            <Text style={s.metaText} numberOfLines={1}>{metaLine}</Text>
          </View>
        ) : null}
      </TouchableOpacity>

      <View style={s.feedActionWrap}>
        <View style={s.feedActions}>
          <TouchableOpacity
            activeOpacity={0.84}
            onPress={handleBuySafely}
            style={s.buySafeBtn}
            accessibilityRole="button"
            accessibilityLabel={`Buy ${listing.title} safely`}
          >
            <View style={s.buySafeContent}>
              <ShieldCheck size={14} strokeWidth={2.4} color={C.white} />
              <Text style={s.buySafeText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
                Buy safely
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.84}
            onPress={handleMakeOffer}
            style={s.offerBtn}
            accessibilityRole="button"
            accessibilityLabel={`Make an offer for ${listing.title}`}
          >
            <Text style={s.offerText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
              Offer
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
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
  imagePressTarget: { ...StyleSheet.absoluteFillObject },
  // deal variant
  dealCard: {
    width: 152,
    backgroundColor: C.white,
    borderRadius: R.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(186,117,23,0.15)',
    marginRight: S.sm + 2,
    shadowColor: C.ink,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  discountBadge: {
    position: 'absolute',
    top: S.sm,
    left: S.sm,
    backgroundColor: Home.dealsBadgeBg,
    paddingHorizontal: S.sm + 1,
    paddingVertical: S.xs,
    borderRadius: R.xs - 1,
    zIndex: 2,
  },
  discountText: {
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    color: Home.dealsBadgeText,
  },
  dealImg: {
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dealMeta: {
    padding: S.sm + 2,
    paddingTop: S.sm,
  },
  dealTitle: {
    fontSize: T.size.base,
    fontWeight: T.weight.semi,
    color: C.ink,
    marginBottom: S.xs,
  },
  dealPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
    marginBottom: S.xs,
  },
  dealPrice: {
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.bold,
    color: C.ink,
  },
  dealStrike: {
    fontSize: T.size.sm,
    color: C.text3,
    textDecorationLine: 'line-through',
  },
  dealSave: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: Home.dealsSubtitle,
  },

  // feed variant
  feedCard: {
    backgroundColor: 'rgba(255,253,248,0.98)',
    borderRadius: R.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.72)',
    marginBottom: S.sm + 2,
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.045,
    shadowRadius: 7,
    elevation: 1,
  },
  feedImgWrap: {
    width: '100%',
    aspectRatio: 4 / 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  verifiedBadge: {
    position: 'absolute',
    top: S.xs + 2,
    left: S.xs + 2,
    paddingHorizontal: S.xs + 2,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    zIndex: 2,
  },
  safeIconBadge: {
    backgroundColor: 'rgba(246, 251, 250, 0.94)',
    width: 30,
    height: 30,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'center',
  },
  verifiedBadgeText: {
    color: C.petrolDeep,
    fontSize: T.size.xs - 1,
    fontWeight: T.weight.heavy,
  },
  imageDealBadge: {
    position: 'absolute',
    left: S.sm,
    bottom: S.sm,
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderRadius: R.pill,
    backgroundColor: 'rgba(251, 233, 226, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(215, 168, 158, 0.28)',
    zIndex: 2,
  },
  imageDealText: {
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
    color: C.coralDeep,
  },
  heartBtn: {
    position: 'absolute',
    top: S.xs + 2,
    right: S.xs + 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,253,248,0.90)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  heartBtnActive: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
  },
  feedMeta: {
    paddingHorizontal: S.sm + 2,
    paddingTop: S.sm,
    paddingBottom: 2,
  },
  feedTitle: {
    marginTop: 3,
    fontSize: T.size.sm + 1,
    lineHeight: 16,
    fontWeight: T.weight.semi,
    color: C.text2,
  },
  priceBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 5,
  },
  feedPrice: {
    fontSize: T.size.lg,
    fontWeight: T.weight.heavy,
    color: C.ink,
    letterSpacing: 0,
  },
  feedStrike: {
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
    color: C.text3,
    textDecorationLine: 'line-through',
  },
  proofRow: {
    marginTop: S.xs,
    flexDirection: 'row',
    gap: 4,
  },
  proofChip: {
    maxWidth: 68,
    paddingHorizontal: S.xs + 2,
    paddingVertical: 2,
    borderRadius: R.xs,
    backgroundColor: C.petrolLight,
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.12)',
  },
  proofText: {
    fontSize: T.size.xs - 1,
    color: C.petrolText,
    fontWeight: T.weight.medium,
  },
  metaRow: {
    marginTop: S.xs + 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    fontSize: T.size.xs,
    color: C.text3,
    fontWeight: T.weight.medium,
    flexShrink: 1,
  },
  feedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedActionWrap: {
    paddingHorizontal: S.sm + 2,
    paddingTop: S.xs,
    paddingBottom: S.sm,
  },
  buySafeBtn: {
    flex: 1.3,
    minWidth: 0,
    minHeight: 31,
    borderRadius: R.pill,
    backgroundColor: C.petrolDeep,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xs + 1,
    borderWidth: 1,
    borderColor: 'rgba(53, 95, 99, 0.16)',
  },
  buySafeContent: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: S.xs + 1,
  },
  buySafeText: {
    color: C.white,
    fontSize: T.size.xs + 1,
    fontWeight: T.weight.heavy,
  },
  offerBtn: {
    flex: 0.82,
    minWidth: 0,
    minHeight: 31,
    borderRadius: R.pill,
    backgroundColor: '#FFF8F3',
    borderWidth: 1,
    borderColor: 'rgba(110, 76, 69, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xs,
  },
  offerText: {
    color: C.coralDeep,
    fontSize: T.size.xs + 1,
    fontWeight: T.weight.heavy,
  },
});
