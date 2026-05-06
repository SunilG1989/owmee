import React, { memo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, type ImageSourcePropType,
} from 'react-native';
import { C, T, S, R, Shadow, formatPrice, percentOff, condStyle } from '../../utils/tokens';
import { Button, IconButton } from '../ui';
import type { Listing } from '../../services/api';

interface Props {
  listing: Listing;
  onPress: (l: Listing) => void;
  onBuySafely?: (l: Listing) => void;
  onMakeOffer?: (l: Listing) => void;
  onWishlist?: (l: Listing) => void;
  isWishlisted?: boolean;
  showDistance?: boolean;
  cardWidth?: number; // T2-07: parent passes width, no useWindowDimensions
}

const FALLBACK_IMAGES: Record<string, ImageSourcePropType> = {
  smartphones: require('../../../assets/owmee/home/cat-mobile-photo-v2.png'),
  phones: require('../../../assets/owmee/home/cat-mobile-photo-v2.png'),
  laptops: require('../../../assets/owmee/home/cat-laptop-photo-v2.png'),
  'small-appliances': require('../../../assets/owmee/home/cat-appliances-photo-v2.png'),
  appliances: require('../../../assets/owmee/home/cat-appliances-photo-v2.png'),
  'kids-utility': require('../../../assets/owmee/home/cat-kids-photo-v2.png'),
  kids: require('../../../assets/owmee/home/cat-kids-photo-v2.png'),
  books: require('../../../assets/owmee/home/cat-books-photo-v2.png'),
};

function fallbackImageForCategory(slug?: string | null): ImageSourcePropType {
  return slug && FALLBACK_IMAGES[slug]
    ? FALLBACK_IMAGES[slug]
    : FALLBACK_IMAGES.smartphones;
}

function isDisplayableImageUrl(uri?: string | null): uri is string {
  if (!uri) return false;
  if (/^(r2:\/\/|file:\/\/)/i.test(uri)) return false;
  if (/(localhost|127\.0\.0\.1|192\.168\.|10\.0\.)/i.test(uri)) return false;
  return /^https?:\/\//i.test(uri);
}

// T2-07: REMOVED useWindowDimensions — parent calculates once, passes to all cards
export const ListingCard = memo(function ListingCard({
  listing, onPress, onBuySafely, onMakeOffer, onWishlist, isWishlisted, showDistance = true, cardWidth,
}: Props) {
  const cardW = cardWidth || 170; // fallback only
  const imgH = cardW;
  const rawUri = listing.thumbnail_url || listing.image_urls?.[0] || listing.images?.[0];
  const uri = isDisplayableImageUrl(rawUri) ? rawUri : null;
  const fallbackImage = fallbackImageForCategory(
    listing.category_slug || (listing.is_kids_item ? 'kids-utility' : null),
  );
  const cs = condStyle(listing.condition);
  const off = percentOff(listing.price, listing.original_price);
  const handleBuySafely = () => {
    (onBuySafely || onPress)(listing);
  };
  const handleMakeOffer = () => {
    (onMakeOffer || onPress)(listing);
  };

  return (
    <View
      style={[s.card, { width: cardW }, Shadow.card]}
    >
      <View style={[s.imgWrap, { height: imgH }]}>
        <TouchableOpacity
          activeOpacity={0.92}
          onPress={() => onPress(listing)}
          style={s.imagePressTarget}
          accessibilityRole="button"
          accessibilityLabel={`Open ${listing.title}`}
        >
          {uri ? (
            <Image
              source={{ uri }} // T4-19: immutable cache
              style={s.img} resizeMode={"cover"}
            />
          ) : (
            <Image source={fallbackImage} style={s.img} resizeMode="cover" />
          )}
        </TouchableOpacity>
        {onWishlist && (
          <View style={s.heartWrap}>
            <IconButton
              icon={isWishlisted ? '♥' : '♡'}
              onPress={() => onWishlist(listing)}
              a11y={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
              variant="outlined"
              size="sm"
              style={isWishlisted ? s.heartOn : undefined}
            />
          </View>
        )}
        <View style={[s.cond, { backgroundColor: cs.bg }]}>
          <Text style={[s.condText, { color: cs.color }]}>{cs.label}</Text>
        </View>
      </View>

      <View style={s.info}>
        <TouchableOpacity
          activeOpacity={0.92}
          onPress={() => onPress(listing)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${listing.title}`}
        >
          <View style={s.priceRow}>
            <Text style={s.price}>{formatPrice(listing.price)}</Text>
            {listing.original_price ? <Text style={s.mrp}>{formatPrice(listing.original_price)}</Text> : null}
            {off ? <Text style={s.off}>{off}% off</Text> : null}
          </View>
          <Text style={s.title} numberOfLines={2}>{listing.title}</Text>
          {listing.seller?.avg_rating ? (
            <View style={s.ratingRow}>
              <Text style={s.stars}>{'★'.repeat(Math.round(listing.seller.avg_rating))}</Text>
              <Text style={s.ratingNum}>{listing.seller.avg_rating.toFixed(1)}</Text>
              {listing.seller.deal_count ? <Text style={s.ratingCount}>({listing.seller.deal_count})</Text> : null}
            </View>
          ) : null}
          <View style={s.metaRow}>
            {listing.seller_verified && (
              <View style={s.verified}><Text style={s.verifiedIcon}>✓</Text><Text style={s.verifiedText}>Verified</Text></View>
            )}
            {showDistance && listing.distance_km != null && <Text style={s.dist}>{listing.distance_km < 1 ? `${Math.round(listing.distance_km * 1000)} m` : `${listing.distance_km.toFixed(1)} km`}</Text>}
            {!showDistance && listing.city && <Text style={s.dist}>{listing.city}</Text>}
            {listing.is_negotiable && <View style={s.negoTag}><Text style={s.negoText}>Negotiable</Text></View>}
          </View>
        </TouchableOpacity>
        <View style={s.actionRow}>
          <TouchableOpacity
            activeOpacity={0.84}
            onPress={handleBuySafely}
            style={s.buySafeBtn}
            accessibilityRole="button"
            accessibilityLabel={`Buy ${listing.title} safely`}
          >
            <Text style={s.buySafeText} numberOfLines={1}>Buy safely</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.84}
            onPress={handleMakeOffer}
            style={s.offerBtn}
            accessibilityRole="button"
            accessibilityLabel={`Make an offer for ${listing.title}`}
          >
            <Text style={s.offerText} numberOfLines={1}>Make offer</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

// T2-08: SkeletonCard now wrapped in memo + accepts cardWidth prop
export const SkeletonCard = memo(function SkeletonCard({ cardWidth }: { cardWidth?: number }) {
  const cardW = cardWidth || 170;
  return (
    <View style={[s.card, { width: cardW }, Shadow.card]}>
      <View style={[s.imgWrap, { height: cardW, backgroundColor: C.border2 }]} />
      <View style={s.info}>
        <View style={s.skelLine1} />
        <View style={s.skelLine2} />
        <View style={s.skelLine3} />
      </View>
    </View>
  );
});

export function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <View style={s.secHeader}>
      <Text style={s.secTitle}>{title}</Text>
      {onSeeAll && (
        <Button label="See all →" variant="ghost" size="sm" onPress={onSeeAll} />
      )}
    </View>
  );
}

export function ActivityTicker({ text }: { text: string }) {
  return (
    <View style={s.ticker}>
      <View style={s.tickerDot} />
      <Text style={s.tickerText}>{text}</Text>
    </View>
  );
}

// T2-07: Export utility for parent to calculate card width
export function calcCardWidth(screenWidth: number): number {
  return (screenWidth - S.xl * 2 - S.sm) / 2;
}

// getItemLayout for FlatList scroll optimization
export function getCardLayout(screenWidth: number) {
  const cardW = calcCardWidth(screenWidth);
  const cardH = cardW + 154;
  return (_data: any, index: number) => ({
    length: cardH,
    offset: cardH * Math.floor(index / 2),
    index,
  });
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden', borderWidth: 1, borderColor: C.border, marginBottom: S.sm },
  imgWrap: { width: '100%', backgroundColor: C.border2, position: 'relative' },
  imagePressTarget: { ...StyleSheet.absoluteFillObject },
  img: { width: '100%', height: '100%' },
  heartWrap: { position: 'absolute', top: S.sm, right: S.sm },
  heartOn: { backgroundColor: 'rgba(255,255,255,0.95)' },
  cond: { position: 'absolute', bottom: S.sm, left: S.sm, paddingHorizontal: S.sm + 1, paddingVertical: 3, borderRadius: R.xs },
  condText: { fontSize: T.size.xs, fontWeight: T.weight.bold },
  info: { padding: S.md },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginBottom: 3 },
  price: { fontSize: T.size.lg, fontWeight: T.weight.heavy, color: C.ink, letterSpacing: -0.3 },
  mrp: { fontSize: T.size.xs, color: C.text4, textDecorationLine: 'line-through' },
  off: { fontSize: T.size.xs, fontWeight: T.weight.heavy, color: C.petrolMid },
  title: { fontSize: T.size.base - 1, fontWeight: T.weight.medium, color: C.text2, lineHeight: 17, marginBottom: 5 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 5 },
  stars: { fontSize: T.size.xs, color: C.petrol, letterSpacing: -1 },
  ratingNum: { fontSize: T.size.xs, fontWeight: T.weight.bold, color: C.ink },
  ratingCount: { fontSize: T.size.xs, color: C.text3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.petrolLight, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  verifiedIcon: { fontSize: T.size.xs, fontWeight: '900', color: C.petrol },
  verifiedText: { fontSize: T.size.xs, fontWeight: T.weight.bold, color: C.petrolText },
  dist: { fontSize: T.size.xs, color: C.text3, fontWeight: T.weight.medium },
  negoTag: { backgroundColor: C.petrolLight, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  negoText: { fontSize: T.size.xs, fontWeight: T.weight.bold, color: C.petrolDeep },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: S.sm + 2 },
  buySafeBtn: {
    flex: 1.05,
    minHeight: 34,
    borderRadius: R.sm,
    backgroundColor: C.petrolDeep,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  buySafeText: {
    color: C.white,
    fontSize: T.size.xs + 1,
    fontWeight: T.weight.heavy,
  },
  offerBtn: {
    flex: 1,
    minHeight: 34,
    borderRadius: R.sm,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: 'rgba(110, 76, 69, 0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  offerText: {
    color: C.coralDeep,
    fontSize: T.size.xs + 1,
    fontWeight: T.weight.heavy,
  },
  // Skeleton lines
  skelLine1: { width: '60%', height: 14, backgroundColor: C.border, borderRadius: R.xs - 2 },
  skelLine2: { width: '85%', height: 10, backgroundColor: C.border2, borderRadius: R.xs - 2, marginTop: 6 },
  skelLine3: { width: '40%', height: 10, backgroundColor: C.border2, borderRadius: R.xs - 2, marginTop: 6 },
  secHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: S.xl, marginTop: S.lg, marginBottom: S.sm },
  secTitle: { fontSize: T.size.lg, fontWeight: T.weight.bold, color: C.ink, letterSpacing: -0.3 },
  secLink: { fontSize: T.size.base - 1, color: C.petrolDeep, fontWeight: T.weight.semi },
  ticker: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.petrolLight, paddingHorizontal: S.md, paddingVertical: 6, borderRadius: R.sm, marginHorizontal: S.xl, marginBottom: S.sm },
  tickerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.petrol },
  tickerText: { fontSize: T.size.sm, color: C.petrolText },
});
