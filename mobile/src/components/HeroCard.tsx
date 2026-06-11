/**
 * HeroCard — compact 3-slide trust carousel.
 *
 * The carousel carries the three home promises without turning the first
 * screen into an ad wall: buy safely, sell with assist, and managed delivery.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ImageBackground, TouchableOpacity,
  type ImageSourcePropType,
} from 'react-native';
import { ChevronRight } from 'lucide-react-native';
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
  ctaLabel: string;
  action: 'browse' | 'sell';
};

const SLIDES: HeroSlide[] = [
  {
    image: require('../../assets/owmee/home/safetrade-real-banner-v3.png'),
    kicker: 'TRUSTED RESALE',
    title: 'Resale, with less risk.',
    subtitle: 'Verified details, protected payments and delivery support.',
    wash: '#2F766B',
    plate: C.petrol,
    kickerColor: '#FFE0C5',
    subtitleColor: '#E9F8F2',
    accessibilityLabel: 'Browse safe buying deals',
    ctaLabel: 'Browse deals',
    action: 'browse',
  },
  {
    image: require('../../assets/owmee/home/assist-photo-v2.png'),
    kicker: 'OWMEE ASSIST',
    title: 'We prepare it for sale.',
    subtitle: 'Owmee verifies, packs and lists it for you.',
    wash: '#B86F59',
    plate: C.ctaSecondaryDeep,
    kickerColor: '#FFE8D9',
    subtitleColor: '#FFF5EF',
    accessibilityLabel: 'Book Owmee Assist to sell from home',
    ctaLabel: 'Book Assist',
    action: 'sell',
  },
  {
    image: require('../../assets/owmee/home/safetrade-real-banner.png'),
    kicker: 'EASIER DELIVERY',
    title: 'Buy with better details.',
    subtitle: 'Know more before Owmee delivers it.',
    wash: '#496F72',
    plate: '#2F5E61',
    kickerColor: '#FFE4CC',
    subtitleColor: '#EDF9F6',
    accessibilityLabel: 'Browse safe payment listings',
    ctaLabel: 'See safe listings',
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
        <View style={s.card}>
          {SLIDES.map((item, index) => (
            <ImageBackground
              key={item.kicker}
              source={item.image}
              resizeMode="cover"
              imageStyle={s.image}
              style={[
                s.slideImage,
                index === active ? s.slideImageActive : s.slideImageHidden,
              ]}
            />
          ))}
          <Svg pointerEvents="none" style={s.overlay} viewBox="0 0 100 100" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id="heroWash" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={slide.wash} stopOpacity="0.80" />
                <Stop offset="0.34" stopColor={slide.wash} stopOpacity="0.60" />
                <Stop offset="0.54" stopColor={slide.wash} stopOpacity="0.27" />
                <Stop offset="0.74" stopColor={C.bone} stopOpacity="0.04" />
                <Stop offset="1" stopColor={C.bone} stopOpacity="0" />
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
            <View style={s.textBlock}>
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
            <View style={s.cta}>
              <Text
                style={s.ctaText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.86}
              >
                {slide.ctaLabel}
              </Text>
              <ChevronRight size={13} strokeWidth={2.5} color={C.ctaPrimary} />
            </View>
          </View>
        </View>
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
    height: 136,
    borderRadius: R.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(47, 118, 107, 0.20)',
    ...Shadow.lifted,
  },
  image: {
    borderRadius: R.md,
  },
  slideImage: {
    ...StyleSheet.absoluteFillObject,
  },
  slideImageActive: {
    opacity: 1,
  },
  slideImageHidden: {
    opacity: 0,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  copy: {
    width: '62%',
    height: '100%',
    justifyContent: 'flex-start',
    paddingTop: S.md,
    paddingLeft: S.md,
    paddingRight: S.xs,
    paddingBottom: S.md,
    zIndex: 2,
    position: 'relative',
  },
  textBlock: {
    height: 82,
    justifyContent: 'flex-start',
  },
  kicker: {
    fontSize: 8,
    fontWeight: T.weight.heavy,
    letterSpacing: 1,
    marginBottom: 3,
    lineHeight: 10,
  },
  title: {
    color: C.white,
    fontSize: T.size.base + 1,
    fontWeight: T.weight.heavy,
    lineHeight: T.size.base + 5,
    minHeight: (T.size.base + 5) * 2,
    letterSpacing: 0,
    textShadowColor: 'rgba(12, 33, 31, 0.20)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subtitle: {
    marginTop: 3,
    fontSize: T.size.xs + 1,
    lineHeight: T.size.xs + 3,
    fontWeight: T.weight.medium,
    minHeight: (T.size.xs + 3) * 2,
  },
  cta: {
    position: 'absolute',
    left: S.md,
    bottom: S.md,
    width: 136,
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: S.sm,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255, 253, 248, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.72)',
  },
  ctaText: {
    flexShrink: 1,
    color: C.ctaPrimary,
    fontSize: T.size.xs + 1,
    fontWeight: T.weight.heavy,
    letterSpacing: 0,
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
    backgroundColor: C.ctaPrimary,
  },
});
