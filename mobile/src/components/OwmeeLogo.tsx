import React from 'react';
import {
  StyleSheet, StyleProp, Text, View, ViewStyle,
} from 'react-native';
import Svg, {
  Defs, LinearGradient, Stop, Text as SvgText, TSpan,
} from 'react-native-svg';
import { C, T } from '../utils/tokens';

type Props = {
  /** Kept for older call sites; wordmark sizing now follows textSize. */
  markSize?: number;
  textSize?: number;
  variant?: 'default' | 'home';
  style?: StyleProp<ViewStyle>;
};

const BRAND = {
  coral: C.wordmarkCoral,
  teal: C.wordmarkTeal,
  homeCoralTop: C.ctaSecondary,
  homeCoralBase: C.coralDeep,
  homeTealTop: C.petrolMid,
  homeTealBase: C.petrolDeep,
  depth: 'rgba(31, 38, 43, 0.18)',
  shine: 'rgba(255, 253, 247, 0.16)',
  clayShadow: 'rgba(92, 44, 31, 0.22)',
  tealShadow: 'rgba(7, 54, 48, 0.24)',
};
const WORDMARK = 'Owmee';

export default function OwmeeLogo({ textSize = 28, variant = 'default', style }: Props) {
  const lineHeight = Math.round(textSize + 3);

  if (variant === 'home') {
    return <HomeWordmark textSize={textSize} style={style} />;
  }

  return (
    <View
      style={[s.logo, style]}
      accessibilityLabel="Owmee"
      accessible
    >
      <Text
        style={[s.word, s.wordDepth, { fontSize: textSize, lineHeight }]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {WORDMARK}
      </Text>
      <Text
        style={[
          s.word,
          s.wordFace,
          {
            fontSize: textSize,
            lineHeight,
          },
        ]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        <Text style={s.wordCoral}>Ow</Text>
        <Text style={s.wordTeal}>mee</Text>
      </Text>
      <Text
        style={[s.word, s.wordShine, { fontSize: textSize, lineHeight }]}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {WORDMARK}
      </Text>
    </View>
  );
}

function HomeWordmark({ textSize, style }: { textSize: number; style?: StyleProp<ViewStyle> }) {
  const width = Math.round(textSize * 3.58);
  const height = Math.round(textSize + 8);

  return (
    <View
      style={[s.logo, s.logoHomeSvg, { width, height }, style]}
      accessibilityLabel="Owmee"
      accessible
    >
      <Svg width="100%" height="100%" viewBox="0 0 108 38">
        <Defs>
          <LinearGradient id="owmeeHomeCoral" x1="0" y1="4" x2="0" y2="32">
            <Stop offset="0" stopColor={BRAND.homeCoralTop} />
            <Stop offset="0.54" stopColor={C.wordmarkCoral} />
            <Stop offset="1" stopColor={BRAND.homeCoralBase} />
          </LinearGradient>
          <LinearGradient id="owmeeHomeTeal" x1="0" y1="3" x2="0" y2="32">
            <Stop offset="0" stopColor={BRAND.homeTealTop} />
            <Stop offset="0.52" stopColor={C.wordmarkTeal} />
            <Stop offset="1" stopColor={BRAND.homeTealBase} />
          </LinearGradient>
        </Defs>

        <SvgText
          x="1.6"
          y="30.7"
          fontSize="29"
          fontWeight="900"
          fill="rgba(20, 29, 35, 0.18)"
        >
          {WORDMARK}
        </SvgText>
        <SvgText
          x="0"
          y="28.7"
          fontSize="29"
          fontWeight="900"
          fill="none"
          stroke="rgba(255, 253, 248, 0.68)"
          strokeWidth="0.65"
        >
          {WORDMARK}
        </SvgText>
        <SvgText x="0" y="28.7" fontSize="29" fontWeight="900">
          <TSpan fill="url(#owmeeHomeCoral)">Ow</TSpan>
          <TSpan fill="url(#owmeeHomeTeal)">mee</TSpan>
        </SvgText>
        <SvgText
          x="0.5"
          y="27.2"
          fontSize="29"
          fontWeight="900"
          fill="rgba(255, 252, 245, 0.18)"
        >
          {WORDMARK}
        </SvgText>
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    position: 'relative',
    paddingTop: 1,
    paddingBottom: 1,
  },
  logoHomeSvg: {
    transform: [{ translateY: -2 }],
  },
  word: {
    fontWeight: T.weight.heavy,
    letterSpacing: 0,
    includeFontPadding: false,
    textShadowColor: BRAND.clayShadow,
    textShadowOffset: { width: 0, height: 1.3 },
    textShadowRadius: 1.2,
  },
  wordDepth: {
    position: 'absolute',
    left: 0,
    top: 2.4,
    color: BRAND.depth,
    zIndex: 0,
  },
  wordFace: {
    zIndex: 1,
  },
  wordShine: {
    position: 'absolute',
    left: 0,
    top: -0.5,
    color: BRAND.shine,
    zIndex: 2,
  },
  wordCoral: {
    color: BRAND.coral,
    textShadowColor: BRAND.clayShadow,
    textShadowOffset: { width: 0, height: 1.2 },
    textShadowRadius: 1.1,
  },
  wordTeal: {
    color: BRAND.teal,
    textShadowColor: BRAND.tealShadow,
    textShadowOffset: { width: 0, height: 1.2 },
    textShadowRadius: 1.1,
  },
});
