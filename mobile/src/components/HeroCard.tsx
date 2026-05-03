/**
 * HeroCard — auto-rotating banner (3 slides), 2026-05-03.
 *
 * Compact petrol hero, ~140dp tall. Carousel of 3 slides:
 *   1. Trust story  — "Buy pre-owned with confidence"
 *   2. Sell pitch   — "Sell from home, we handle the rest"
 *   3. Doorstep     — "Doorstep handover, you confirm before paying"
 *
 * Slides auto-advance every ~5s; user can also swipe. Pagination dots
 * at the bottom. CTA on each slide is one of {Browse, Sell} — both
 * delegate to the consumer (no auth/KYC logic in the hero).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, NativeScrollEvent, NativeSyntheticEvent,
  Image, ImageSourcePropType,
} from 'react-native';
import { C, T, S, R, Shadow, Home } from '../utils/tokens';
import Button from './ui/Button';

// Local hero cutout assets — locked spec path (v17).
// Drop transparent .webp cutouts at mobile/assets/owmee/home/. Until
// real assets land, 1x1 placeholders resolve cleanly and the hero
// renders with text + CTAs as the focal point. NO emoji fallback per
// rule 15.
const HERO_ASSETS: Record<'shield' | 'package' | 'truck', ImageSourcePropType> = {
  shield:  require('../../assets/owmee/home/hero-cozy.webp'),  // first slide — cozy tech + lifestyle setup
  package: require('../../assets/owmee/home/hero-laptop.webp'),
  truck:   require('../../assets/owmee/home/hero-box.webp'),
};

interface Props {
  onBrowse: () => void;
  onSell: () => void;
}

type Slide = {
  key: string;
  title: string;
  subtitle: string;
  primary: { label: string; action: 'browse' | 'sell'; variant: 'primary' | 'secondary' | 'accent' };
  secondary: { label: string; action: 'browse' | 'sell'; variant: 'primary' | 'secondary' | 'accent' };
  vignette: 'shield' | 'package' | 'truck';
};

// Slides anchor to Owmee's three real differentiators (vs generic India
// marketplaces): expert-inspection, full-service selling, and the
// 100% refund guarantee that backstops every purchase. Voice is calm/
// confident, not coupon-y. Avoid "pay after delivery" — buyers do pay
// upfront; the protection is the refund-on-issue promise.
const SLIDES: Slide[] = [
  {
    key: 'trust',
    title: 'Inspected listings.\nProtected payments.',
    subtitle: 'Every item is checked by an expert. ✓ 100% refund if it\'s not as promised.',
    primary:   { label: 'Browse verified deals', action: 'browse', variant: 'primary' },
    secondary: { label: 'Sell from home',        action: 'sell',   variant: 'accent' },
    vignette: 'shield',
  },
  {
    key: 'sell',
    title: 'Sell from home.\nWe pick up. We deliver.',
    subtitle: 'We handle pricing, pickup, and doorstep handover. You just list.',
    primary:   { label: 'List in 2 min',         action: 'sell',   variant: 'accent' },
    secondary: { label: 'See verified deals',    action: 'browse', variant: 'secondary' },
    vignette: 'package',
  },
  {
    key: 'doorstep',
    title: 'Doorstep handover.\nNo meetups, no risk.',
    subtitle: 'Owmee delivers to your door. ✓ Full refund if anything is wrong.',
    primary:   { label: 'Browse verified deals', action: 'browse', variant: 'primary' },
    secondary: { label: 'Sell from home',        action: 'sell',   variant: 'accent' },
    vignette: 'truck',
  },
];

const ROTATE_MS = 5000;

export default function HeroCard({ onBrowse, onSell }: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const [slideWidth, setSlideWidth] = useState(0);
  const userInteractingRef = useRef(false);

  // Auto-advance. Pauses while the user is mid-swipe (drag begin → end).
  useEffect(() => {
    if (slideWidth === 0) return;
    const id = setInterval(() => {
      if (userInteractingRef.current) return;
      const next = (index + 1) % SLIDES.length;
      scrollRef.current?.scrollTo({ x: next * slideWidth, animated: true });
      setIndex(next);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [index, slideWidth]);

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (slideWidth === 0) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / slideWidth);
    setIndex(i);
  };

  const fire = (action: 'browse' | 'sell') => {
    if (action === 'browse') onBrowse();
    else onSell();
  };

  return (
    <View
      style={s.wrap}
      onLayout={e => setSlideWidth(e.nativeEvent.layout.width)}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => { userInteractingRef.current = true; }}
        onScrollEndDrag={() => { userInteractingRef.current = false; }}
        onMomentumScrollEnd={onMomentumEnd}
      >
        {SLIDES.map(slide => (
          <View key={slide.key} style={[s.slide, { width: slideWidth }]}>
            <View style={s.card}>
              <Vignette kind={slide.vignette} />
              <View style={s.copy}>
                <Text style={s.title}>{slide.title}</Text>
                <Text style={s.subtitle} numberOfLines={2}>{slide.subtitle}</Text>
              </View>
              <View style={s.ctaRow}>
                <Button
                  label={slide.primary.label}
                  variant={slide.primary.variant}
                  size="sm"
                  onPress={() => fire(slide.primary.action)}
                  style={s.cta}
                />
                <Button
                  label={slide.secondary.label}
                  variant={slide.secondary.variant}
                  size="sm"
                  onPress={() => fire(slide.secondary.action)}
                  style={s.cta}
                />
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Pagination dots */}
      <View style={s.dots}>
        {SLIDES.map((slide, i) => (
          <View
            key={slide.key}
            style={[s.dot, i === index && s.dotActive]}
          />
        ))}
      </View>
    </View>
  );
}

function Vignette({ kind }: { kind: 'shield' | 'package' | 'truck' }) {
  // Real Unsplash product photos clipped into a circular frame on the
  // peach hero. Cover-fit so the photo fills the circle cleanly (avatar
  // pattern) rather than letterboxed.
  return (
    <View pointerEvents="none" style={s.vignette}>
      <Image
        source={HERO_ASSETS[kind]}
        style={s.heroImg}
        resizeMode="cover"
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    marginTop: S.xs,
  },
  slide: {
    paddingHorizontal: S.lg,
  },
  card: {
    padding: S.md,
    borderRadius: R.lg,
    backgroundColor: Home.heroBg,
    overflow: 'hidden',
    ...Shadow.lifted,
  },
  copy: {
    width: '60%',
    zIndex: 2,
  },
  title: {
    // Heading uses text primary (deep plum), NOT brand button color.
    // Separating the two gives proper hero hierarchy: dark headline + pink CTA.
    color: C.text,
    fontSize: T.size.lg + 2,
    fontWeight: T.weight.heavy,
    lineHeight: T.size.lg + 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: S.xs,
    color: C.text2,                  // text_secondary
    fontSize: T.size.sm,
    lineHeight: T.size.sm + 4,
    fontWeight: T.weight.medium,
  },

  // ── Hero image — circular frame, photo cover-fit ────────────────────
  vignette: {
    position: 'absolute',
    right: 16,
    top: 16,
    width: 100,
    height: 100,
    borderRadius: 50,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    ...Shadow.card,
  },
  heroImg: {
    width: '100%',
    height: '100%',
  },
  glowRingOne: {
    position: 'absolute',
    right: 4,
    top: 16,
    width: 130,
    height: 50,
    borderRadius: 70,
    borderWidth: 1,
    borderColor: Home.heroDecorRing,
    transform: [{ rotate: '-8deg' }],
  },
  glowRingTwo: {
    position: 'absolute',
    right: 14,
    top: 24,
    width: 100,
    height: 38,
    borderRadius: 60,
    borderWidth: 1,
    borderColor: Home.heroDecorRingDim,
    transform: [{ rotate: '-8deg' }],
  },
  shield: {
    position: 'absolute',
    left: 8,
    top: 8,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Home.heroStepBg,
    borderWidth: 1,
    borderColor: Home.heroStepBorder,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  shieldGlyph: {
    color: Home.heroDecorShield,
    fontSize: T.size.xl + 2,
    fontWeight: T.weight.heavy,
  },
  bigGlyph: {
    fontSize: T.size.xl + 4,
  },
  package: {
    position: 'absolute',
    right: 22,
    bottom: 0,
    width: 44,
    height: 38,
    borderRadius: R.xs,
    backgroundColor: Home.heroDecorPackage,
    borderWidth: 1,
    borderColor: Home.heroStepBorder,
    transform: [{ rotate: '2deg' }],
  },
  phone: {
    position: 'absolute',
    right: 2,
    top: 12,
    width: 36,
    height: 56,
    borderRadius: R.sm,
    backgroundColor: Home.heroDecorPhone,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-7deg' }],
    zIndex: 4,
  },
  phoneGlyph: {
    fontSize: T.size.base,
  },

  ctaRow: {
    marginTop: S.md,
    flexDirection: 'row',
    gap: S.sm + 2,
  },
  cta: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: S.sm,
  },

  // ── Pagination dots ─────────────────────────────────────────────────
  dots: {
    marginTop: S.sm,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.border,
  },
  dotActive: {
    width: 18,
    backgroundColor: C.petrol,
  },
});
