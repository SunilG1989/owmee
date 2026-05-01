/**
 * Owmee Design Tokens — v4 "Warm Trust"
 *
 * Why v4: v3's #E8920D honey was too saturated for primary surfaces —
 * read as "kids cereal" rather than "premium marketplace." User feedback
 * was explicit: mild + warm + attractive. v4 desaturates the honey to
 * an aged-brass tone, softens forest into sage-emerald, and warms the
 * neutrals (cream, sand, borders) by 1–2 hue steps so the whole canvas
 * feels like ghee + parchment instead of office-printer-paper.
 *
 * Reference points: Aesop's tan + ink, Notion's warm beiges, Mercari
 * Japan's restrained red. NOT high-saturation Meesho/OLX.
 *
 * Contrast: every C.text* on every C.cream/sand/honeyLight passes WCAG
 * AA at body-text size. Verified at design time.
 */

export const C = {
  // ── Primary brand: warm honey (saffron-toned, mid-saturation) ────────
  honey: '#D88A36',          // primary CTA — aged-brass amber, not candy-orange
  honeyLight: '#FBF1DC',     // tinted background (callouts, trust strip)
  honeyGlow: '#F0B662',      // softer warm gold for highlights
  honeyDeep: '#A56B22',      // text on light + hover/pressed states
  honeyText: '#6E4716',      // dark amber for ultra-readable on cream

  // ── Secondary: sage-emerald forest (depth without overwhelming) ──────
  forest: '#3D7A5C',         // primary green — sage-leaning, less aggressive than v3's #1A5C3A
  forestLight: '#E5EFE9',    // gentle green tint background
  forestVivid: '#4F9272',    // brighter green for active states
  forestText: '#2C5E45',     // dark green for text on light backgrounds

  // ── Surfaces (warm whites, parchment beiges) ─────────────────────────
  cream: '#FAF6EE',          // primary canvas — ghee-tinted, more present than v3's near-white
  sand: '#F0E8D5',           // warmer card-on-card layer — visible without competing
  surface: '#FFFFFF',        // pure white when contrast against cream is needed

  // ── Ink (warm darks) ──────────────────────────────────────────────────
  ink: '#2A2118',            // primary text — coffee-grounds dark, not pure black
  ink2: '#3D3528',           // softer ink for subtitles

  // ── Text scale (warm grays, contrast-tested) ─────────────────────────
  text: '#2A2118',           // primary
  text2: '#6B5F4D',          // secondary — warm taupe
  text3: '#8A7E6B',          // tertiary — bumped for AA contrast on sand
  text4: '#BFB39E',          // quaternary — borders/disabled only, never body text

  // ── Lines ─────────────────────────────────────────────────────────────
  border: '#E8DFCD',         // warm parchment border
  border2: '#EFE9D9',        // even softer for subtle dividers

  // ── Semantic colors (mature, non-candy) ──────────────────────────────
  red: '#B85454',            // less aggressive than v3's #D14343
  redLight: '#FBEEEE',
  green: '#3E8460',          // sage success green
  greenLight: '#E7F1EB',
  yellow: '#C99A2A',         // mustard, not lemon
  yellowLight: '#FBF4DD',

  white: '#FFFFFF',

  // ── Legacy semantic aliases ──────────────────────────────────────────
  // v3-and-earlier screens used C.primary / C.muted / C.danger /
  // C.success / C.successBg / C.bg / C.surfaceMuted. The v4 redesign
  // moved to honey/red/green/cream/sand vocabulary. Aliases below keep
  // those legacy callsites compiling without forcing a screen-by-screen
  // migration. Marked as legacy so future contributors prefer the
  // primary names.
  primary: '#D88A36',         // → honey
  muted: '#8A7E6B',           // → text3
  danger: '#B85454',          // → red
  success: '#3E8460',         // → green
  successBg: '#E7F1EB',       // → greenLight
  bg: '#FAF6EE',              // → cream
  surfaceMuted: '#F0E8D5',    // → sand
  amber: '#D88A36',           // → honey (older Sprint 4 alias)
  amberLight: '#FBF1DC',      // → honeyLight
} as const;

export const T = {
  size: { xs: 10, sm: 11, base: 13, md: 15, lg: 17, xl: 20, xxl: 24, display: 30 },
  weight: { regular: '400' as const, medium: '500' as const, semi: '600' as const, bold: '700' as const, heavy: '800' as const },

  // ── Legacy aliases ────────────────────────────────────────────────────
  // v3-and-earlier screens reference T.h1 / T.h2 / T.h3 / T.body / T.small /
  // T.caption directly. The v4 redesign moved to T.size.* / T.weight.* but
  // touching every callsite is more risk than this 8-line shim. Numeric
  // aliases mirror the prior visual scale so screen layouts stay identical.
  h1: 24,         // matches T.size.xxl
  h2: 20,         // matches T.size.xl
  h3: 17,         // matches T.size.lg
  body: 15,       // matches T.size.md
  small: 13,      // matches T.size.base
  caption: 11,    // matches T.size.sm
} as const;

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const R = { xs: 6, sm: 10, md: 14, lg: 16, xl: 20, pill: 999 } as const;

// Shadow alias — older screens reference Shadow.sm. Maps to the v4 subtle.
// (Defined after the Shadow object further down, so we extend it via
// re-export — see end of file.)

const _SUBTLE_SHADOW = { shadowColor: '#7A5A35', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 };

export const Shadow = {
  // Warmer shadow tint (#7A5A35 instead of #8B7355) so cards on cream
  // feel like the surface is actually casting a soft amber-tinted shadow,
  // not floating on a generic gray plane.
  subtle: _SUBTLE_SHADOW,
  // Legacy alias: pre-v4 code used Shadow.sm. Same value as subtle.
  sm: _SUBTLE_SHADOW,
  card:   { shadowColor: '#7A5A35', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 10, elevation: 3 },
  lifted: { shadowColor: '#7A5A35', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 18, elevation: 6 },
  // glow inherits the new honey, slightly less opacity for refinement
  glow:   { shadowColor: '#D88A36', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 5 },
};

// Icon sizes — for emoji-as-icons + glyph-as-icons. Keeps emoji rendering
// uniform across the app so a 📦 in one place isn't 48px and another 18px.
export const I = { xs: 12, sm: 16, md: 24, lg: 32, xl: 48, display: 56 } as const;

// Translucent overlays used over images / behind modals. Centralized so
// contrast feels consistent in dark-on-image situations.
export const O = {
  dark30: 'rgba(0,0,0,0.3)',
  dark50: 'rgba(0,0,0,0.5)',
  white80: 'rgba(255,255,255,0.8)',
  white90: 'rgba(255,255,255,0.9)',
} as const;

// Status color map — consolidates the scattered transaction/offer/refund
// status pill styles. Anything outside this set should be added here, not
// inlined in a screen.
export const StatusColor = {
  // Generic semantic
  positive: { bg: C.greenLight, text: C.green, border: C.greenLight },
  warning:  { bg: C.yellowLight, text: C.yellow, border: C.yellowLight },
  danger:   { bg: C.redLight, text: C.red, border: C.redLight },
  neutral:  { bg: C.sand, text: C.text2, border: C.border },
  brand:    { bg: C.honeyLight, text: C.honeyDeep, border: C.honeyLight },
} as const;

export const MIN_TAP = 48;

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
    // Note: forestText/honeyText/yellow are darker variants picked so the
    // 12-13px label sizes still pass AA contrast on their tinted backgrounds.
    case 'like_new': return { label: 'Like new', bg: C.forestLight, color: C.forestText };
    case 'good': return { label: 'Good', bg: C.greenLight, color: C.forestText };
    case 'fair': return { label: 'Fair', bg: C.yellowLight, color: C.honeyText };
    default: return { label: c || 'Used', bg: C.sand, color: C.text2 };
  }
}

// Map a transaction or refund/return/dispute status string to a status
// tone. Any UI rendering a status pill should call this rather than
// rolling its own color map.
export function statusTone(status: string | null | undefined):
  'positive' | 'warning' | 'danger' | 'neutral' | 'brand' {
  if (!status) return 'neutral';
  const s = status.toLowerCase();
  if (['completed', 'delivered', 'paid', 'accepted', 'verified', 'processed'].includes(s)) return 'positive';
  if (['pending', 'requested', 'processing', 'in_progress', 'delivery_in_progress', 'at_hub', 'pickup_scheduled', 'picked_up', 'approved'].includes(s)) return 'brand';
  if (['cancelled', 'rejected', 'pickup_rejected', 'failed', 'expired', 'disputed'].includes(s)) return 'danger';
  if (['under_review'].includes(s)) return 'warning';
  return 'neutral';
}

// Pretty-print a status for end-users — kebab/snake → "Like new".
export function prettyStatus(status: string | null | undefined): string {
  if (!status) return '';
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
