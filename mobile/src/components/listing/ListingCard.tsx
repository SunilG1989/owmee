import React, { memo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, type ImageSourcePropType,
} from 'react-native';
import { MapPin, ShieldCheck } from 'lucide-react-native';
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
  others: require('../../../assets/owmee/home/cat-books-photo-v2.png'),
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

function formatDistance(km: number | null | undefined): string | null {
  if (km == null) return null;
  if (km < 0.1) return 'Nearby';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function dealSignal(listing: Listing): string | null {
  const off = percentOff(listing.price, listing.original_price);
  if (off != null && off >= 20) return 'Great deal';
  if (off != null && off >= 8) return 'Price dropped';
  if (listing.published_at) {
    const posted = new Date(listing.published_at).getTime();
    if (!Number.isNaN(posted) && Date.now() - posted < 86400 * 1000 * 3) {
      return 'Recently listed';
    }
  }
  return null;
}

function cleanSpecValue(value: string | number | null | undefined): string | null {
  const cleaned = String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^(n\/a|na|none|null|unknown|not sure)$/i.test(cleaned)) return null;
  return cleaned
    .replace(/\bgb\b/gi, 'GB')
    .replace(/\btb\b/gi, 'TB')
    .replace(/\bmah\b/gi, 'mAh');
}

function withCapacityUnit(value: string): string {
  return /^\d+$/.test(value) ? `${value}GB` : value;
}

function formatRamChip(value?: string | null): string | null {
  const cleaned = cleanSpecValue(value);
  if (!cleaned) return null;
  const capacity = withCapacityUnit(cleaned);
  return /\bram\b/i.test(capacity) ? capacity : `${capacity} RAM`;
}

function addUniqueChip(chips: string[], value: string | null | undefined) {
  if (!value) return;
  const label = value.trim();
  if (!label) return;
  const key = label.toLowerCase();
  if (!chips.some(item => item.toLowerCase() === key)) chips.push(label);
}

function compactSpecChips(listing: Listing): string[] {
  const chips: string[] = [];
  const storage = cleanSpecValue(listing.storage);
  const warranty = cleanSpecValue(listing.warranty_status);

  addUniqueChip(chips, storage ? withCapacityUnit(storage) : null);
  addUniqueChip(chips, formatRamChip(listing.ram));
  addUniqueChip(chips, cleanSpecValue(listing.color));
  if (warranty && !/no|none|expired/i.test(warranty)) addUniqueChip(chips, 'Warranty');
  if (listing.has_bill) addUniqueChip(chips, 'Bill');
  if (listing.has_box) addUniqueChip(chips, 'Box');

  return chips.slice(0, 3);
}

// T2-07: REMOVED useWindowDimensions — parent calculates once, passes to all cards
export const ListingCard = memo(function ListingCard({
  listing, onPress, onBuySafely, onMakeOffer, onWishlist, isWishlisted, showDistance = true, cardWidth,
}: Props) {
  const cardW = cardWidth || 170; // fallback only
  const imgH = Math.round(cardW * 0.76);
  const rawUri = listing.thumbnail_url || listing.image_urls?.[0] || listing.images?.[0];
  const uri = isDisplayableImageUrl(rawUri) ? rawUri : null;
  const fallbackImage = fallbackImageForCategory(
    listing.category_slug || (listing.is_kids_item ? 'kids-utility' : null),
  );
  const cs = condStyle(listing.condition);
  const off = percentOff(listing.price, listing.original_price);
  const hasOwmeeCheck = Boolean(
    listing.seller_verified
    || listing.seller?.kyc_verified
    || (listing.reviewed_by && listing.reviewed_by !== 'none'),
  );
  const signal = dealSignal(listing);
  const specChips = compactSpecChips(listing);
  const detailChipLimit = off ? 2 : 3;
  const detailChips = [off ? null : signal, ...specChips]
    .filter(Boolean)
    .slice(0, detailChipLimit) as string[];
  const distanceText = showDistance ? formatDistance(listing.distance_km) : null;
  const placeText = listing.city || null;
  const metaLine = [distanceText, placeText].filter(Boolean).join(' · ');
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
        <View style={[s.trustBadge, !hasOwmeeCheck && s.safeIconBadge]}>
          <ShieldCheck size={12} strokeWidth={2.35} color={C.petrolDeep} />
          {hasOwmeeCheck ? (
            <Text style={s.trustBadgeText} numberOfLines={1}>
              Verified
            </Text>
          ) : null}
        </View>
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
          </View>
          <Text style={s.title} numberOfLines={2}>{listing.title}</Text>

          {(detailChips.length > 0 || off) && (
            <View style={s.detailTagRow}>
              {off ? (
                <View style={[s.detailChip, s.dealChip]}>
                  <Text style={[s.detailChipText, s.dealChipText]} numberOfLines={1}>{off}% off</Text>
                </View>
              ) : null}
              {detailChips.map(chip => (
                <View key={chip} style={s.detailChip}>
                  <Text style={s.detailChipText} numberOfLines={1}>{chip}</Text>
                </View>
              ))}
            </View>
          )}

          {listing.seller?.avg_rating ? (
            <View style={s.ratingRow}>
              <Text style={s.stars}>{'★'.repeat(Math.round(listing.seller.avg_rating))}</Text>
              <Text style={s.ratingNum}>{listing.seller.avg_rating.toFixed(1)}</Text>
              {listing.seller.deal_count ? <Text style={s.ratingCount}>({listing.seller.deal_count})</Text> : null}
            </View>
          ) : null}
          {metaLine ? (
            <View style={s.metaRow}>
              <MapPin size={11} strokeWidth={2.2} color={C.text3} />
              <Text style={s.dist} numberOfLines={1}>{metaLine}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
        <View style={s.actionRow}>
          <Button
            label="Buy safely"
            variant="primary"
            size="sm"
            onPress={handleBuySafely}
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
  );
});

// T2-08: SkeletonCard now wrapped in memo + accepts cardWidth prop
export const SkeletonCard = memo(function SkeletonCard({ cardWidth }: { cardWidth?: number }) {
  const cardW = cardWidth || 170;
  return (
    <View style={[s.card, { width: cardW }, Shadow.card]}>
      <View style={[s.imgWrap, { height: Math.round(cardW * 0.76), backgroundColor: C.border2 }]} />
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
  const cardH = Math.round(cardW * 0.76) + 142;
  return (_data: any, index: number) => ({
    length: cardH,
    offset: cardH * Math.floor(index / 2),
    index,
  });
}

const s = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,253,248,0.98)',
    borderRadius: R.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(224, 203, 188, 0.72)',
    marginBottom: S.sm + 2,
  },
  imgWrap: { width: '100%', backgroundColor: C.border2, position: 'relative' },
  imagePressTarget: { ...StyleSheet.absoluteFillObject },
  img: { width: '100%', height: '100%' },
  heartWrap: { position: 'absolute', top: S.xs + 2, right: S.xs + 2 },
  heartOn: { backgroundColor: 'rgba(255,255,255,0.95)' },
  cond: { position: 'absolute', bottom: S.sm, left: S.sm, paddingHorizontal: S.sm + 1, paddingVertical: 3, borderRadius: R.xs },
  condText: { fontSize: T.size.xs, fontWeight: T.weight.bold },
  trustBadge: {
    position: 'absolute',
    top: S.xs + 2,
    left: S.xs + 2,
    paddingHorizontal: S.xs + 2,
    paddingVertical: 3,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255,253,248,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.16)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    zIndex: 2,
  },
  safeIconBadge: {
    backgroundColor: 'rgba(246,251,250,0.94)',
    width: 30,
    height: 30,
    paddingHorizontal: 0,
    paddingVertical: 0,
    justifyContent: 'center',
  },
  trustBadgeText: {
    color: C.petrolDeep,
    fontSize: T.size.xs - 1,
    fontWeight: T.weight.heavy,
  },
  info: { padding: S.sm + 2, paddingBottom: S.sm },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginBottom: 3 },
  price: { fontSize: T.size.lg, fontWeight: T.weight.heavy, color: C.ink, letterSpacing: 0 },
  mrp: { fontSize: T.size.xs, color: C.text4, textDecorationLine: 'line-through' },
  title: { fontSize: T.size.base - 1, fontWeight: T.weight.medium, color: C.text2, lineHeight: 17, marginBottom: 5 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 5 },
  stars: { fontSize: T.size.xs, color: C.petrol, letterSpacing: 0 },
  ratingNum: { fontSize: T.size.xs, fontWeight: T.weight.bold, color: C.ink },
  ratingCount: { fontSize: T.size.xs, color: C.text3 },
  detailTagRow: {
    marginTop: S.xs,
    flexDirection: 'row',
    gap: 4,
    flexWrap: 'wrap',
  },
  detailChip: {
    maxWidth: 108,
    paddingHorizontal: S.xs + 2,
    paddingVertical: 2,
    borderRadius: R.xs,
    backgroundColor: C.petrolLight,
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.12)',
  },
  detailChipText: {
    fontSize: T.size.xs - 1,
    color: C.petrolText,
    fontWeight: T.weight.medium,
  },
  dealChip: {
    backgroundColor: C.coralLight,
    borderColor: 'rgba(215, 168, 158, 0.24)',
  },
  dealChipText: {
    color: C.coralDeep,
    fontWeight: T.weight.heavy,
  },
  metaRow: { marginTop: S.xs + 1, flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' },
  dist: { fontSize: T.size.xs, color: C.text3, fontWeight: T.weight.medium, flexShrink: 1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: S.sm },
  buySafeBtn: {
    flex: 1.3,
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
  // Skeleton lines
  skelLine1: { width: '60%', height: 14, backgroundColor: C.border, borderRadius: R.xs - 2 },
  skelLine2: { width: '85%', height: 10, backgroundColor: C.border2, borderRadius: R.xs - 2, marginTop: 6 },
  skelLine3: { width: '40%', height: 10, backgroundColor: C.border2, borderRadius: R.xs - 2, marginTop: 6 },
  secHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: S.xl, marginTop: S.lg, marginBottom: S.sm },
  secTitle: { fontSize: T.size.lg, fontWeight: T.weight.bold, color: C.ink, letterSpacing: 0 },
  ticker: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.petrolLight, paddingHorizontal: S.md, paddingVertical: 6, borderRadius: R.sm, marginHorizontal: S.xl, marginBottom: S.sm },
  tickerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.petrol },
  tickerText: { fontSize: T.size.sm, color: C.petrolText },
});
