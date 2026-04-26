import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet , Image} from 'react-native';
import { C, T, S, R, Shadow, formatPrice, percentOff, condStyle, MIN_TAP } from '../../utils/tokens';
import type { Listing } from '../../services/api';

interface Props {
  listing: Listing;
  onPress: (l: Listing) => void;
  onWishlist?: (l: Listing) => void;
  isWishlisted?: boolean;
  showDistance?: boolean;
  cardWidth?: number; // T2-07: parent passes width, no useWindowDimensions
}

// T2-07: REMOVED useWindowDimensions — parent calculates once, passes to all cards
export const ListingCard = memo(function ListingCard({
  listing, onPress, onWishlist, isWishlisted, showDistance = true, cardWidth,
}: Props) {
  const cardW = cardWidth || 170; // fallback only
  const imgH = cardW;
  const uri = listing.thumbnail_url || listing.images?.[0];
  const cs = condStyle(listing.condition);
  const off = percentOff(listing.price, listing.original_price);

  return (
    <TouchableOpacity
      style={[s.card, { width: cardW }, Shadow.card]}
      activeOpacity={0.92}
      onPress={() => onPress(listing)}
    >
      <View style={[s.imgWrap, { height: imgH }]}>
        {uri ? (
          <Image
            source={{ uri }} // T4-19: immutable cache
            style={s.img} resizeMode={"cover"}
          />
        ) : (
          <View style={s.placeholder}>
            <Text style={s.placeholderEmoji}>
              {listing.category_slug === 'phones' ? '📱' : listing.category_slug === 'laptops' ? '💻' : listing.is_kids_item ? '🧸' : '📦'}
            </Text>
          </View>
        )}
        {onWishlist && (
          <TouchableOpacity style={s.heart} onPress={() => onWishlist(listing)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[s.heartIcon, isWishlisted && { color: C.red }]}>{isWishlisted ? '♥' : '♡'}</Text>
          </TouchableOpacity>
        )}
        <View style={[s.cond, { backgroundColor: cs.bg }]}>
          <Text style={[s.condText, { color: cs.color }]}>{cs.label}</Text>
        </View>
      </View>

      <View style={s.info}>
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
      </View>
    </TouchableOpacity>
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
      {onSeeAll && <TouchableOpacity onPress={onSeeAll}><Text style={s.secLink}>See all →</Text></TouchableOpacity>}
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
  const cardH = cardW + 110;
  return (_data: any, index: number) => ({
    length: cardH,
    offset: cardH * Math.floor(index / 2),
    index,
  });
}

const s = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden', borderWidth: 1, borderColor: C.border, marginBottom: S.sm },
  imgWrap: { width: '100%', backgroundColor: C.border2, position: 'relative' },
  img: { width: '100%', height: '100%' },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sand },
  placeholderEmoji: { fontSize: 36 },
  heart: { position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  heartIcon: { fontSize: 15, color: C.text4 },
  cond: { position: 'absolute', bottom: 8, left: 8, paddingHorizontal: 9, paddingVertical: 3, borderRadius: R.xs },
  condText: { fontSize: T.size.xs, fontWeight: T.weight.bold },
  info: { padding: S.md },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginBottom: 3 },
  price: { fontSize: 17, fontWeight: T.weight.heavy, color: C.ink, letterSpacing: -0.3 },
  mrp: { fontSize: T.size.xs, color: C.text4, textDecorationLine: 'line-through' },
  off: { fontSize: T.size.xs, fontWeight: T.weight.heavy, color: C.forestVivid },
  title: { fontSize: T.size.base - 1, fontWeight: T.weight.medium, color: C.text2, lineHeight: 17, marginBottom: 5 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 5 },
  stars: { fontSize: T.size.xs, color: C.honey, letterSpacing: -1 },
  ratingNum: { fontSize: T.size.xs, fontWeight: T.weight.bold, color: C.ink },
  ratingCount: { fontSize: T.size.xs, color: C.text3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.forestLight, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  verifiedIcon: { fontSize: 10, fontWeight: '900', color: C.forest },
  verifiedText: { fontSize: T.size.xs, fontWeight: T.weight.bold, color: C.forestText },
  dist: { fontSize: T.size.xs, color: C.text3, fontWeight: T.weight.medium },
  negoTag: { backgroundColor: C.honeyLight, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  negoText: { fontSize: 10, fontWeight: T.weight.bold, color: C.honeyDeep },
  // Skeleton lines (T2-08: moved from inline objects)
  skelLine1: { width: '60%', height: 14, backgroundColor: C.border, borderRadius: 4 },
  skelLine2: { width: '85%', height: 10, backgroundColor: C.border2, borderRadius: 4, marginTop: 6 },
  skelLine3: { width: '40%', height: 10, backgroundColor: C.border2, borderRadius: 4, marginTop: 6 },
  secHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: S.xl, marginTop: S.lg, marginBottom: S.sm },
  secTitle: { fontSize: T.size.lg, fontWeight: T.weight.bold, color: C.ink, letterSpacing: -0.3 },
  secLink: { fontSize: T.size.base - 1, color: C.honeyDeep, fontWeight: T.weight.semi },
  ticker: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.forestLight, paddingHorizontal: S.md, paddingVertical: 6, borderRadius: R.sm, marginHorizontal: S.xl, marginBottom: S.sm },
  tickerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.forest },
  tickerText: { fontSize: T.size.sm, color: C.forestText },
});
