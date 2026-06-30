/**
 * Owmee IconButton — single source of truth for icon-only tap targets.
 *
 * Use this anywhere a screen would otherwise reach for a raw
 * <TouchableOpacity> wrapping a single glyph/emoji (back arrow, close,
 * heart/favorite, share, scroll-to-top, ...).
 *
 *   variants
 *     solid      petrol-filled circle, used for primary affordances on
 *                photo overlays / dark backgrounds
 *     ghost      transparent — default for in-toolbar / on-card actions
 *     outlined   white surface + hairline border — used on light cards
 *                where ghost would feel ambiguous
 *     floating   compact frosted surface for image/header overlays
 *     onDark     transparent icon on dark/brand surfaces
 *     danger     red — destructive ("remove", "block")
 *
 *   sizes
 *     sm  36px — table-row / dense toolbar
 *     md  48px (MIN_TAP) — default
 *     overlay 44px — visible image/header overlay with >=48px hit target
 *     lg  56px — rare prominent actions
 *
 * sm gets a hitSlop of 6 on each side so the effective tap area still
 * meets the 48px guideline. md/lg already meet it natively.
 */
import React from 'react';
import {
  ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, ViewStyle, StyleProp,
} from 'react-native';
import {
  AlertTriangle,
  ChevronLeft,
  Heart,
  History,
  MoreVertical,
  Package,
  Plus,
  RefreshCw,
  Search,
  Share2,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { C, MIN_TAP, Shadow, T } from '../../utils/tokens';

export type IconButtonVariant = 'solid' | 'ghost' | 'outlined' | 'floating' | 'danger' | 'onDark';
export type IconButtonSize = 'sm' | 'md' | 'overlay' | 'lg';

interface Props {
  /** Emoji or single glyph (←, ✕, ↗, ♥, etc). */
  icon: string;
  onPress: () => void;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Mandatory — icon-only buttons must have a screen-reader label. */
  a11y: string;
}

export default function IconButton({
  icon, onPress,
  variant = 'ghost', size = 'md',
  disabled = false, loading = false,
  style, a11y,
}: Props) {
  const isInactive = disabled || loading;
  const isDisabled = disabled && !loading;
  const sz = SIZES[size];
  const v = VARIANTS[variant];
  const dim = sz.dim;
  const iconColor = isDisabled ? C.ctaDisabledText : v.iconColor;
  const Lucide = iconForGlyph(icon);
  const shouldFill = icon === '♥';
  const compactHitSlop = size === 'sm'
    ? { top: 6, bottom: 6, left: 6, right: 6 }
    : size === 'overlay'
      ? { top: 4, bottom: 4, left: 4, right: 4 }
      : undefined;
  return (
    <TouchableOpacity
      onPress={loading ? undefined : onPress}
      disabled={isInactive}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      hitSlop={compactHitSlop}
      style={[
        styles.base,
        { width: dim, height: dim, borderRadius: dim / 2 },
        v.container,
        style,
        isDisabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : Lucide ? (
        <Lucide
          size={sz.glyph}
          color={iconColor}
          strokeWidth={2.35}
          fill={shouldFill ? iconColor : 'none'}
        />
      ) : (
        <Text
          style={[
            styles.glyph,
            { fontSize: sz.glyph, color: iconColor },
            isDisabled && styles.disabledGlyph,
          ]}
          allowFontScaling={false}
        >
          {icon}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const SIZES: Record<IconButtonSize, { dim: number; glyph: number }> = {
  sm:      { dim: 36,      glyph: 18 },
  md:      { dim: MIN_TAP, glyph: 21 },
  overlay: { dim: 44,      glyph: 21 },
  lg:      { dim: 56,      glyph: 24 },
};

const VARIANTS: Record<IconButtonVariant, { container: ViewStyle; iconColor: string }> = {
  solid:    { container: { backgroundColor: C.ctaPrimary }, iconColor: C.white },
  ghost:    { container: { backgroundColor: 'transparent' }, iconColor: C.text },
  outlined: { container: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.ctaPrimaryBorder }, iconColor: C.ctaPrimary },
  floating: {
    container: {
      backgroundColor: 'rgba(255, 253, 248, 0.96)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(207, 227, 222, 0.92)',
      ...Shadow.card,
    },
    iconColor: C.petrolDeep,
  },
  onDark:   { container: { backgroundColor: 'transparent' }, iconColor: C.white },
  danger:   { container: { backgroundColor: C.red }, iconColor: C.white },
};

function iconForGlyph(icon: string): LucideIcon | null {
  switch (icon) {
    case '←':
      return ChevronLeft;
    case '✕':
    case '×':
      return X;
    case '↗':
      return Share2;
    case '♡':
    case '♥':
      return Heart;
    case '⋮':
      return MoreVertical;
    case '+':
      return Plus;
    case '⌕':
      return Search;
    case 'refresh':
      return RefreshCw;
    case 'history':
      return History;
    case '📦':
      return Package;
    case '⚠':
      return AlertTriangle;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  glyph: { textAlign: 'center', fontWeight: T.weight.semi },
  disabled: { backgroundColor: C.ctaDisabledBg, borderWidth: 1, borderColor: C.ctaDisabledBorder },
  disabledGlyph: { color: C.ctaDisabledText },
});
