/**
 * Owmee Chip — selectable filter / category pill.
 *
 * Use anywhere a screen has a row of toggleable options (category
 * filters, sort options, condition filters, tag pickers) or a
 * non-interactive label tag (status, count, hint). Replaces every
 * inline `<TouchableOpacity><Text>label</Text></TouchableOpacity>`
 * with a rounded-pill style.
 *
 *   variants
 *     filter   default — outline pill, fills with petrolLight when on
 *     solid    petrol-filled, white text — high-emphasis tag
 *     soft     petrolLight bg, petrolDeep text — non-toggleable tag
 *
 *   sizes
 *     sm  inline / dense rows
 *     md  default
 *
 * Pass `onPress` to make it tappable; omit for a static tag.
 */
import React from 'react';
import {
  StyleSheet, Text, TouchableOpacity, View, ViewStyle, TextStyle,
} from 'react-native';
import { C, R, S, T } from '../../utils/tokens';

export type ChipVariant = 'filter' | 'solid' | 'soft';
export type ChipSize = 'sm' | 'md';

interface Props {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  variant?: ChipVariant;
  size?: ChipSize;
  disabled?: boolean;
  leftIcon?: string;
  style?: ViewStyle;
}

export default function Chip({
  label, onPress, selected = false,
  variant = 'filter', size = 'md',
  disabled = false, leftIcon, style,
}: Props) {
  const sz = SIZES[size];
  const v = VARIANTS[variant];
  const containerStyle = selected ? v.selectedContainer : v.container;
  const labelStyle = selected ? v.selectedLabel : v.label;
  const fade = disabled ? { opacity: 0.5 } : null;
  const containerProps = [styles.base, sz.container, containerStyle, fade, style];

  const inner = (
    <>
      {leftIcon && (
        <Text style={[sz.label, labelStyle, styles.leftIcon]}>{leftIcon}</Text>
      )}
      <Text style={[sz.label, labelStyle]}>{label}</Text>
    </>
  );

  if (!onPress || disabled) {
    return <View style={containerProps}>{inner}</View>;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={containerProps}
    >
      {inner}
    </TouchableOpacity>
  );
}

const SIZES: Record<ChipSize, { container: ViewStyle; label: TextStyle }> = {
  sm: {
    container: { paddingHorizontal: S.sm, paddingVertical: S.xs },
    label:     { fontSize: T.size.xs },
  },
  md: {
    container: { paddingHorizontal: S.md, paddingVertical: S.sm },
    label:     { fontSize: T.size.sm },
  },
};

const VARIANTS: Record<
  ChipVariant,
  {
    container: ViewStyle;
    selectedContainer: ViewStyle;
    label: TextStyle;
    selectedLabel: TextStyle;
  }
> = {
  filter: {
    container:         { borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
    selectedContainer: { borderWidth: 1, borderColor: C.petrol, backgroundColor: C.petrolLight },
    label:             { color: C.text2, fontWeight: T.weight.medium },
    selectedLabel:     { color: C.petrolDeep, fontWeight: T.weight.semi },
  },
  solid: {
    container:         { backgroundColor: C.petrol },
    selectedContainer: { backgroundColor: C.petrolDeep },
    label:             { color: C.white, fontWeight: T.weight.semi },
    selectedLabel:     { color: C.white, fontWeight: T.weight.bold },
  },
  soft: {
    container:         { backgroundColor: C.petrolLight },
    selectedContainer: { backgroundColor: C.petrolLight },
    label:             { color: C.petrolDeep, fontWeight: T.weight.medium },
    selectedLabel:     { color: C.petrolDeep, fontWeight: T.weight.semi },
  },
};

const styles = StyleSheet.create({
  base: { borderRadius: R.pill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  leftIcon: { marginRight: 4 },
});
