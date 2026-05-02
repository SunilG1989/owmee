/**
 * Owmee Design Tokens — v6 "Petrol"
 *
 * Drop-in replacement for mobile/src/utils/tokens.ts.
 * Preserves every export from v4 (C, T, S, R, Shadow, I, O, StatusColor,
 * MIN_TAP, formatPrice, percentOff, formatDistance, timeAgo, condStyle,
 * statusTone, prettyStatus) so existing screens compile UNCHANGED.
 *
 * What changed from v4 "Warm Trust":
 *   - Primary: warm honey #D88A36  →  petrol #1E5F5C (green-blue mix)
 *   - Secondary: sage forest #3D7A5C  →  petrol family (one cool primary)
 *   - Canvas: ghee cream #FAF6EE  →  bone #F6F1E7 (kept warm; refined)
 *   - Added: coral #E87A5D for "act now" moments (sale, ending soon)
 *   - Shadows: warm amber tint  →  cool ink tint (matches petrol family)
 *
 * Migration philosophy:
 *   - Every legacy NAME (C.honey, C.forest, C.cream, etc.) still works.
 *     They now point at the v6 palette so screens render the new brand
 *     instantly without code edits.
 *   - For NEW code, prefer the semantic layer at the bottom (theme.brand,
 *     theme.accent, theme.bg, etc.) — palette-swap-stable.
 */

export const C = {
  // ── PRIMARY · petrol (green+blue mix) ────────────────────────────────
  petrol:        '#1E5F5C',
  petrolLight:   '#D9EAE8',
  petrolMid:     '#3F8C87',
  petrolGlow:    '#5FB8A8',
  petrolDeep:    '#134543',
  petrolText:    '#0B2D2C',

  // ── SECONDARY · aqua (lighter teal, hover/secondary) ─────────────────
  aqua:          '#5FB8A8',
  aquaLight:     '#E8F4F1',
  aquaDeep:      '#2E8077',

  // ── ACCENT · coral (warm complement, used SPARINGLY — once per screen)
  // Sale, ending soon, paid-out, hot, urgent. Pairs with petrol the way
  // coral does with teal in nature.
  coral:         '#E87A5D',
  coralLight:    '#FCE8E0',
  coralDeep:     '#B85638',

  // ── SURFACES · warm bone canvas ──────────────────────────────────────
  bone:          '#F6F1E7',
  bone2:         '#ECE5D4',
  cream:         '#F6F1E7',  // legacy alias → bone
  sand:          '#ECE5D4',  // legacy alias → bone2
  surface:       '#FFFFFF',

  // Dark surfaces (for inverse contexts — invoice receipts, FE night ops)
  inkBg:         '#0F1A1F',
  inkBg2:        '#182429',
  inkBg3:        '#243136',

  // ── INK · deep blue-black (matches petrol family) ────────────────────
  ink:           '#0F1A1F',
  ink2:          '#182429',

  // ── TEXT scale (cool grays, contrast-tested) ─────────────────────────
  text:          '#0F1A1F',
  text2:         '#4A555B',
  text3:         '#828A90',
  text4:         '#BCC2C7',

  onDark1:       '#F6F1E7',
  onDark2:       'rgba(246, 241, 231, 0.72)',
  onDark3:       'rgba(246, 241, 231, 0.48)',

  // ── LINES ────────────────────────────────────────────────────────────
  border:        '#E5DECB',
  border2:       '#EFEAD9',
  borderDark:    'rgba(246, 241, 231, 0.10)',

  // ── SEMANTIC ─────────────────────────────────────────────────────────
  red:           '#C8473A',
  redLight:      '#FAE5E2',
  green:         '#2E8B57',
  greenLight:    '#E2F3EA',
  yellow:        '#D4A02E',
  yellowLight:   '#F8EED2',

  white:         '#FFFFFF',

  // ── CARD ACCENT BACKGROUNDS (for variety on home/discover) ───────────
  cardBgGray:    '#ECE5D4',
  cardBgMauve:   '#F1E5EE',
  cardBgGreen:   '#D9EAE8',
  cardBgPeach:   '#FCE8E0',
  cardBgAmber:   '#F8EED2',
  cardBgStone:   '#ECE5D4',
  cardBgPastel:  '#E8F4F1',

  // ── LEGACY ALIASES — v4 "Warm Trust" names → v6 "Petrol" values ──────
  // Every legacy callsite (C.honey, C.forest, C.primary, C.muted, etc.)
  // keeps compiling. Visual output now matches v6 brand.
  // Migrate one screen at a time, then delete this block.
  honey:         '#1E5F5C',  // was #D88A36 — primary CTA → petrol
  honeyLight:    '#D9EAE8',  // was #FBF1DC — petrol tint
  honeyGlow:     '#5FB8A8',  // was #F0B662 — petrol glow
  honeyDeep:     '#134543',  // was #A56B22 — petrol deep
  honeyText:     '#0B2D2C',  // was #6E4716 — readable on bone

  forest:        '#1E5F5C',  // was #3D7A5C — collapses into petrol
  forestLight:   '#D9EAE8',  // was #E5EFE9 — petrol tint
  forestVivid:   '#3F8C87',  // was #4F9272 — petrol mid
  forestText:    '#0B2D2C',  // was #2C5E45 — readable on bone

  primary:       '#1E5F5C',  // → petrol
  muted:         '#828A90',  // → text3
  danger:        '#C8473A',  // → red
  success:       '#2E8B57',  // → green
  successBg:     '#E2F3EA',  // → greenLight
  bg:            '#F6F1E7',  // → bone
  surfaceMuted:  '#ECE5D4',  // → bone2
  amber:         '#1E5F5C',  // legacy Sprint 4 alias → petrol
  amberLight:    '#D9EAE8',  // → petrolLight
} as const;

export const T = {
  size: { xs: 10, sm: 11, base: 13, md: 15, lg: 17, xl: 20, xxl: 24, display: 30 },
  weight: { regular: '400' as const, medium: '500' as const, semi: '600' as const, bold: '700' as const, heavy: '800' as const },

  // Legacy numeric aliases — keep stable so existing screens lay out identically.
  h1: 24,
  h2: 20,
  h3: 17,
  body: 15,
  small: 13,
  caption: 11,
} as const;

// ── FONT FAMILIES (NEW in v6) ─────────────────────────────────────────
// Drop the TTFs into mobile/assets/fonts/ and run:
//   cd mobile && npx react-native-asset
//   cd ios && pod install
// Then rebuild native (Metro restart alone is NOT enough on iOS).
//
// Until you ship the fonts, RN silently falls back to system serif/sans —
// the brand still functions, just looks generic. So this file is safe to
// land BEFORE the fonts are in place.
export const FONTS = {
  display:             'Fraunces-Regular',
  displayMedium:       'Fraunces-Medium',
  displaySemi:         'Fraunces-SemiBold',
  displayItalic:       'Fraunces-Italic',
  displayMediumItalic: 'Fraunces-MediumItalic',

  sans:                'Inter-Regular',
  sansMedium:          'Inter-Medium',
  sansSemi:            'Inter-SemiBold',
  sansBold:            'Inter-Bold',

  mono:                'JetBrainsMono-Regular',
  monoMedium:          'JetBrainsMono-Medium',
  monoBold:            'JetBrainsMono-Bold',
} as const;

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const R = { xs: 6, sm: 10, md: 14, lg: 16, xl: 20, pill: 999 } as const;

// ── SHADOWS · cool-tinted (matches petrol family) ─────────────────────
// Shadow color updated from warm amber (#7A5A35) → cool ink (#0F1A1F).
// Keeps depth feeling consistent with the new cool primary.
const _SUBTLE_SHADOW = { shadowColor: '#0F1A1F', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4,  elevation: 1 };

export const Shadow = {
  subtle: _SUBTLE_SHADOW,
  sm:     _SUBTLE_SHADOW, // legacy alias
  card:   { shadowColor: '#0F1A1F', shadowOffset: { width: 0, height: 4  }, shadowOpacity: 0.06, shadowRadius: 12, elevation: 2  },
  lifted: { shadowColor: '#0F1A1F', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.10, shadowRadius: 32, elevation: 6  },
  // Glow inherits petrol so brand-colored buttons "halo" their own color
  glow:   { shadowColor: '#1E5F5C', shadowOffset: { width: 0, height: 6  }, shadowOpacity: 0.22, shadowRadius: 22, elevation: 8  },
};

export const I = { xs: 12, sm: 16, md: 24, lg: 32, xl: 48, display: 56 } as const;

export const O = {
  dark30:  'rgba(0,0,0,0.3)',
  dark50:  'rgba(0,0,0,0.5)',
  white80: 'rgba(255,255,255,0.8)',
  white90: 'rgba(255,255,255,0.9)',
} as const;

// ── STATUS COLOR MAP ──────────────────────────────────────────────────
// Brand tone now uses petrol; everything else preserved.
export const StatusColor = {
  positive: { bg: C.greenLight,  text: C.green,       border: C.greenLight },
  warning:  { bg: C.yellowLight, text: C.yellow,      border: C.yellowLight },
  danger:   { bg: C.redLight,    text: C.red,         border: C.redLight },
  neutral:  { bg: C.bone2,       text: C.text2,       border: C.border },
  brand:    { bg: C.petrolLight, text: C.petrolDeep,  border: C.petrolLight },
  // NEW in v6 — the "act now" tone (sale, ending soon, paid-out, hot)
  hot:      { bg: C.coralLight,  text: C.coralDeep,   border: C.coralLight },
} as const;

export const MIN_TAP = 48;

// ──────────────────────────────────────────────────────────────────────
// HELPERS — preserved verbatim from v4
// ──────────────────────────────────────────────────────────────────────

export function formatPrice(n: number | string | null | undefined): string {
  if (n == null) return '₹0';
  const v = typeof n === 'string' ? parseFloat(n) : n;
  return isNaN(v) ? '₹0' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function percentOff(price: number, mrp: number | null | undefined): number | null {
  if (!mrp || mrp <= price) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}

export function formatDistance(km: number | null | undefined): string {
  if (km == null) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function timeAgo(d: string | null | undefined): string {
  if (!d) return '';
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dy = Math.floor(h / 24);
  if (dy < 30) return `${dy}d ago`;
  return `${Math.floor(dy / 30)}mo ago`;
}

export function condStyle(c: string) {
  switch (c) {
    case 'like_new': return { label: 'Like new', bg: C.petrolLight,   color: C.petrolText };
    case 'good':     return { label: 'Good',     bg: C.greenLight,    color: C.green };
    case 'fair':     return { label: 'Fair',     bg: C.yellowLight,   color: C.yellow };
    default:         return { label: c || 'Used', bg: C.bone2,         color: C.text2 };
  }
}

export function statusTone(status: string | null | undefined):
  'positive' | 'warning' | 'danger' | 'neutral' | 'brand' | 'hot' {
  if (!status) return 'neutral';
  const s = status.toLowerCase();
  if (['completed', 'delivered', 'paid', 'accepted', 'verified', 'processed'].includes(s)) return 'positive';
  if (['pending', 'requested', 'processing', 'in_progress', 'delivery_in_progress', 'at_hub', 'pickup_scheduled', 'picked_up', 'approved'].includes(s)) return 'brand';
  if (['cancelled', 'rejected', 'pickup_rejected', 'failed', 'expired', 'disputed'].includes(s)) return 'danger';
  if (['under_review'].includes(s)) return 'warning';
  if (['ending_soon', 'sale', 'hot', 'flash'].includes(s)) return 'hot';
  return 'neutral';
}

export function prettyStatus(status: string | null | undefined): string {
  if (!status) return '';
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ──────────────────────────────────────────────────────────────────────
// HOME-FEED ACCENTS — folded in from the now-deleted components/theme8.ts.
// All values v6-aligned (the legacy theme8 still emitted v4 warm-amber
// hex, which is why home surfaces visibly diverged from the rest of the
// app until 2026-05-02).
//
// Keep these few; resist the urge to add more. Brand cohesion comes
// from the petrol primary + coral accent + bone canvas trio — that's
// it. Anything else and the app starts to feel stitched together.
// ──────────────────────────────────────────────────────────────────────
export const Home = {
  // Blockbuster deals — coral family, the v6 "spotlight / act now" surface
  dealsBgStart:    C.coralLight,
  dealsBgEnd:      '#FAD9CB',
  dealsAccent:     C.coralDeep,
  dealsTitleText:  C.coralDeep,
  dealsSubtitle:   C.coralDeep,
  dealsBadgeBg:    C.coral,
  dealsBadgeText:  C.white,
  dealsCardShadow: 'rgba(15, 26, 31, 0.10)',

  // Sell block — petrol family (trust + grow)
  sellBgStart:     C.petrolLight,
  sellBgEnd:       C.aquaLight,
  sellAccent:      C.petrol,
  sellTitle:       C.petrolDeep,
  sellCtaBg:       C.petrol,
  sellCtaText:     C.white,

  // Owmee Verified badge — petrol family
  verifiedBg:      C.petrolLight,
  verifiedText:    C.petrolText,
  verifiedDot:     C.petrolMid,

  // Ship indicator — petrol
  shipText:        C.petrol,
} as const;

const HOME_CARD_BGS = [
  C.cardBgGray, C.cardBgMauve, C.cardBgGreen,
  C.cardBgPeach, C.cardBgAmber, C.cardBgStone,
];

/** Card background for masonry feed — index-stable so cards don't
 *  re-color across re-renders. */
export function pickCardBg(index: number): string {
  return HOME_CARD_BGS[((index % HOME_CARD_BGS.length) + HOME_CARD_BGS.length) % HOME_CARD_BGS.length];
}

/** Alternating aspect ratios for masonry feel (every 3rd card is taller). */
export function pickAspectRatio(index: number): number {
  return index % 3 === 0 ? 4 / 5 : 1;
}

// ──────────────────────────────────────────────────────────────────────
// SEMANTIC LAYER (NEW — prefer for new code)
// Palette-swap-stable. Use these instead of raw C.* in new code.
// ──────────────────────────────────────────────────────────────────────
export const theme = {
  // backgrounds
  bg:            C.bone,
  bgRaised:      C.surface,
  bgInverse:     C.inkBg,
  bgAccent:      C.bone2,

  // text
  textPrimary:   C.ink,
  textSecondary: C.text2,
  textTertiary:  C.text3,
  textOnDark:    C.onDark1,
  textOnBrand:   '#FFFFFF',

  // brand
  brand:         C.petrol,
  brandHover:    C.petrolDeep,
  brandFaint:    C.petrolLight,
  brandText:     C.petrolText,

  // accent (the spotlight color — once per screen)
  accent:        C.coral,
  accentFaint:   C.coralLight,
  accentText:    C.coralDeep,

  // status
  success:       C.green,
  successFaint:  C.greenLight,
  warn:          C.yellow,
  warnFaint:     C.yellowLight,
  danger:        C.red,
  dangerFaint:   C.redLight,

  // hairlines
  border:        C.border,
  borderSoft:    C.border2,
} as const;

export type Theme = typeof theme;
