/**
 * HeroCard — compact 3-slide trust carousel.
 *
 * The carousel carries the three home promises without turning the first
 * screen into an ad wall: buy safely, sell with assist, and protected handover.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ImageBackground, TouchableOpacity,
  type ImageSourcePropType,
} from 'react-native';
import Svg, {
  Defs, LinearGradient, Stop, Rect, Path,
} from 'react-native-svg';
import { C, T, S, R, Shadow } from '../utils/tokens';

const SECTION_GAP = S.sm;

type HeroSlide = {
  image: ImageSourcePropType;
  kicker: string;
  title: string;
  subtitle: string;
  wash: string;
  plate: string;
  kickerColor: string;
  subtitleColor: string;
  accessibilityLabel: string;
  action: 'browse' | 'sell';
};

const SLIDES: HeroSlide[] = [
  {
    image: require('../../assets/owmee/home/safetrade-real-banner-v3.png'),
    kicker: 'TRUSTED RESALE',
    title: 'Resale, with less risk.',
    subtitle: 'Verified details, protected payments and easier handovers.',
    wash: '#2F766B',
    plate: '#245E56',
    kickerColor: '#FFE0C5',
    subtitleColor: '#E9F8F2',
    accessibilityLabel: 'Browse safe buying deals',
    action: 'browse',
  },
  {
    image: require('../../assets/owmee/home/assist-photo-v2.png'),
    kicker: 'OWMEE ASSIST',
    title: "Selling something? We'll help.",
    subtitle: 'From photos to pickup, Owmee Assist makes selling easier.',
    wash: '#B86F59',
    plate: '#8F5749',
    kickerColor: '#FFE8D9',
    subtitleColor: '#FFF5EF',
    accessibilityLabel: 'Book Owmee Assist to sell from home',
    action: 'sell',
  },
  {
    image: require('../../assets/owmee/home/safetrade-real-banner.png'),
    kicker: 'EASIER HANDOVER',
    title: 'Buy with better details.',
    subtitle: 'Know more before you decide.',
    wash: '#496F72',
    plate: '#2F5E61',
    kickerColor: '#FFE4CC',
    subtitleColor: '#EDF9F6',
    accessibilityLabel: 'Browse safe payment listings',
    action: 'browse',
  },
];

interface Props {
  onBrowse: () => void;
  onSell?: () => void;
}

export default function HeroCard({ onBrowse, onSell }: Props) {
  const [active, setActive] = useState(0);
  const slide = SLIDES[active];

  useEffect(() => {
    const timer = setInterval(() => {
      setActive(prev => (prev + 1) % SLIDES.length);
    }, 3600);
    return () => clearInterval(timer);
  }, []);

  const handlePress = () => {
    if (slide.action === 'sell' && onSell) {
      onSell();
      return;
    }
    onBrowse();
  };

  return (
    <View style={s.wrap}>
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={slide.accessibilityLabel}
      >
        <ImageBackground
          source={slide.image}
          resizeMode="cover"
          imageStyle={s.image}
          style={s.card}
        >
          <Svg pointerEvents="none" style={s.overlay} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="heroWash" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={slide.wash} stopOpacity="0.80" />
                <Stop offset="0.34" stopColor={slide.wash} stopOpacity="0.60" />
                <Stop offset="0.54" stopColor={slide.wash} stopOpacity="0.27" />
                <Stop offset="0.74" stopColor="#FFF8EE" stopOpacity="0.04" />
                <Stop offset="1" stopColor="#FFF8EE" stopOpacity="0" />
              </LinearGradient>
              <LinearGradient id="heroPlate" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={slide.plate} stopOpacity="0.42" />
                <Stop offset="0.66" stopColor={slide.wash} stopOpacity="0.18" />
                <Stop offset="1" stopColor={slide.wash} stopOpacity="0" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100" height="100" fill="url(#heroWash)" />
            <Path
              d="M0 0 H58 C48 22 56 64 43 100 H0 Z"
              fill="url(#heroPlate)"
            />
          </Svg>
          <View style={s.copy}>
            <Text style={[s.kicker, { color: slide.kickerColor }]} numberOfLines={1}>
              {slide.kicker}
            </Text>
            <Text style={s.title} numberOfLines={2}>
              {slide.title}
            </Text>
            <Text style={[s.subtitle, { color: slide.subtitleColor }]} numberOfLines={2}>
              {slide.subtitle}
            </Text>
          </View>
        </ImageBackground>
      </TouchableOpacity>

      <View style={s.dots} accessibilityRole="tablist">
        {SLIDES.map((item, index) => (
          <TouchableOpacity
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            activeOpacity={0.75}
            onPress={() => setActive(index)}
            style={[s.dotHit, active === index && s.dotHitActive]}
            accessibilityRole="tab"
            accessibilityLabel={`${item.kicker} banner`}
            accessibilityState={{ selected: active === index }}
          >
            <View style={[s.dot, active === index && s.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: SECTION_GAP,
    paddingHorizontal: S.lg,
  },
  card: {
    height: 135,
    borderRadius: R.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(47, 118, 107, 0.20)',
    ...Shadow.lifted,
  },
  image: {
    borderRadius: R.md,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  copy: {
    width: '60%',
    minHeight: '100%',
    justifyContent: 'center',
    paddingTop: S.sm,
    paddingLeft: S.md,
    paddingBottom: S.sm,
    zIndex: 2,
  },
  kicker: {
    fontSize: 8,
    fontWeight: T.weight.heavy,
    letterSpacing: 1,
    marginBottom: 3,
  },
  title: {
    color: C.white,
    fontSize: T.size.base + 1,
    fontWeight: T.weight.heavy,
    lineHeight: T.size.base + 5,
    letterSpacing: 0,
    textShadowColor: 'rgba(12, 33, 31, 0.20)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subtitle: {
    marginTop: 3,
    fontSize: T.size.xs + 1,
    lineHeight: T.size.xs + 4,
    fontWeight: T.weight.medium,
  },
  dots: {
    height: 10,
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  dotHit: {
    width: 24,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotHitActive: {
    width: 30,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(47, 118, 107, 0.24)',
  },
  dotActive: {
    width: 14,
    backgroundColor: '#2F766B',
  },
});
