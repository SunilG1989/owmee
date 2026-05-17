/**
 * OwmeeListingCard — Sprint 8 Phase 1
 *
 * Two variants:
 *   - feed: horizontal catalog row with image + customer decision details
 *   - deal: compact card for the blockbuster deals strip (image + discount % + title + price + savings)
 *
 * Reads from the FeedListing type returned by /v1/feed/* endpoints.
 */
import React from 'react';
import {
  View, Text, StyleSheet, Image, TouchableOpacity, type ImageSourcePropType,
} from 'react-native';
import { Heart, MapPin, ShieldCheck, UserCheck } from 'lucide-react-native';
import { C, T, S, R, Home, pickCardBg } from '../utils/tokens';
import type { FeedListing } from '../services/api';
import { Button } from './ui';
import { buildListingFactChips } from '../utils/listingDisplay';

interface Props {
  listing: FeedListing;
  variant: 'deal' | 'feed';
  index?: number;
  onPress: () => void;
  onMakeOffer?: () => void;
  onWishlist?: () => void;
  isWishlisted?: boolean;
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
  others: require('../../assets/owmee/home/cat-books-photo-v2.png'),
};

function isTrustedImageUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  if (!u.startsWith('https://')) return false;
  if (/(localhost|127\.0\.0\.1|192\.168\.|10\.0\.|file:\/\/)/i.test(u)) return false;
  return TRUSTED_IMAGE_HOST_RX.test(u);
}

function firstImage(listing: FeedListing): string | null {
  const candidates = [...(listing.image_urls || []), listing.thumbnail_url];
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

const TITLE_COLORS = [
  'black', 'blue', 'brown', 'cream', 'gold', 'green', 'grey', 'gray', 'orange',
  'pink', 'purple', 'red', 'silver', 'white', 'yellow', 'space grey', 'space gray',
];

function titleCaseWords(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map(word => {
      if (/^[A-Z0-9]+$/.test(word) && word.length <= 4) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function cleanListingTitle(title: string): string {
  let cleaned = title
    .replace(/[_-]+/g, ' ')
    .replace(/\b(pre owned|preowned|used|excellent condition|good condition)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\bkids?\b/i.test(cleaned) && /\bwater\s+bottle\b/i.test(cleaned)) {
    cleaned = cleaned
      .replace(/\bsmash\b/gi, '')
      .replace(/\bkids?\s+water\s+bottle\b/gi, 'Kids Water Bottle')
      .replace(/\s+/g, ' ')
      .trim();
  }

  cleaned = titleCaseWords(cleaned || title);
  const lower = cleaned.toLowerCase();
  const color = TITLE_COLORS
    .sort((a, b) => b.length - a.length)
    .find(c => lower.endsWith(` ${c}`));

  if (!color) return cleaned;
  const base = cleaned.slice(0, cleaned.length - color.length).trim();
  const colorLabel = titleCaseWords(color.replace('gray', 'grey'));
  return base ? `${base} • ${colorLabel}` : cleaned;
}

function conditionTagLabel(condition?: string | null): string {
  const value = (condition || '').toLowerCase().trim();
  if (!value) return 'Good';
  if (value === 'new') return 'New';
  if (value === 'like_new' || value.includes('like new') || value.includes('flawless')) {
    return 'Like new';
  }
  if (value === 'fair' || value.includes('minor') || value.includes('scratch') || value.includes('dent')) {
    return 'Minor wear';
  }
  if (value.includes('working')) return 'Working';
  return 'Good';
}

function placeSummary(listing: FeedListing): string | null {
  const distance = formatDistance(listing.distance_km);
  const area = (listing.city || '').trim();
  return [distance, area].filter(Boolean).join(' • ') || null;
}

function sellerTrustSummary(listing: FeedListing): string {
  const completedDeals = Math.max(0, listing.seller_completed_deals || 0);
  if (completedDeals >= 3) return `Verified seller • ${completedDeals} sold`;
  return 'Verified seller';
}

function dealSignal(listing: FeedListing): string | null {
  const discountPct = listing.discount_pct
    ?? (
      listing.original_price != null && listing.original_price > listing.price
        ? Math.round((1 - listing.price / listing.original_price) * 100)
        : null
    );
  if (discountPct != null && discountPct >= 20) return 'Great deal';
  if (discountPct != null && discountPct >= 8) return 'Price dropped';
  if (listing.created_at) {
    const posted = new Date(listing.created_at).getTime();
    if (!Number.isNaN(posted) && Date.now() - posted < 86400 * 1000 * 3) {
      return 'Recently listed';
    }
  }
  return null;
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
            <Text style={s.dealStrike}>MRP {formatPrice(listing.original_price)}</Text>
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

// ── FEED VARIANT (horizontal catalog row) ────────────────────────────────────

export function FeedCard({
  listing, onPress, onMakeOffer, onWishlist, isWishlisted = false, index = 0,
}: Props) {
  const img = firstImage(listing);
  const bg = pickCardBg(index);
  const fallbackImage = fallbackImageForCategory(listing.category_slug);

  const showOriginal =
    listing.original_price != null && listing.original_price > listing.price;

  const displayTitle = cleanListingTitle(listing.title);
  const conditionLabel = conditionTagLabel(listing.condition);
  const sellerTrustLine = sellerTrustSummary(listing);
  const placeLine = placeSummary(listing);
  const signal = dealSignal(listing);
  const buyerFacts = buildListingFactChips(
    {
      ...listing,
      has_bill: listing.bill_available,
      has_box: listing.box_available,
      warranty_status: listing.warranty_active ? 'Warranty' : undefined,
    },
    {
      displayTitle,
      conditionLabel,
      includeCondition: true,
      max: 4,
    },
  );

  const handleViewDetails = () => onPress();
  const handleMakeOffer = () => {
    (onMakeOffer || onPress)();
  };

  return (
    <View style={s.feedCard}>
      <View style={[s.feedImgWrap, { backgroundColor: bg }]}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onPress}
          style={s.imagePressTarget}
          accessibilityRole="button"
          accessibilityLabel={`Open ${listing.title}`}
        >
          <View style={s.imageStage}>
            {img ? (
              <Image source={{ uri: img }} style={s.feedImage} resizeMode="contain" resizeMethod="resize" />
            ) : (
              <Image source={fallbackImage} style={s.feedImage} resizeMode="contain" resizeMethod="resize" />
            )}
            <View pointerEvents="none" style={s.imageWash} />
          </View>
        </TouchableOpacity>

        <View style={s.imageTrustBadge}>
          <ShieldCheck size={11} strokeWidth={2.35} color={C.petrolDeep} />
          <Text style={s.imageTrustText} numberOfLines={1}>Verified listing</Text>
        </View>

        {listing.discount_pct != null && listing.discount_pct > 0 && (
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

      <View style={s.feedInfo}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onPress}
          style={s.feedMeta}
          accessibilityRole="button"
          accessibilityLabel={`Open ${listing.title}`}
        >
          <Text style={s.feedTitle} numberOfLines={2}>{displayTitle}</Text>

          <View style={s.priceBlock}>
            <Text style={s.feedPrice}>{formatPriceFull(listing.price)}</Text>
            {signal && (
              <Text style={s.dealSignal} numberOfLines={1}>{signal}</Text>
            )}
            {showOriginal && (
              <Text style={s.feedStrike}>MRP {formatPriceFull(listing.original_price)}</Text>
            )}
          </View>

          <View style={s.detailRows}>
            <View style={s.specRow}>
              {buyerFacts.map((fact, factIndex) => (
                <View
                  key={`${fact}-${factIndex}`}
                  style={[s.specChip, factIndex === 0 && s.specChipPrimary]}
                >
                  <Text
                    style={[s.specChipText, factIndex === 0 && s.specChipTextPrimary]}
                    numberOfLines={1}
                  >
                    {fact}
                  </Text>
                </View>
              ))}
            </View>

            <View style={s.contextRow}>
              {placeLine ? (
                <>
                  <MapPin size={11} strokeWidth={2.2} color={C.text3} />
                  <Text
                    style={s.contextText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.84}
                  >
                    {placeLine}
                  </Text>
                  <View style={s.contextDot} />
                </>
              ) : null}
              <UserCheck size={12} strokeWidth={2.25} color={C.petrolText} />
              <Text
                style={[s.contextText, s.sellerTrustText]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.82}
              >
                {sellerTrustLine}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        <View style={s.feedActionWrap}>
          <View style={s.feedActions}>
            <Button
              label="Buy safely"
              variant="primary"
              size="sm"
              onPress={handleViewDetails}
              style={s.buySafeBtn}
              a11y={`Buy ${listing.title} safely`}
            />
            <Button
              label="Make offer"
              variant="secondary"
              size="sm"
              onPress={handleMakeOffer}
              style={s.offerBtn}
              a11y={`Make an offer for ${listing.title}`}
            />
          </View>
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
  imagePressTarget: {
    ...StyleSheet.absoluteFillObject,
    padding: S.xs + 1,
  },
  imageStage: {
    flex: 1,
    borderRadius: R.md - 2,
    overflow: 'hidden',
    backgroundColor: '#F7EFE7',
    borderWidth: 1,
    borderColor: 'rgba(255, 253, 248, 0.74)',
  },
  feedImage: {
    width: '100%',
    height: '100%',
  },
  imageWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 253, 248, 0.035)',
  },
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
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: S.xs,
  },
  dealPrice: {
    fontSize: T.size.sm + 1,
    fontWeight: T.weight.bold,
    color: C.ink,
  },
  dealStrike: {
    flexShrink: 1,
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
    marginHorizontal: S.md,
    flexDirection: 'row',
    minHeight: 184,
    backgroundColor: 'rgba(255,253,248,0.98)',
    borderRadius: R.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.72)',
    marginBottom: S.xs + 2,
    shadowColor: '#172033',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.045,
    shadowRadius: 7,
    elevation: 1,
  },
  feedImgWrap: {
    width: 132,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  imageDealBadge: {
    position: 'absolute',
    left: S.sm + 2,
    bottom: S.sm + 2,
    paddingHorizontal: S.xs + 2,
    paddingVertical: 3,
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
  imageTrustBadge: {
    position: 'absolute',
    top: S.sm,
    left: S.sm,
    maxWidth: 104,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: S.xs + 1,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255, 253, 248, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.18)',
    zIndex: 2,
  },
  imageTrustText: {
    fontSize: T.size.xs - 2,
    lineHeight: T.size.xs + 1,
    color: C.petrolDeep,
    fontWeight: T.weight.heavy,
  },
  heartBtn: {
    position: 'absolute',
    bottom: S.sm,
    right: S.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
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
  feedInfo: {
    flex: 1,
    minWidth: 0,
    paddingTop: S.sm + 2,
    paddingRight: S.sm + 2,
    paddingBottom: S.sm + 2,
    paddingLeft: S.sm + 2,
  },
  feedMeta: {
    flex: 1,
    minWidth: 0,
  },
  feedTitle: {
    fontSize: T.size.base,
    lineHeight: 17,
    fontWeight: T.weight.heavy,
    color: C.ink,
  },
  priceBlock: {
    marginTop: S.xs,
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 5,
  },
  feedPrice: {
    fontSize: T.size.md,
    fontWeight: T.weight.heavy,
    color: C.ink,
    letterSpacing: 0,
  },
  feedStrike: {
    flexShrink: 1,
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
    color: C.text3,
    textDecorationLine: 'line-through',
  },
  dealSignal: {
    paddingHorizontal: S.xs + 2,
    paddingVertical: 2,
    borderRadius: R.xs,
    overflow: 'hidden',
    backgroundColor: C.coralLight,
    color: C.coralDeep,
    fontSize: T.size.xs,
    lineHeight: T.size.xs + 3,
    fontWeight: T.weight.heavy,
  },
  detailRows: {
    marginTop: S.xs + 1,
    gap: 4,
  },
  specRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    minWidth: 0,
  },
  specChip: {
    maxWidth: 112,
    paddingHorizontal: S.xs + 2,
    paddingVertical: 2,
    borderRadius: R.xs,
    backgroundColor: 'rgba(247, 244, 237, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(116, 94, 76, 0.12)',
  },
  specChipPrimary: {
    backgroundColor: C.petrolLight,
    borderColor: 'rgba(79, 127, 134, 0.13)',
  },
  specChipText: {
    fontSize: T.size.xs - 1,
    lineHeight: T.size.xs + 3,
    color: C.text2,
    fontWeight: T.weight.semi,
  },
  specChipTextPrimary: {
    color: C.petrolText,
    fontWeight: T.weight.heavy,
  },
  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minWidth: 0,
  },
  contextText: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: T.size.xs,
    color: C.text3,
    fontWeight: T.weight.medium,
  },
  sellerTrustText: {
    color: C.petrolText,
    fontWeight: T.weight.semi,
  },
  contextDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(79, 127, 134, 0.38)',
    marginHorizontal: 1,
  },
  feedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  feedActionWrap: {
    marginTop: S.xs + 3,
  },
  buySafeBtn: {
    flex: 1.38,
    minWidth: 0,
    minHeight: 36,
    paddingHorizontal: S.xs,
  },
  offerBtn: {
    flex: 0.82,
    minWidth: 0,
    minHeight: 36,
    paddingHorizontal: S.xs,
  },
});
