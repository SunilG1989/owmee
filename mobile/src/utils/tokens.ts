/**
 * Owmee Design Tokens — Alive v3
 * Warm amber + deep forest. Cream surfaces. Indian-first.
 */

export const C = {
  honey: '#E8920D', honeyLight: '#FFF8EB', honeyGlow: '#FFCF4A',
  honeyDeep: '#C27A08', honeyText: '#8B5A06',
  forest: '#1A5C3A', forestLight: '#E4F2EA', forestVivid: '#22855A', forestText: '#134A2E',
  cream: '#FEFBF4', sand: '#F5F0E6', surface: '#FFFFFF',
  ink: '#1A1812', ink2: '#2D2A22',
  text: '#1A1812', text2: '#5C5647', text3: '#9A9285', text4: '#C4BDB0',
  border: '#EDE8DC', border2: '#F2EFEA',
  red: '#D14343', redLight: '#FEF0F0',
  green: '#1D8348', greenLight: '#E8F6EE',
  yellow: '#D4A017', yellowLight: '#FDF8E8',
  white: '#FFFFFF',
} as const;

export const T = {
  size: { xs: 10, sm: 11, base: 13, md: 15, lg: 17, xl: 20, xxl: 24, display: 30 },
  weight: { regular: '400' as const, medium: '500' as const, semi: '600' as const, bold: '700' as const, heavy: '800' as const },
} as const;

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const R = { xs: 6, sm: 10, md: 14, lg: 16, xl: 20, pill: 999 } as const;

export const Shadow = {
  card: { shadowColor: '#8B7355', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
  lifted: { shadowColor: '#8B7355', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 6 },
  glow: { shadowColor: '#E8920D', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 5 },
};

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
    case 'like_new': return { label: 'Like new', bg: C.forestLight, color: C.forest };
    case 'good': return { label: 'Good', bg: C.greenLight, color: C.green };
    case 'fair': return { label: 'Fair', bg: C.yellowLight, color: C.yellow };
    default: return { label: c || 'Used', bg: C.sand, color: C.text3 };
  }
}
