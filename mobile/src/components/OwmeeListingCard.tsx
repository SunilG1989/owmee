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
import { C, T, S, R, Shadow, Home, pickCardBg } from '../utils/tokens';
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

  const distanceText =
    listing.distance_km != null
      ? `${listing.distance_km.toFixed(1)} km`
      : listing.shipping_eligible && listing.city
        ? listing.city
        : null;

  const showOriginal =
    listing.original_price != null && listing.original_price > listing.price;

  const showDiscount =
    listing.discount_pct != null && listing.discount_pct > 0;

  // Detail line — pulled from the seller's description when present.
  // We don't fabricate specs we don't have; if the seller didn't write
  // one, the row hides.
  const detailLine = (() => {
    const d = listing.description?.trim();
    if (!d) return null;
    return d.replace(/\s+/g, ' ').slice(0, 60);
  })();
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

        {listing.is_owmee_verified && (
          <View style={s.verifiedBadge}>
            <ShieldCheck size={12} strokeWidth={2.35} color={C.coralDeep} />
            <Text style={s.verifiedBadgeText}>Verified</Text>
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
        <Text style={s.feedTitle} numberOfLines={1}>{listing.title}</Text>

        {detailLine && (
          <Text style={s.detailLine} numberOfLines={1}>{detailLine}</Text>
        )}

        <View style={s.priceBlock}>
          <Text style={s.feedPrice}>{formatPriceFull(listing.price)}</Text>
          {showOriginal && (
            <Text style={s.feedStrike}>{formatPriceFull(listing.original_price)}</Text>
          )}
          {showDiscount && (
            <View style={s.discountInline}>
              <Text style={s.discountInlineText}>{Math.round(listing.discount_pct!)}% off</Text>
            </View>
          )}
        </View>

        <View style={s.metaRow}>
          {distanceText && (
            <>
              <MapPin size={11} strokeWidth={2.25} color={C.text3} />
              <Text style={s.metaText} numberOfLines={1}>{distanceText}</Text>
            </>
          )}
          {distanceText && listing.city && (
            <Text style={s.metaSep} allowFontScaling={false}>·</Text>
          )}
          {listing.city && <Text style={s.metaText} numberOfLines={1}>{listing.city}</Text>}
        </View>
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
              Make offer
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
    backgroundColor: C.white,
    borderRadius: R.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border2,
    marginBottom: S.md,
    ...Shadow.card,
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
    top: S.sm,
    left: S.sm,
    paddingHorizontal: S.sm,
    paddingVertical: S.xs + 1,
    borderRadius: R.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
    zIndex: 2,
  },
  verifiedShield: {
    color: C.coralDeep,
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
  },
  verifiedBadgeText: {
    color: C.text,
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
  },
  heartBtn: {
    position: 'absolute',
    top: S.sm,
    right: S.sm,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.86)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  heartBtnActive: {
    backgroundColor: C.white,
    borderWidth: 1,
    borderColor: C.border,
  },
  heartGlyph: {
    fontSize: T.size.md,
    color: C.text,
    fontWeight: T.weight.bold,
  },
  feedMeta: {
    paddingHorizontal: S.md,
    paddingTop: S.md,
    paddingBottom: S.xs,
  },
  feedTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.heavy,
    color: C.ink,
  },
  priceBlock: {
    marginTop: S.sm,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: S.sm,
  },
  feedPrice: {
    fontSize: T.size.lg,
    fontWeight: T.weight.heavy,
    color: C.ink,
    letterSpacing: -0.2,
  },
  feedStrike: {
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    color: C.text3,
    textDecorationLine: 'line-through',
  },
  discountInline: {
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: C.coralLight,
  },
  discountInlineText: {
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
    color: C.coralDeep,
  },
  pillsRow: {
    marginTop: S.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.xs,
  },
  pill: {
    paddingHorizontal: S.xs + 2,
    paddingVertical: 2,
    borderRadius: R.xs,
  },
  pillGreen: { backgroundColor: C.greenLight },  // conditionBg #EEF8F0
  pillBlue:  { backgroundColor: C.blueSoft },
  pillAmber: { backgroundColor: C.amberSoft },
  pillText: {
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
    letterSpacing: 0.1,
  },
  pillTextGreen: { color: C.green },  // conditionText #2F6F46
  pillTextBlue:  { color: C.blueDeep },
  pillTextAmber: { color: C.amberDeep },
  detailLine: {
    marginTop: S.xs + 1,
    fontSize: T.size.sm,
    color: C.text2,
    fontWeight: T.weight.medium,
  },
  metaRow: {
    marginTop: S.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaPin: { fontSize: T.size.xs - 1, color: C.text3 },
  metaText: {
    fontSize: T.size.xs,
    color: C.text2,
    fontWeight: T.weight.semi,
  },
  metaSep: {
    fontSize: T.size.xs,
    color: C.text3,
    marginHorizontal: 1,
  },
  metaShield: {
    fontSize: T.size.xs,
    color: Home.verifiedDot,
    fontWeight: T.weight.heavy,
  },
  metaVerified: {
    fontSize: T.size.xs,
    color: Home.verifiedText,
    fontWeight: T.weight.semi,
  },
  feedActions: {
    gap: 7,
  },
  feedActionWrap: {
    paddingHorizontal: S.md,
    paddingTop: S.sm,
    paddingBottom: S.md,
  },
  buySafeBtn: {
    minHeight: 38,
    borderRadius: R.md,
    backgroundColor: C.petrol,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.sm,
    borderWidth: 1,
    borderColor: 'rgba(53, 95, 99, 0.16)',
    ...Shadow.subtle,
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
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.heavy,
  },
  offerBtn: {
    minHeight: 34,
    borderRadius: R.md,
    backgroundColor: '#FFF8F3',
    borderWidth: 1,
    borderColor: 'rgba(110, 76, 69, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.sm,
  },
  offerText: {
    color: C.coralDeep,
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.heavy,
  },
});
