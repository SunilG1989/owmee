/**
 * Owmee Button — single source of truth.
 *
 * Three variants × three sizes covers ~95% of buttons in the app.
 * If you find yourself reaching for a fourth variant, push back: it's
 * usually a sign that two patterns should be the same.
 *
 *   variants
 *     primary    amber CTA, the user's main action ("Send offer")
 *     secondary  bordered, neutral action ("Cancel" / "Withdraw")
 *     ghost      borderless, low-emphasis ("Skip" / inline links)
 *     destructive  red CTA, irreversible ("Delete listing")
 *
 *   sizes
 *     sm   inline / table-row context (paddingV: S.sm)
 *     md   default for cards (paddingV: S.md)
 *     lg   full-screen primary CTA (paddingV: S.lg)  — meets MIN_TAP
 *
 * Loading state: pass loading={true} to show a spinner + lock the
 * button. Re-pressing while loading is a no-op (no need to debounce
 * upstream).
 */
import React from 'react';
import {
  ActivityIndicator, StyleSheet, Text, TouchableOpacity, View,
  ViewStyle, TextStyle,
} from 'react-native';
import { C, MIN_TAP, R, S, T } from '../../utils/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  leftIcon?: string;        // emoji or single glyph
  style?: ViewStyle;
  /** Pass-through accessibility label; defaults to `label`. */
  a11y?: string;
}

export default function Button({
  label, onPress,
  variant = 'primary', size = 'md',
  disabled = false, loading = false, fullWidth = false,
  leftIcon, style, a11y,
}: Props) {
  const isInactive = disabled || loading;
  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <TouchableOpacity
      onPress={loading ? undefined : onPress}
      disabled={isInactive}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={a11y || label}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      style={[
        styles.base,
        sizeStyle.container,
        variantStyle.container,
        fullWidth && { alignSelf: 'stretch' },
        isInactive && { opacity: 0.55 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyle.text.color as string} />
      ) : (
        <View style={styles.row}>
          {leftIcon && <Text style={[styles.icon, { color: variantStyle.text.color }]}>{leftIcon}</Text>}
          <Text style={[styles.label, sizeStyle.label, variantStyle.text]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: R.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  icon: { fontSize: T.size.lg },
  label: { textAlign: 'center' },
});

const sizeStyles: Record<ButtonSize, { container: ViewStyle; label: TextStyle }> = {
  sm: {
    container: { paddingHorizontal: S.md, paddingVertical: S.sm, minHeight: 36 },
    label: { fontSize: T.size.base, fontWeight: T.weight.semi },
  },
  md: {
    container: { paddingHorizontal: S.lg, paddingVertical: S.md },
    label: { fontSize: T.size.md, fontWeight: T.weight.semi },
  },
  lg: {
    container: { paddingHorizontal: S.xl, paddingVertical: S.lg },
    label: { fontSize: T.size.md, fontWeight: T.weight.bold },
  },
};

const variantStyles: Record<ButtonVariant, { container: ViewStyle; text: TextStyle }> = {
  primary: {
    container: { backgroundColor: C.petrol },
    text: { color: C.white },
  },
  secondary: {
    container: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
    text: { color: C.text },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: { color: C.text2 },
  },
  destructive: {
    container: { backgroundColor: C.red },
    text: { color: C.white },
  },
};
