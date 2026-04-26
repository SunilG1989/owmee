/**
 * Owmee Design Tokens
 *
 * Direction A (trust-first minimal) + C warmth + B premium accents
 * Frozen from design review v3.
 *
 * Rules:
 * - Teal = trust, verified, all primary actions
 * - Warm orange = kids section ONLY, never primary
 * - Ink = hero cards, premium electronics only
 * - Never mix warm orange with teal on same component
 */

export const Colors = {
  // ── Primary trust color
  teal: '#0F6E56',
  tealMid: '#1D9E75',
  tealLight: '#E1F5EE',
  tealText: '#0a5240',

  // ── Warmth — kids section only
  warm: '#FF6B35',
  warmLight: '#FFF3EC',
  warmMid: '#FF8C5E',

  // ── Kids accent (slightly softer than warm)
  kids: '#FF9A5C',
  kidsLight: '#FFF5EF',
  kidsBg: '#FFF0E8',    // slightly deeper kids bg for chips

  // ── Premium / hero dark (B-style, used sparingly)
  ink: '#111218',
  ink2: '#1E1E28',

  // ── Neutrals
  white: '#FFFFFF',
  bg: '#F7F5F2',       // warm off-white — not cold gray
  surface: '#FFFFFF',
  border: '#EBEBEB',
  border2: '#F4F4F4',

  // ── Text
  text: '#111111',
  text2: '#555555',
  text3: '#888888',
  text4: '#BBBBBB',

  // ── Status
  success: '#15803D',
  successLight: '#F0FDF4',
  warning: '#B45309',
  warningLight: '#FFFBEB',
  error: '#DC2626',
  errorLight: '#FEF2F2',

  // ── Transparent overlays
  overlay: 'rgba(0,0,0,0.45)',
  overlayLight: 'rgba(0,0,0,0.08)',
} as const;

export const Typography = {
  // Font families
  sans: 'DMSans-Regular',
  sansMedium: 'DMSans-Medium',
  sansLight: 'DMSans-Light',
  mono: 'DMM-Regular', // prices, codes only

  // Scale
  size: {
    xs: 9,
    sm: 11,
    base: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    display: 30,
  },

  // Line heights
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.7,
  },
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  screen: 16, // standard horizontal screen padding
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  full: 999,
  card: 14,
  pill: 20,
  phone: 34,
} as const;

export const Shadow = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  modal: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 10,
  },
} as const;

// ── Semantic tokens built on primitives

export const Theme = {
  // Backgrounds
  bgScreen: Colors.bg,
  bgCard: Colors.surface,
  bgInput: '#F5F5F3',
  bgTealSubtle: Colors.tealLight,
  bgKids: Colors.kidsLight,
  bgInk: Colors.ink,

  // Text
  textPrimary: Colors.text,
  textSecondary: Colors.text2,
  textMuted: Colors.text3,
  textHint: Colors.text4,
  textTeal: Colors.teal,
  textKids: Colors.kids,
  textOnDark: Colors.white,

  // Borders
  borderDefault: Colors.border,
  borderSubtle: Colors.border2,
  borderTeal: Colors.teal,
  borderKids: 'rgba(255,154,92,0.25)',

  // CTAs
  btnPrimary: Colors.teal,
  btnPrimaryText: Colors.white,
  btnOutlineText: Colors.teal,
  btnOutlineBorder: Colors.teal,
  btnKids: Colors.kids,

  // Nav
  navActive: Colors.teal,
  navInactive: Colors.text4,
  navActiveKids: Colors.kids,
} as const;
