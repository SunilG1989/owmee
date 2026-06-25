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
 *     danger     red — destructive ("remove", "block")
 *
 *   sizes
 *     sm  36px — table-row / dense toolbar
 *     md  48px (MIN_TAP) — default
 *     lg  56px — overlay/floating actions
 *
 * sm gets a hitSlop of 6 on each side so the effective tap area still
 * meets the 48px guideline. md/lg already meet it natively.
 */
import React from 'react';
import {
  ActivityIndicator, StyleSheet, Text, TouchableOpacity, View, ViewStyle, StyleProp,
} from 'react-native';
import { C, MIN_TAP, Shadow, T } from '../../utils/tokens';

export type IconButtonVariant = 'solid' | 'ghost' | 'outlined' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

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
  const isBack = icon === '←';
  const sz = SIZES[size];
  const v = VARIANTS[variant];
  const dim = isBack ? MIN_TAP : sz.dim;
  const iconColor = isDisabled
    ? C.ctaDisabledText
    : isBack
      ? C.ctaPrimary
      : v.iconColor;
  return (
    <TouchableOpacity
      onPress={loading ? undefined : onPress}
      disabled={isInactive}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      hitSlop={!isBack && size === 'sm' ? { top: 6, bottom: 6, left: 6, right: 6 } : undefined}
      style={[
        styles.base,
        { width: dim, height: dim, borderRadius: dim / 2 },
        isBack ? styles.backContainer : v.container,
        style,
        isDisabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : isBack ? (
        <View style={styles.backGlyphWrap}>
          <View style={[styles.backGlyphTop, { backgroundColor: iconColor }]} />
          <View style={[styles.backGlyphBottom, { backgroundColor: iconColor }]} />
        </View>
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
  sm: { dim: 36,      glyph: T.size.md },
  md: { dim: MIN_TAP, glyph: T.size.lg },
  lg: { dim: 56,      glyph: T.size.xl },
};

const VARIANTS: Record<IconButtonVariant, { container: ViewStyle; iconColor: string }> = {
  solid:    { container: { backgroundColor: C.ctaPrimary }, iconColor: C.white },
  ghost:    { container: { backgroundColor: 'transparent' }, iconColor: C.text },
  outlined: { container: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.ctaPrimaryBorder }, iconColor: C.ctaPrimary },
  danger:   { container: { backgroundColor: C.red }, iconColor: C.white },
};

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  backContainer: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.ctaPrimaryBorder,
    ...Shadow.subtle,
  },
  backGlyphWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  backGlyphTop: {
    position: 'absolute',
    width: 12,
    height: 2,
    borderRadius: 1,
    transform: [{ translateX: -2 }, { translateY: -3 }, { rotate: '-45deg' }],
  },
  backGlyphBottom: {
    position: 'absolute',
    width: 12,
    height: 2,
    borderRadius: 1,
    transform: [{ translateX: -2 }, { translateY: 3 }, { rotate: '45deg' }],
  },
  glyph: { textAlign: 'center', fontWeight: T.weight.semi },
  disabled: { backgroundColor: C.ctaDisabledBg, borderWidth: 1, borderColor: C.ctaDisabledBorder },
  disabledGlyph: { color: C.ctaDisabledText },
});
