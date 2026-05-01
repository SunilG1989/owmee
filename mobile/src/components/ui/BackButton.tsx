/**
 * Owmee BackButton — v6 "Petrol"
 *
 * The standard chevron-back used by every detail screen. Default
 * variant is a borderless circular tap target on bone surfaces.
 * `floating` variant is for hero-image headers (translucent on
 * the photo, ensures contrast over any background).
 *
 *   <BackButton onPress={() => nav.goBack()} />
 *   <BackButton onPress={() => nav.goBack()} variant="floating" />
 *   <BackButton onPress={() => nav.goBack()} variant="onDark" />
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { C, MIN_TAP, R, Shadow } from '../../utils/tokens';

export type BackButtonVariant = 'default' | 'floating' | 'onDark';

interface Props {
  onPress: () => void;
  variant?: BackButtonVariant;
  style?: ViewStyle;
  a11y?: string;
}

export default function BackButton({
  onPress,
  variant = 'default',
  style,
  a11y = 'Back',
}: Props) {
  const v = variantStyles[variant];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[styles.base, v.container, style]}
    >
      <View style={styles.glyphWrap}>
        {/* Chevron drawn with two lines so it survives any font swap */}
        <View style={[styles.chevTop, { backgroundColor: v.fg }]} />
        <View style={[styles.chevBot, { backgroundColor: v.fg }]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    width: MIN_TAP,
    height: MIN_TAP,
    borderRadius: R.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyphWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  chevTop: {
    position: 'absolute',
    width: 12,
    height: 2,
    borderRadius: 1,
    transform: [{ translateX: -2 }, { translateY: -3 }, { rotate: '-45deg' }],
  },
  chevBot: {
    position: 'absolute',
    width: 12,
    height: 2,
    borderRadius: 1,
    transform: [{ translateX: -2 }, { translateY: 3 }, { rotate: '45deg' }],
  },
});

const variantStyles: Record<BackButtonVariant, { container: ViewStyle; fg: string }> = {
  default: {
    container: { backgroundColor: 'transparent' },
    fg: C.ink,
  },
  floating: {
    container: {
      backgroundColor: 'rgba(15, 26, 31, 0.55)',
      ...Shadow.subtle,
    },
    fg: C.bone,
  },
  onDark: {
    container: { backgroundColor: 'transparent' },
    fg: C.bone,
  },
};
