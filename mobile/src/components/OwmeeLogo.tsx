import React from 'react';
import {
  StyleSheet, StyleProp, Text, View, ViewStyle,
} from 'react-native';
import { C, T } from '../utils/tokens';

type Props = {
  /** Kept for older call sites; sizing follows textSize. */
  markSize?: number;
  textSize?: number;
  /** Kept for call-site compatibility; rendering is now identical everywhere. */
  variant?: 'default' | 'home';
  style?: StyleProp<ViewStyle>;
};

/**
 * Owmee wordmark — a single, flat, two-tone logotype rendered IDENTICALLY on
 * every surface (home header, onboarding, splash).
 *
 * History: this used to render two completely different ways — an 8-layer SVG
 * text stack for `variant="home"` and a 3-layer <Text> stack everywhere else.
 * The SVG layers (shadow + two outlines + gradient fill + gloss) misregistered
 * under the viewBox→box scale transform, so "Ow" came out doubled/blurry and the
 * two code paths never matched between screens. This is one clean path: "Ow" in
 * warm clay, "mee" in teal, one subtle shadow. Crisp at any size, consistent
 * everywhere, no sub-pixel layer drift.
 */
export default function OwmeeLogo({ textSize = 28, style }: Props) {
  const lineHeight = Math.round(textSize + 3);
  return (
    <View style={[s.logo, style]} accessibilityLabel="Owmee" accessible>
      <Text
        style={[s.word, { fontSize: textSize, lineHeight }]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        <Text style={s.coral}>Ow</Text>
        <Text style={s.teal}>mee</Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    paddingVertical: 1,
  },
  word: {
    fontWeight: T.weight.heavy,
    letterSpacing: 0,
    includeFontPadding: false,
    // One subtle, aligned shadow for a hint of depth (no stacked layers).
    textShadowColor: 'rgba(92, 44, 31, 0.14)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  coral: { color: C.wordmarkCoral },
  teal: { color: C.wordmarkTeal },
});
