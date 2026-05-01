/**
 * Owmee ListingCard — v6 "Petrol"
 *
 * The single most-used product card in the app. Shows up on
 * Home/discover, Search, Profile→Listings, Saved, and Order
 * history. One component, three layouts:
 *
 *   layout="grid"    Square photo on top, info below. Default.
 *                    Used in 2-col home/discover grid.
 *
 *   layout="list"    Square photo on the left, info to the right.
 *                    Used in search results and saved.
 *
 *   layout="hero"    Wide 16:9 photo, info overlaid at the bottom.
 *                    Used for "featured near you" rows.
 *
 * The visual contract is the same across all three:
 *   - Photo with optional condition meter overlay (top-left)
 *   - Optional status badge (top-right) — "Sale", "Ending soon"
 *   - Title + storage in Fraunces
 *   - Price in Inter Bold, original price struck through, %off pill
 *   - Distance + time-ago in Inter Regular text3
 *   - Optional escrow shield + verified seller dot row at the bottom
 *
 * Tap → onPress (full card). Heart → onSave (independent).
 */
import React from 'react';
import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import {
  C, FONTS, R, S, Shadow, T,
  formatDistance, formatPrice, percentOff, timeAgo,
} from '../../utils/tokens';
import StatusBadge from './StatusBadge';

export type ListingLayout = 'grid' | 'list' | 'hero';
export type ListingCondition = 'pristine' | 'good' | 'fair';

export interface Listing {
  id: string;
  title: string;          // "iPhone 13 Pro"
  storage?: string;       // "128 GB · Sierra Blue"
  price: number;
  originalPrice?: number;
  condition?: ListingCondition;
  /** Distance in meters. */
  distanceM?: number;
  /** Posted-at timestamp (ms). */
  postedAt?: number;
  photo: ImageSourcePropType | string;
  /** Override badge — defaults to a derived one when present. */
  badge?: { tone: 'hot' | 'brand' | 'positive' | 'warning'; label: string };
  escrowProtected?: boolean;
  sellerVerified?: boolean;
}

interface Props {
  listing: Listing;
  layout?: ListingLayout;
  saved?: boolean;
  onPress?: () => void;
  onSave?: () => void;
  style?: ViewStyle;
}

export default function OwmeeListingCard({
  listing, layout = 'grid', saved = false, onPress, onSave, style,
}: Props) {
  if (layout === 'list') return <ListLayout {...{ listing, saved, onPress, onSave, style }} />;
  if (layout === 'hero') return <HeroLayout {...{ listing, saved, onPress, onSave, style }} />;
  return <GridLayout {...{ listing, saved, onPress, onSave, style }} />;
}

// ── shared bits ────────────────────────────────────────────────────────

function Photo({ source, style }: { source: ImageSourcePropType | string; style?: ImageStyle }) {
  const src = typeof source === 'string' ? { uri: source } : source;
  return <Image source={src} style={[photo.img, style]} resizeMode="cover" />;
}

function ConditionMeter({ condition }: { condition: ListingCondition }) {
  const filled =
    condition === 'pristine' ? 3 :
    condition === 'good'     ? 2 : 1;
  const tint =
    condition === 'pristine' ? C.green :
    condition === 'good'     ? C.petrol : C.yellow;
  return (
    <View style={meter.wrap}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[meter.bar, { backgroundColor: i < filled ? tint : 'rgba(255,255,255,0.4)' }]} />
      ))}
    </View>
  );
}

function HeartButton({ saved, onPress }: { saved: boolean; onPress?: () => void }) {
  if (!onPress) return null;
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={heart.btn}
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Remove from saved' : 'Save listing'}
    >
      <Text style={[heart.glyph, { color: saved ? C.coral : C.bone }]}>
        {saved ? '♥' : '♡'}
      </Text>
    </TouchableOpacity>
  );
}

function PriceRow({ listing, big = false }: { listing: Listing; big?: boolean }) {
  const off = percentOff(listing.price, listing.originalPrice);
  return (
    <View style={priceRow.wrap}>
      <Text style={[priceRow.price, big && priceRow.priceBig]}>{formatPrice(listing.price)}</Text>
      {listing.originalPrice && listing.originalPrice > listing.price && (
        <Text style={priceRow.was}>{formatPrice(listing.originalPrice)}</Text>
      )}
      {off ? <Text style={priceRow.off}>{off}% off</Text> : null}
    </View>
  );
}

function MetaRow({ listing, onDark = false }: { listing: Listing; onDark?: boolean }) {
  const c = onDark ? C.onDark2 : C.text3;
  return (
    <View style={meta.row}>
      {listing.distanceM != null && (
        <Text style={[meta.text, { color: c }]}>{formatDistance(listing.distanceM)}</Text>
      )}
      {listing.distanceM != null && listing.postedAt != null && (
        <View style={[meta.dot, { backgroundColor: c }]} />
      )}
      {listing.postedAt != null && (
        <Text style={[meta.text, { color: c }]}>{timeAgo(new Date(listing.postedAt).toISOString())}</Text>
      )}
    </View>
  );
}

function TrustRow({ listing }: { listing: Listing }) {
  if (!listing.escrowProtected && !listing.sellerVerified) return null;
  return (
    <View style={trust.row}>
      {listing.escrowProtected && (
        <View style={trust.chip}>
          <Text style={trust.chipGlyph}>🛡</Text>
          <Text style={trust.chipText}>Escrow</Text>
        </View>
      )}
      {listing.sellerVerified && (
        <View style={trust.chip}>
          <View style={trust.dot} />
          <Text style={trust.chipText}>Verified</Text>
        </View>
      )}
    </View>
  );
}

// ── grid (default 2-col home/discover) ─────────────────────────────────

function GridLayout({ listing, saved, onPress, onSave, style }: Omit<Props, 'layout'>) {
  return (
    <TouchableOpacity activeOpacity={0.92} onPress={onPress} style={[grid.card, Shadow.card, style]}>
      <View style={grid.photoWrap}>
        <Photo source={listing.photo} style={grid.photo} />
        {listing.condition && (
          <View style={grid.metaTL}><ConditionMeter condition={listing.condition} /></View>
        )}
        {listing.badge && (
          <View style={grid.badgeTR}>
            <StatusBadge tone={listing.badge.tone} label={listing.badge.label} />
          </View>
        )}
        <View style={grid.heart}><HeartButton saved={!!saved} onPress={onSave} /></View>
      </View>

      <View style={grid.body}>
        <Text style={grid.title} numberOfLines={1}>{listing.title}</Text>
        {listing.storage && <Text style={grid.storage} numberOfLines={1}>{listing.storage}</Text>}
        <PriceRow listing={listing} />
        <MetaRow listing={listing} />
        <TrustRow listing={listing} />
      </View>
    </TouchableOpacity>
  );
}

// ── list (search results, saved) ───────────────────────────────────────

function ListLayout({ listing, saved, onPress, onSave, style }: Omit<Props, 'layout'>) {
  return (
    <TouchableOpacity activeOpacity={0.92} onPress={onPress} style={[list.row, Shadow.subtle, style]}>
      <View style={list.photoWrap}>
        <Photo source={listing.photo} style={list.photo} />
        {listing.condition && (
          <View style={list.metaTL}><ConditionMeter condition={listing.condition} /></View>
        )}
      </View>

      <View style={list.body}>
        <View style={list.titleRow}>
          <Text style={list.title} numberOfLines={1}>{listing.title}</Text>
          {listing.badge && (
            <StatusBadge tone={listing.badge.tone} label={listing.badge.label} />
          )}
        </View>
        {listing.storage && <Text style={list.storage} numberOfLines={1}>{listing.storage}</Text>}
        <PriceRow listing={listing} />
        <MetaRow listing={listing} />
        <TrustRow listing={listing} />
      </View>

      <View style={list.heart}><HeartButton saved={!!saved} onPress={onSave} /></View>
    </TouchableOpacity>
  );
}

// ── hero (featured / 16:9) ─────────────────────────────────────────────

function HeroLayout({ listing, saved, onPress, onSave, style }: Omit<Props, 'layout'>) {
  return (
    <TouchableOpacity activeOpacity={0.94} onPress={onPress} style={[hero.card, Shadow.card, style]}>
      <Photo source={listing.photo} style={hero.photo} />
      <View style={hero.scrim} />

      {listing.badge && (
        <View style={hero.badgeTR}>
          <StatusBadge tone={listing.badge.tone} label={listing.badge.label} />
        </View>
      )}
      <View style={hero.heart}><HeartButton saved={!!saved} onPress={onSave} /></View>

      <View style={hero.body}>
        <Text style={hero.title} numberOfLines={1}>{listing.title}</Text>
        <View style={hero.priceRow}>
          <Text style={hero.price}>{formatPrice(listing.price)}</Text>
          {listing.originalPrice && listing.originalPrice > listing.price && (
            <Text style={hero.was}>{formatPrice(listing.originalPrice)}</Text>
          )}
        </View>
        <MetaRow listing={listing} onDark />
      </View>
    </TouchableOpacity>
  );
}

// ── styles ─────────────────────────────────────────────────────────────

const photo = StyleSheet.create({
  img: { width: '100%', height: '100%', backgroundColor: C.bone2 },
});

const meter = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: 3,
    backgroundColor: 'rgba(15, 26, 31, 0.55)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: R.xs,
  },
  bar: { width: 8, height: 4, borderRadius: 1 },
});

const heart = StyleSheet.create({
  btn: {
    width: 32, height: 32, borderRadius: R.pill,
    backgroundColor: 'rgba(15, 26, 31, 0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  glyph: { fontSize: 18, lineHeight: 20 },
});

const priceRow = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'baseline', gap: S.sm, marginTop: S.xs },
  price: {
    fontFamily: FONTS.sansBold, fontSize: T.size.lg, fontWeight: T.weight.bold,
    color: C.text, letterSpacing: -0.3,
  },
  priceBig: { fontSize: T.size.xl },
  was: {
    fontFamily: FONTS.sans, fontSize: T.size.base, color: C.text3,
    textDecorationLine: 'line-through',
  },
  off: {
    fontFamily: FONTS.sansSemi, fontSize: T.size.xs, fontWeight: T.weight.semi,
    color: C.coralDeep, marginLeft: 'auto',
  },
});

const meta = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: S.xs, marginTop: S.xs },
  text: { fontFamily: FONTS.sans, fontSize: T.size.xs },
  dot:  { width: 2, height: 2, borderRadius: 1, opacity: 0.6 },
});

const trust = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: S.xs, marginTop: S.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: S.sm, paddingVertical: 3,
    borderRadius: R.pill, backgroundColor: C.petrolLight,
  },
  chipGlyph: { fontSize: 10 },
  chipText:  {
    fontFamily: FONTS.sansSemi, fontSize: T.size.xs, fontWeight: T.weight.semi,
    color: C.petrolDeep, letterSpacing: 0.2,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
});

const grid = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.lg, overflow: 'hidden' },
  photoWrap: { width: '100%', aspectRatio: 1, backgroundColor: C.bone2 },
  photo:     { ...StyleSheet.absoluteFillObject },
  metaTL:    { position: 'absolute', top: S.sm, left: S.sm },
  badgeTR:   { position: 'absolute', top: S.sm, right: S.sm },
  heart:     { position: 'absolute', bottom: S.sm, right: S.sm },
  body:      { padding: S.md, gap: 2 },
  title:     { fontFamily: FONTS.displayMedium, fontSize: T.size.md, color: C.text, letterSpacing: -0.2 },
  storage:   { fontFamily: FONTS.sans, fontSize: T.size.xs, color: C.text3 },
});

const list = StyleSheet.create({
  row: {
    flexDirection: 'row', backgroundColor: C.surface,
    borderRadius: R.lg, padding: S.sm, gap: S.md, alignItems: 'flex-start',
  },
  photoWrap: { width: 96, height: 96, borderRadius: R.md, overflow: 'hidden', backgroundColor: C.bone2 },
  photo:     { width: '100%', height: '100%' },
  metaTL:    { position: 'absolute', top: 6, left: 6 },
  body:      { flex: 1, gap: 2, paddingTop: 2 },
  titleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm },
  title:     { flex: 1, fontFamily: FONTS.displayMedium, fontSize: T.size.md, color: C.text, letterSpacing: -0.2 },
  storage:   { fontFamily: FONTS.sans, fontSize: T.size.xs, color: C.text3 },
  heart:     { paddingTop: 4 },
});

const hero = StyleSheet.create({
  card: { borderRadius: R.lg, overflow: 'hidden', backgroundColor: C.ink },
  photo: { width: '100%', aspectRatio: 16 / 9 },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 26, 31, 0.35)',
  },
  badgeTR: { position: 'absolute', top: S.md, right: S.md },
  heart:   { position: 'absolute', top: S.md, left: S.md },
  body:    { position: 'absolute', left: S.lg, right: S.lg, bottom: S.lg, gap: 2 },
  title:   {
    fontFamily: FONTS.displaySemi, fontSize: T.size.xl, color: C.bone, letterSpacing: -0.4,
  },
  priceRow:{ flexDirection: 'row', alignItems: 'baseline', gap: S.sm, marginTop: 2 },
  price:   { fontFamily: FONTS.sansBold, fontSize: T.size.lg, color: C.bone, letterSpacing: -0.3 },
  was:     {
    fontFamily: FONTS.sans, fontSize: T.size.base, color: C.onDark2,
    textDecorationLine: 'line-through',
  },
});
