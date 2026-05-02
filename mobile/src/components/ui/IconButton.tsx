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
  ActivityIndicator, StyleSheet, Text, TouchableOpacity, ViewStyle,
} from 'react-native';
import { C, MIN_TAP, T } from '../../utils/tokens';

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
  style?: ViewStyle;
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
  const sz = SIZES[size];
  const v = VARIANTS[variant];
  return (
    <TouchableOpacity
      onPress={loading ? undefined : onPress}
      disabled={isInactive}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      hitSlop={size === 'sm' ? { top: 6, bottom: 6, left: 6, right: 6 } : undefined}
      style={[
        styles.base,
        { width: sz.dim, height: sz.dim, borderRadius: sz.dim / 2 },
        v.container,
        isInactive && { opacity: 0.55 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.iconColor} />
      ) : (
        <Text
          style={[styles.glyph, { fontSize: sz.glyph, color: v.iconColor }]}
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
  solid:    { container: { backgroundColor: C.petrol }, iconColor: C.white },
  ghost:    { container: { backgroundColor: 'transparent' }, iconColor: C.text },
  outlined: { container: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border }, iconColor: C.text },
  danger:   { container: { backgroundColor: C.red }, iconColor: C.white },
};

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  glyph: { textAlign: 'center', fontWeight: T.weight.semi },
});
