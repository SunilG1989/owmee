import React from 'react';
import {
  StyleSheet, Text, View,
} from 'react-native';
import { C, T } from '../utils/tokens';

type Props = {
  /** Kept for older call sites; wordmark sizing now follows textSize. */
  markSize?: number;
  textSize?: number;
};

const BRAND = {
  coral: C.wordmarkCoral,
  teal: C.wordmarkTeal,
  clayShadow: 'rgba(87, 45, 35, 0.12)',
  tealShadow: 'rgba(11, 67, 62, 0.10)',
};

export default function OwmeeLogo({ textSize = 28 }: Props) {
  return (
    <View style={s.logo} accessibilityLabel="Owmee" accessible>
      <Text
        style={[
          s.word,
          {
            fontSize: textSize,
            lineHeight: textSize + 3,
          },
        ]}
        numberOfLines={1}
      >
        <Text style={s.wordCoral}>Ow</Text>
        <Text style={s.wordTeal}>mee</Text>
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  word: {
    fontWeight: T.weight.heavy,
    letterSpacing: 0,
    textShadowColor: BRAND.clayShadow,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 0.8,
  },
  wordCoral: {
    color: BRAND.coral,
  },
  wordTeal: {
    color: BRAND.teal,
    textShadowColor: BRAND.tealShadow,
  },
});
