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
  homeWarmTop: C.wordmarkOrangeTop,
  homeWarmMid: C.wordmarkOrangeMid,
  homeWarmBase: C.wordmarkOrangeBase,
  homeWarmBoost: C.wordmarkOrangeBoost,
  homeWarmBorder: C.petrolDeep,
  homeTealTop: C.wordmarkTeal,
  homeTealMid: C.petrol,
  homeTealBase: C.petrolDeep,
  gloss: C.surface,
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
  const width = Math.round(textSize * 3);
  const height = 31;

  return (
    <View
      style={[s.homeLogo, { width, height }, style]}
      accessibilityLabel="Owmee"
      accessible
    >
      <Svg width="100%" height="100%" viewBox="0 0 96 33">
        <Defs>
          <LinearGradient id="owmeeHomeWarm" x1="0" y1="5" x2="0" y2="28">
            <Stop offset="0" stopColor={BRAND.homeWarmTop} />
            <Stop offset="0.42" stopColor={BRAND.homeWarmMid} />
            <Stop offset="1" stopColor={BRAND.homeWarmBase} />
          </LinearGradient>
          <LinearGradient id="owmeeHomeWarmGloss" x1="0" y1="7" x2="0" y2="26">
            <Stop offset="0" stopColor={BRAND.gloss} stopOpacity="0" />
            <Stop offset="0.16" stopColor={BRAND.gloss} stopOpacity="0.22" />
            <Stop offset="0.34" stopColor={BRAND.gloss} stopOpacity="0.06" />
            <Stop offset="1" stopColor={BRAND.gloss} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="owmeeHomeTealGloss" x1="0" y1="7" x2="0" y2="27">
            <Stop offset="0" stopColor={BRAND.gloss} stopOpacity="0" />
            <Stop offset="0.18" stopColor={BRAND.gloss} stopOpacity="0.12" />
            <Stop offset="0.40" stopColor={BRAND.gloss} stopOpacity="0.03" />
            <Stop offset="1" stopColor={BRAND.gloss} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="owmeeHomeTeal" x1="0" y1="4" x2="0" y2="28">
            <Stop offset="0" stopColor={BRAND.homeTealTop} />
            <Stop offset="0.48" stopColor={BRAND.homeTealMid} />
            <Stop offset="1" stopColor={BRAND.homeTealBase} />
          </LinearGradient>
        </Defs>

        <SvgText
          x="0.7"
          y="26.4"
          fontSize="26"
          fontWeight="800"
          fill="rgba(23, 32, 51, 0.08)"
        >
          {WORDMARK}
        </SvgText>
        <SvgText
          x="0"
          y="25.3"
          fontSize="26"
          fontWeight="800"
          fill="none"
          stroke="rgba(255, 253, 248, 0.20)"
          strokeWidth="0.32"
        >
          {WORDMARK}
        </SvgText>
        <SvgText
          x="0"
          y="25.3"
          fontSize="26"
          fontWeight="800"
          fill="none"
          stroke={BRAND.homeWarmBorder}
          strokeOpacity="0.86"
          strokeWidth="0.72"
        >
          Ow
        </SvgText>
        <SvgText x="0" y="25.3" fontSize="26" fontWeight="800">
          <TSpan fill="url(#owmeeHomeWarm)">Ow</TSpan>
          <TSpan fill="url(#owmeeHomeTeal)">mee</TSpan>
        </SvgText>
        <SvgText
          x="0"
          y="25.3"
          fontSize="26"
          fontWeight="800"
          fill={BRAND.homeWarmBoost}
          opacity="0.16"
        >
          Ow
        </SvgText>
        <SvgText
          x="0"
          y="25.3"
          fontSize="26"
          fontWeight="800"
          fill="none"
          stroke={BRAND.gloss}
          strokeOpacity="0.24"
          strokeWidth="0.20"
        >
          Ow
        </SvgText>
        <SvgText
          x="0"
          y="25.3"
          fontSize="26"
          fontWeight="800"
          fill="url(#owmeeHomeWarmGloss)"
        >
          Ow
        </SvgText>
        <SvgText
          x="0"
          y="25.3"
          fontSize="26"
          fontWeight="800"
          fill="url(#owmeeHomeTealGloss)"
        >
          mee
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
  homeLogo: {
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
    transform: [{ translateY: -1 }],
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
