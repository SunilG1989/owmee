// Owmee design tokens — Direction A base + C warmth + B premium accents
// India-first: trust signals, warm off-white, DM Sans

export const colors = {
  teal: '#0F6E56',
  tealMid: '#1D9E75',
  tealLight: '#E1F5EE',
  tealText: '#0a5240',
  warm: '#FF6B35',
  warmLight: '#FFF3EC',
  ink: '#111218',
  ink2: '#1e1e28',
  kids: '#FF9A5C',
  kidsBg: '#FFF5EF',
  white: '#FFFFFF',
  bg: '#f7f5f2',
  surface: '#FFFFFF',
  border: '#ebebeb',
  border2: '#f4f4f4',
  text: '#111111',
  text2: '#555555',
  text3: '#888888',
  text4: '#bbbbbb',
  success: '#15803d',
  successLight: '#f0fdf4',
  error: '#DC2626',
  errorLight: '#FEF2F2',
  warning: '#D97706',
  warningLight: '#FFFBEB',
} as const;

export const typography = {
  sizes: {
    xs: 9,
    sm: 11,
    base: 12,
    md: 14,
    lg: 16,
    xl: 18,
    xxl: 22,
    display: 28,
  },
  weights: {
    light: '300' as const,
    regular: '400' as const,
    medium: '500' as const,
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  hero: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
} as const;
