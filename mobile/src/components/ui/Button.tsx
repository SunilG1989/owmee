/**
 * Owmee Button — single source of truth.
 *
 *   variants
 *     primary    filled trust CTA, the user's main action ("Buy safely")
 *     secondary  outlined trust action ("Make offer" / "Cancel")
 *     ghost      borderless, low-emphasis ("Skip" / inline links)
 *     destructive  red CTA, irreversible ("Delete listing")
 *     accent     warm supporting CTA — never for the core Sell action
 *     inverse    white surface, deep ink text — for buttons sitting on
 *                a dark hero / brand surface where primary would vanish
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
  ViewStyle, TextStyle, StyleProp,
} from 'react-native';
import { C, MIN_TAP, R, S, Shadow, T } from '../../utils/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'accent' | 'inverse';
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
  style?: StyleProp<ViewStyle>;
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
  const isDisabled = disabled && !loading;
  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <TouchableOpacity
      onPress={isInactive ? undefined : onPress}
      disabled={isInactive}
      activeOpacity={0.78}
      accessibilityRole="button"
      accessibilityLabel={a11y || label}
      accessibilityState={{ disabled: isInactive, busy: loading }}
      style={[
        styles.base,
        sizeStyle.container,
        variantStyle.container,
        fullWidth && { alignSelf: 'stretch' },
        style,
        isDisabled && disabledStyles.container,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variantStyle.text.color as string} />
      ) : (
        <View style={styles.row}>
          {leftIcon && (
            <Text style={[
              styles.icon,
              { color: variantStyle.text.color },
              isDisabled && disabledStyles.text,
            ]}>
              {leftIcon}
            </Text>
          )}
          <Text style={[
            styles.label,
            sizeStyle.label,
            variantStyle.text,
            isDisabled && disabledStyles.text,
          ]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
            {label}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: R.pill,
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
    container: {
      backgroundColor: C.ctaPrimary,
      borderWidth: 1,
      borderColor: C.ctaPrimary,
      ...Shadow.glow,
    },
    text: { color: C.white },
  },
  secondary: {
    container: { backgroundColor: C.surface, borderWidth: 1.25, borderColor: C.ctaPrimaryBorder },
    text: { color: C.ctaPrimary },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: { color: C.ctaPrimary },
  },
  destructive: {
    container: { backgroundColor: C.red },
    text: { color: C.white },
  },
  accent: {
    container: {
      backgroundColor: C.ctaSecondary,
      borderWidth: 1,
      borderColor: C.ctaSecondary,
      ...Shadow.coralGlow,
    },
    text: { color: C.white },
  },
  inverse: {
    container: { backgroundColor: C.white },
    text: { color: C.petrolNight },
  },
};

const disabledStyles = {
  container: {
    backgroundColor: C.ctaDisabledBg,
    borderWidth: 1,
    borderColor: C.ctaDisabledBorder,
    shadowOpacity: 0,
    elevation: 0,
  } satisfies ViewStyle,
  text: {
    color: C.ctaDisabledText,
  } satisfies TextStyle,
};
