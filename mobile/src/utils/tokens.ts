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
  // ── PRIMARY · WARM ROSE PINK (v18d Boutique Rose) ────────────────────
  // Tira/Glossier school: medium-saturation warm pink that pops on
  // cream without being neon. Distinctly premium, NOT dark, NOT washed
  // out. Heading + button now READ AS DIFFERENT COLORS so the hero has
  // proper hierarchy (dark headline, pink CTA) instead of brand-monotone.
  petrol:        '#D87290',  // warm rose pink — primary CTAs
  petrolLight:   '#F8E5EC',  // soft rose wash — selected state
  petrolMid:     '#B85775',  // pressed
  petrolGlow:    '#7A6B72',  // warm rose-taupe — secondary text
  petrolDeep:    '#9C4A63',  // deepest pressed
  petrolText:    '#D87290',
  petrolNight:   '#2D1F2A',  // warm deep plum inverse

  // ── SECONDARY · warm rose-taupe text/icons ───────────────────────────
  aqua:          '#7A6B72',
  aquaLight:     '#F8E5EC',
  aquaDeep:      '#2D1F2A',

  // ── ACCENT · same rose family — single-color system ──────────────────
  coral:         '#D87290',
  coralLight:    '#F8E5EC',
  coralDeep:     '#B85775',
  coralBright:   '#D87290',

  // ── TRUST CHIP PALETTE — warm cream family + semantic green/amber ───
  mintSoft:      '#FBEDE0',  // verifiedBg — warm cream
  mintBorder:    '#F0E0D0',  // warm peach hairline
  blueSoft:      '#FBEDE0',  // unified — single warm family
  blueDeep:      '#A85F54',  // verified text uses brand pressed
  blueBorder:    '#F0E0D0',
  amberSoft:     '#FFF2E6',  // offerBg
  amberDeep:     '#D97706',  // offerText
  amberBorder:   '#F0E0D0',

  // ── SURFACES · warm linen + LIGHTER peach hero (v18c) ───────────────
  bone:          '#FFF6EC',  // bgApp — warm linen cream
  bone2:         '#FBEDE0',  // bgSoft
  cream:         '#FDEDE5',  // bgHero — lighter peach (lifted from #FBE0D5)
  sand:          '#FBEDE0',
  surface:       '#FFFFFF',

  // Dark surfaces (inverse contexts — receipts, FE night ops)
  inkBg:         '#172033',
  inkBg2:        '#1F2A40',
  inkBg3:        '#2A3754',

  // ── INK · warm deep plum (v18d Boutique Rose) ────────────────────────
  ink:           '#2D1F2A',
  ink2:          '#3D2A35',

  // ── TEXT scale · warm rose-taupe family ─────────────────────────────
  text:          '#2D1F2A',  // textPrimary — warm deep plum (NOT navy/black)
  text2:         '#7A6B72',  // textSecondary — warm rose-taupe
  text3:         '#A8979F',  // textMuted — pale rose-taupe
  text4:         '#D4C9CE',

  onDark1:       '#FFFFFF',
  onDark2:       'rgba(255, 255, 255, 0.78)',
  onDark3:       'rgba(255, 255, 255, 0.52)',

  // ── LINES — warm peach hairlines (v18 Warm Boutique) ─────────────────
  border:        '#E4C9B6',  // borderStrong — warm peach
  border2:       '#F0E0D0',  // borderSoft — soft peach
  borderDark:    'rgba(255, 246, 236, 0.10)',

  // ── SEMANTIC ─────────────────────────────────────────────────────────
  red:           '#C2473A',
  redLight:      '#FFF0EE',
  green:         '#2F6F46',  // conditionText
  greenLight:    '#EEF8F0',  // conditionBg
  yellow:        '#D97706',  // offerText
  yellowLight:   '#FFF2E6',  // offerBg

  white:         '#FFFFFF',

  // ── CARD ACCENT BACKGROUNDS — all collapse to coral-soft / cream ────
  cardBgGray:    '#FFF4EE',
  cardBgMauve:   '#FFF1EB',
  cardBgGreen:   '#FFE8E1',
  cardBgPeach:   '#FBEDE7',
  cardBgAmber:   '#FFF2E6',
  cardBgStone:   '#FFF4EE',
  cardBgPastel:  '#FFF1EB',

  // ── LEGACY ALIASES — old names → v16 locked values ──────────────────
  honey:         '#D87290',  // → warm rose pink
  honeyLight:    '#F8E5EC',
  honeyGlow:     '#7A6B72',
  honeyDeep:     '#B85775',
  honeyText:     '#D87290',

  forest:        '#D87290',
  forestLight:   '#F8E5EC',
  forestVivid:   '#B85775',
  forestText:    '#D87290',

  primary:       '#D87290',  // → warm rose pink
  muted:         '#A8979F',
  danger:        '#C2473A',
  success:       '#2F6F46',
  successBg:     '#EEF8F0',
  bg:            '#FFF6EC',
  surfaceMuted:  '#FBEDE0',
  amber:         '#D87290',
  amberLight:    '#F8E5EC',
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
const _SUBTLE_SHADOW = { shadowColor: '#3D2A21', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 };

export const Shadow = {
  subtle: _SUBTLE_SHADOW,
  sm:     _SUBTLE_SHADOW,
  card:   { shadowColor: '#3D2A21', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  lifted: { shadowColor: '#3D2A21', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.10, shadowRadius: 18, elevation: 4 },
  // Single warm-rose glow for all CTAs (single-color brand)
  glow:      { shadowColor: '#D87290', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.20, shadowRadius: 14, elevation: 4 },
  coralGlow: { shadowColor: '#D87290', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.20, shadowRadius: 14, elevation: 4 },
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

  // ── Hero card — lighter peach #FDEDE5 + rose accents ───────────────
  heroBg:          C.cream,                    // bgHero #FDEDE5
  heroSubText:     'rgba(122, 107, 114, 1)',  // textSecondary rose-taupe
  heroStepBg:      'rgba(216, 114, 144, 0.08)',  // rose tint
  heroStepBorder:  'rgba(216, 114, 144, 0.22)',  // rose hairline
  heroArrow:       'rgba(45, 31, 42, 0.55)',  // deep plum arrow

  // Trust chips below search — three color families, one per trust pillar.
  chipMintBg:      C.mintSoft,
  chipMintBorder:  C.mintBorder,
  chipMintIcon:    C.petrol,
  chipBlueBg:      C.blueSoft,
  chipBlueBorder:  C.blueBorder,
  chipBlueIcon:    C.blueDeep,
  chipAmberBg:     C.amberSoft,
  chipAmberBorder: C.amberBorder,
  chipAmberIcon:   C.amberDeep,

  // Hero decorative vignette — a small shield+package+phone composition
  // in the top-right of the hero card. These values are intentionally
  // off the main palette (warm cardboard, near-white plastic, mint glow)
  // so the vignette reads as illustration rather than UI chrome.
  heroDecorShield:  '#DFF7EF',
  heroDecorPackage: '#C99B64',
  heroDecorPhone:   '#F4F6F5',
  heroDecorRing:    'rgba(95,184,168,0.36)',
  heroDecorRingDim: 'rgba(95,184,168,0.22)',
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
