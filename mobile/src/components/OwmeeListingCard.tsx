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
import { C, T, S, R, Home, pickCardBg } from '../utils/tokens';
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

// Trust only fully-qualified https image URLs from a known image host —
// localhost/file/relative URLs render as half-loaded noise instead of
// triggering onError, so we skip them entirely.
const TRUSTED_IMAGE_HOST_RX = /^https:\/\/[^/]+\.(r2\.cloudflarestorage\.com|r2\.dev|amazonaws\.com|cloudfront\.net|imgix\.net|cdn\.[^/]+)/i;

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

export function FeedCard({ listing, onPress, cardWidth, index = 0 }: Props) {
  const img = firstImage(listing);
  const bg = pickCardBg(index);
  const emoji = fallbackEmojiForCategory(listing.category_slug);

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

  const fresh = (() => {
    const ago = timeAgo(listing.created_at);
    if (!ago) return null;
    if (ago === 'just now') return 'Just listed';
    return ago;
  })();

  // Detail line — pulled from the seller's description when present.
  // We don't fabricate specs we don't have; if the seller didn't write
  // one, the row hides.
  const detailLine = (() => {
    const d = listing.description?.trim();
    if (!d) return null;
    return d.replace(/\s+/g, ' ').slice(0, 60);
  })();

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[s.feedCard, cardWidth ? { width: cardWidth } : null]}
    >
      <View style={[s.feedImgWrap, { backgroundColor: bg }]}>
        {img ? (
          <Image source={{ uri: img }} style={s.imgFill} resizeMode="cover" />
        ) : (
          <Text style={s.emojiFallback}>{emoji}</Text>
        )}

        {/* Discount % overlay (top-left). High-attention coral pill — the
            single most important conversion signal on the card. */}
        {showDiscount && (
          <View style={s.discountPill}>
            <Text style={s.discountPillText}>-{Math.round(listing.discount_pct!)}%</Text>
          </View>
        )}

        {/* Heart save — wishlist not yet wired; tap is a no-op. */}
        <TouchableOpacity activeOpacity={0.7} style={s.heartBtn} onPress={() => { /* TODO: wishlist */ }}>
          <Text style={s.heartGlyph} allowFontScaling={false}>♡</Text>
        </TouchableOpacity>
      </View>

      <View style={s.feedMeta}>
        <Text style={s.feedTitle} numberOfLines={1}>{listing.title}</Text>

        {/* Price block — Indian e-commerce convention:
              ₹31,999                              ← big listed price
              M.R.P. ₹38,000 · Save ₹6,001         ← MRP + savings line
            Keeps two distinct levels of attention; the "Save" line
            is the single biggest conversion lever for Indian buyers. */}
        <View style={s.priceBlock}>
          <Text style={s.feedPrice}>{formatPriceFull(listing.price)}</Text>
          {showOriginal && (
            <View style={s.mrpRow}>
              <Text style={s.mrpLabel}>M.R.P.</Text>
              <Text style={s.feedStrike}>{formatPriceFull(listing.original_price)}</Text>
              <Text style={s.metaSep} allowFontScaling={false}>·</Text>
              <Text style={s.savingsText} numberOfLines={1}>
                Save {formatPrice(listing.original_price! - listing.price)}
              </Text>
            </View>
          )}
        </View>

        {/* Pills row: condition (always-on green) + a curated set of
            Indian-marketplace trust signals when backend supplies them.
            Order = priority (anxiety-fighters first, convenience last).
            Showing >4 pills clutters small cards, so we cap. */}
        <View style={s.pillsRow}>
          <View style={[s.pill, s.pillGreen]}>
            <Text style={[s.pillText, s.pillTextGreen]}>Good condition</Text>
          </View>
          {listing.bill_available && (
            <View style={[s.pill, s.pillGreen]}>
              <Text style={[s.pillText, s.pillTextGreen]}>Bill</Text>
            </View>
          )}
          {listing.warranty_active && (
            <View style={[s.pill, s.pillBlue]}>
              <Text style={[s.pillText, s.pillTextBlue]}>
                {listing.warranty_months_left
                  ? `Warranty ${listing.warranty_months_left}mo`
                  : 'Warranty'}
              </Text>
            </View>
          )}
          {listing.box_available && (
            <View style={[s.pill, s.pillAmber]}>
              <Text style={[s.pillText, s.pillTextAmber]}>Box pack</Text>
            </View>
          )}
          {listing.returns_eligible && (
            <View style={[s.pill, s.pillBlue]}>
              <Text style={[s.pillText, s.pillTextBlue]}>7-day return</Text>
            </View>
          )}
          {listing.shipping_eligible ? (
            <View style={[s.pill, s.pillBlue]}>
              <Text style={[s.pillText, s.pillTextBlue]}>Ships free</Text>
            </View>
          ) : (
            <View style={[s.pill, s.pillAmber]}>
              <Text style={[s.pillText, s.pillTextAmber]}>Doorstep</Text>
            </View>
          )}
          {listing.is_negotiable && (
            <View style={[s.pill, s.pillAmber]}>
              <Text style={[s.pillText, s.pillTextAmber]}>Negotiable</Text>
            </View>
          )}
        </View>

        {detailLine && (
          <Text style={s.detailLine} numberOfLines={1}>{detailLine}</Text>
        )}

        {/* Meta row: distance · ✓ verified · time freshness. Each part
            is independently conditional, joined by middle-dots. */}
        <View style={s.metaRow}>
          {distanceText && (
            <>
              <Text style={s.metaPin} allowFontScaling={false}>📍</Text>
              <Text style={s.metaText} numberOfLines={1}>{distanceText}</Text>
            </>
          )}
          {distanceText && listing.is_owmee_verified && (
            <Text style={s.metaSep} allowFontScaling={false}>·</Text>
          )}
          {listing.is_owmee_verified && (
            <>
              <Text style={s.metaShield} allowFontScaling={false}>✓</Text>
              <Text style={s.metaVerified} numberOfLines={1}>Verified</Text>
            </>
          )}
          {(distanceText || listing.is_owmee_verified) && fresh && (
            <Text style={s.metaSep} allowFontScaling={false}>·</Text>
          )}
          {fresh && (
            <Text style={s.metaText} numberOfLines={1}>{fresh}</Text>
          )}
        </View>

        <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={s.offerBtn}>
          <Text style={s.offerText}>Buy safely</Text>
        </TouchableOpacity>
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
  emojiFallback: { fontSize: T.size.display + 18 },                   // 48

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
    borderRadius: R.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: S.xs + 2,
  },
  feedImgWrap: {
    width: '100%',
    aspectRatio: 4 / 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  discountPill: {
    position: 'absolute',
    top: S.xs + 1,
    left: S.xs + 1,
    paddingHorizontal: S.xs + 2,
    paddingVertical: 2,
    borderRadius: R.xs,
    backgroundColor: C.coralBright,
    zIndex: 2,
  },
  discountPillText: {
    color: C.white,
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
    letterSpacing: 0.2,
  },
  heartBtn: {
    position: 'absolute',
    top: S.xs + 1,
    right: S.xs + 1,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  heartGlyph: {
    fontSize: T.size.md,
    color: C.text,
    fontWeight: T.weight.bold,
  },
  feedMeta: {
    paddingHorizontal: S.sm + 2,
    paddingVertical: S.sm,
  },
  feedTitle: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: C.ink,
  },
  priceBlock: {
    marginTop: 2,
  },
  feedPrice: {
    fontSize: T.size.md + 1,
    fontWeight: T.weight.heavy,
    color: C.ink,
    letterSpacing: -0.2,
  },
  mrpRow: {
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  mrpLabel: {
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
    color: C.text3,
  },
  feedStrike: {
    fontSize: T.size.xs + 1,
    fontWeight: T.weight.semi,
    color: C.text3,
    textDecorationLine: 'line-through',
  },
  savingsText: {
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
    color: C.green,
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
    marginTop: S.xs,
    fontSize: T.size.xs,
    color: C.text2,
    fontWeight: T.weight.medium,
  },
  metaRow: {
    marginTop: S.xs + 2,
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
  offerBtn: {
    marginTop: S.sm,
    height: 32,
    borderRadius: R.sm,
    backgroundColor: C.petrol,           // brandNavy per spec rule 12 (Buy safely = navy)
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerText: {
    color: C.white,
    fontSize: T.size.base,
    fontWeight: T.weight.heavy,
  },
});
