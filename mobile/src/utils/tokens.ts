/**
 * Owmee Design Tokens — v21 "Warm Trust Pastels"
 *
 * Drop-in replacement for mobile/src/utils/tokens.ts.
 * Preserves every export from v4/v6/v18 (C, T, S, R, Shadow, I, O,
 * StatusColor, MIN_TAP, formatPrice, percentOff, formatDistance,
 * timeAgo, condStyle, statusTone, prettyStatus) so existing screens
 * compile unchanged.
 *
 * Direction:
 *   - Primary: muted trust blue #4F7F86 for verification and safety.
 *   - Accent: warm pastel clay #D7A89E, usually as a soft CTA surface.
 *   - Canvas: warm ivory #FFF8EE with quiet parchment borders.
 *   - Text: ink navy #172033 for stronger readability than rose-plum.
 *
 * Migration philosophy:
 *   - Every legacy NAME (C.honey, C.forest, C.cream, etc.) still works.
 *     They now point at the v21 semantic palette so older screens render
 *     the new brand without call-site edits.
 *   - For new code, prefer the semantic layer at the bottom
 *     (theme.brand, theme.accent, theme.bg, etc.).
 */

export const C = {
  // ── PRIMARY · LOGO TRUST TEAL ────────────────────────────────────────
  petrol:        '#245E56',  // trust actions and verified states
  petrolLight:   '#EAF4F1',  // selected state / light trust surface
  petrolMid:     '#6A9D94',  // trust icon / small emphasis
  petrolGlow:    '#CFE3DE',  // highlights and focus halo
  petrolDeep:    '#1E4F49',  // pressed / readable brand surface
  petrolText:    '#245E56',  // readable trust text on light surfaces
  petrolNight:   '#172033',  // inverse/navy text
  splashBg:      '#003F4B',  // logo-matched native/JS splash background

  // ── SECONDARY · AQUA SUPPORT ────────────────────────────────────────
  aqua:          '#91B6B0',
  aquaLight:     '#F1F8F6',
  aquaDeep:      '#4B7280',

  // ── ACCENT · WARM PASTEL CLAY ──────────────────────────────────────
  coral:         '#D7A89E',
  coralLight:    '#FBE9E2',
  coralDeep:     '#6E4C45',
  coralBright:   '#D7A89E',
  wordmarkCoral: '#B85E42',
  wordmarkTeal:  '#245E56',
  wordmarkOrangeTop: '#C97861',
  wordmarkOrangeMid: '#B85E42',
  wordmarkOrangeBase: '#6E4C45',
  wordmarkOrangeBoost: '#B85E42',
  wordmarkOrangeRim: '#5F3A34',

  // ── ACTIONS · LOGO/HOME CTA SYSTEM ──────────────────────────────────
  ctaPrimary:        '#245E56',
  ctaPrimaryPressed: '#1E4F49',
  ctaPrimarySoft:    '#EAF4F1',
  ctaPrimaryBorder:  '#CFE3DE',
  ctaSecondary:      '#C97861',
  ctaSecondaryDeep:  '#8F5749',
  ctaSecondarySoft:  '#FFF0E8',
  ctaDisabledBg:     '#F7EFE7',
  ctaDisabledBorder: '#EBDCCD',
  ctaDisabledText:   '#8A949E',

  // ── TRUST CHIP PALETTE ──────────────────────────────────────────────
  mintSoft:      '#EDF8EF',
  mintBorder:    '#D4EBDD',
  blueSoft:      '#F1F8F6',
  blueDeep:      '#4B7280',
  blueBorder:    '#DDEBE8',
  amberSoft:     '#FFF5E8',
  amberDeep:     '#92570C',
  amberBorder:   '#EBCAB1',

  // ── SURFACES · WARM IVORY + POWDER HERO ─────────────────────────────
  bone:          '#FFF8EE',  // app canvas: warm ivory from final home preview
  bone2:         '#F3E4D4',  // raised clay wash, used sparingly
  cream:         '#EAF4F1',  // soft teal tail of the home background
  sand:          '#F7EFE7',
  surface:       '#FFFDF8',

  // Dark surfaces (inverse contexts — receipts, FE night ops)
  inkBg:         '#172033',
  inkBg2:        '#1F2B3F',
  inkBg3:        '#2B3A54',

  // ── INK · READABLE NAVY ─────────────────────────────────────────────
  ink:           '#172033',
  ink2:          '#243042',

  // ── TEXT SCALE ──────────────────────────────────────────────────────
  text:          '#172033',
  text2:         '#5E6A75',
  text3:         '#67727E',
  text4:         '#8A949E',

  onDark1:       '#FFFFFF',
  onDark2:       'rgba(255, 255, 255, 0.78)',
  onDark3:       'rgba(255, 255, 255, 0.52)',

  // ── LINES ───────────────────────────────────────────────────────────
  border:        '#EBDCCD',
  border2:       '#F3E7DC',
  borderDark:    'rgba(255, 250, 244, 0.12)',

  // ── SEMANTIC ─────────────────────────────────────────────────────────
  red:           '#B33A2F',
  redLight:      '#FFF0EE',
  green:         '#2F7D4C',
  greenLight:    '#EDF8EF',
  yellow:        '#92570C',
  yellowLight:   '#FFF3DC',

  white:         '#FFFFFF',

  // ── CARD ACCENT BACKGROUNDS ─────────────────────────────────────────
  cardBgGray:    '#F5F1EA',
  cardBgMauve:   '#F5EEF3',
  cardBgGreen:   '#EAF6F1',
  cardBgPeach:   '#FFF0E8',
  cardBgAmber:   '#FFF5E8',
  cardBgStone:   '#EFF3F5',
  cardBgPastel:  '#EAF2FF',

  // ── LEGACY ALIASES — old names → v21 values ─────────────────────────
  honey:         '#245E56',
  honeyLight:    '#EAF4F1',
  honeyGlow:     '#CFE3DE',
  honeyDeep:     '#1E4F49',
  honeyText:     '#245E56',

  forest:        '#245E56',
  forestLight:   '#EAF4F1',
  forestVivid:   '#6A9D94',
  forestText:    '#245E56',

  primary:       '#245E56',
  muted:         '#67727E',
  danger:        '#B33A2F',
  success:       '#2F7D4C',
  successBg:     '#EDF8EF',
  bg:            '#FFF8EE',
  surfaceMuted:  '#F3E4D4',
  amber:         '#C7A096',
  amberLight:    '#FFF7F3',
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

// ── SHADOWS · ink-tinted, low opacity ─────────────────────────────────
const _SUBTLE_SHADOW = { shadowColor: '#172033', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 };

export const Shadow = {
  subtle: _SUBTLE_SHADOW,
  sm:     _SUBTLE_SHADOW,
  card:   { shadowColor: '#172033', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 },
  lifted: { shadowColor: '#172033', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.10, shadowRadius: 18, elevation: 4 },
  glow:      { shadowColor: '#245E56', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 14, elevation: 4 },
  coralGlow: { shadowColor: '#C97861', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.09, shadowRadius: 10, elevation: 1 },
};

export const I = { xs: 12, sm: 16, md: 24, lg: 32, xl: 48, display: 56 } as const;

export const O = {
  dark30:  'rgba(0,0,0,0.3)',
  dark50:  'rgba(0,0,0,0.5)',
  white80: 'rgba(255,255,255,0.8)',
  white90: 'rgba(255,255,255,0.9)',
} as const;

// ── STATUS COLOR MAP ──────────────────────────────────────────────────
// Brand tone uses warm trust blue; hot tone uses quiet warm taupe.
export const StatusColor = {
  positive: { bg: C.greenLight,  text: C.green,       border: C.greenLight },
  warning:  { bg: C.yellowLight, text: C.yellow,      border: C.yellowLight },
  danger:   { bg: C.redLight,    text: C.red,         border: C.redLight },
  neutral:  { bg: C.bone2,       text: C.text2,       border: C.border },
  brand:    { bg: C.petrolLight, text: C.petrolDeep,  border: C.petrolLight },
  // "Act now" tone (sale, ending soon, paid-out, hot)
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
// All values v21-aligned so home, listings, checkout, and admin render
// from the same warm trust pastel system.
//
// Keep these few; resist the urge to add more. Brand cohesion comes
// from the warm trust blue + warm taupe + ivory canvas trio — that's
// it. Anything else and the app starts to feel stitched together.
// ──────────────────────────────────────────────────────────────────────
export const Home = {
  // Blockbuster deals — pastel apricot family, the spotlight / act-now surface
  dealsBgStart:    C.coralLight,
  dealsBgEnd:      '#FFE9DE',
  dealsAccent:     C.coralDeep,
  dealsTitleText:  C.coralDeep,
  dealsSubtitle:   C.coralDeep,
  dealsBadgeBg:    C.coralLight,
  dealsBadgeText:  C.coralDeep,
  dealsCardShadow: 'rgba(15, 26, 31, 0.10)',

  // Sell block — powder blue family (trust + grow)
  sellBgStart:     C.petrolLight,
  sellBgEnd:       C.aquaLight,
  sellAccent:      C.petrol,
  sellTitle:       C.petrolDeep,
  sellCtaBg:       C.petrol,
  sellCtaText:     C.white,

  // Owmee Verified badge — powder blue family
  verifiedBg:      C.petrolLight,
  verifiedText:    C.petrolText,
  verifiedDot:     C.petrolMid,

  // Ship indicator — powder blue
  shipText:        C.petrol,

  // ── Hero card — warm powder trust surface ───────────────────────────
  heroBg:          C.cream,
  heroSubText:     'rgba(103, 114, 126, 1)',
  heroStepBg:      'rgba(79, 127, 134, 0.08)',
  heroStepBorder:  'rgba(79, 127, 134, 0.18)',
  heroArrow:       'rgba(23, 32, 51, 0.55)',

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
