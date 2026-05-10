/**
 * OnboardingScreen — Sprint 3
 *
 * Shown ONCE on first ever app open (after location picker).
 * After user taps "Start browsing", stored in AsyncStorage, never shown again.
 * NOT part of the auth flow anymore — auth goes straight to Register.
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R, Shadow } from '../../utils/tokens';
import { Button } from '../../components/ui';
import OwmeeLogo from '../../components/OwmeeLogo';

const SLIDES = [
  {
    emoji: '🛡️',
    title: 'Every seller is verified',
    sub: 'Aadhaar + PAN verified sellers only.\nNo fake profiles, no scams.',
    bg: C.petrolLight,
    accent: C.petrol,
  },
  {
    emoji: '💳',
    title: 'Your money is protected',
    sub: 'Payment held safely by our partner until you confirm the item.\nFull refund if it doesn\'t match.',
    bg: C.coralLight,
    accent: C.coralDeep,
  },
  {
    emoji: '📱',
    title: 'Phones, laptops & more',
    sub: 'Thousands of pre-owned items near you.\nSmartphones, laptops, appliances, kids items.',
    bg: C.bone,
    accent: C.ink,
  },
];

export default function OnboardingScreen({ navigation }: any) {
  const { width } = useWindowDimensions();
  const [idx, setIdx] = useState(0);
  const flatRef = useRef<FlatList>(null);

  const goNext = () => {
    if (idx < SLIDES.length - 1) {
      flatRef.current?.scrollToIndex({ index: idx + 1, animated: true });
      setIdx(idx + 1);
    } else {
      navigation.navigate();
    }
  };

  const skip = () => navigation.navigate();

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.topBar}>
        <View style={s.topSpacer} />
        <OwmeeLogo markSize={32} textSize={22} />
        {idx < SLIDES.length - 1 ? (
          <Button label="Skip" variant="ghost" size="sm" onPress={skip} style={s.skipBtn} />
        ) : (
          <View style={s.topSpacer} />
        )}
      </View>

      <FlatList
        ref={flatRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <View style={[s.slide, { width }]}>
            <View style={[s.emojiCircle, { backgroundColor: item.bg }]}>
              <Text style={s.emoji}>{item.emoji}</Text>
            </View>
            <Text style={[s.title, { color: item.accent }]}>{item.title}</Text>
            <Text style={s.sub}>{item.sub}</Text>
          </View>
        )}
      />

      <View style={s.bottom}>
        <View style={s.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[s.dot, i === idx && s.dotActive]} />
          ))}
        </View>

        <Button
          label={idx < SLIDES.length - 1 ? 'Next' : 'Start browsing →'}
          variant="primary"
          size="lg"
          onPress={goNext}
          fullWidth
          style={s.cta}
        />

        {idx === SLIDES.length - 1 && (
          <Text style={s.note}>
            No sign-up needed to browse. Create an account when you're ready to buy or sell.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.xl, paddingVertical: S.sm,
  },
  topSpacer: { width: 60 },
  skipBtn: { width: 60 },

  slide: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: S.xxxl,
  },
  emojiCircle: {
    width: 120, height: 120, borderRadius: 60,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: S.xxxl,
  },
  emoji: { fontSize: T.size.display + 26 },                          // 56
  title: {
    fontSize: T.size.display - 4,                                    // 26
    fontWeight: T.weight.heavy,
    textAlign: 'center',
    marginBottom: S.md,
    letterSpacing: -0.5,
  },
  sub: { fontSize: T.size.md, color: C.text3, textAlign: 'center', lineHeight: 23 },

  bottom: { paddingHorizontal: S.xl, paddingBottom: S.xxxl },
  dots: {
    flexDirection: 'row', justifyContent: 'center',
    gap: S.sm, marginBottom: S.xxl,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  dotActive: { backgroundColor: C.petrol, width: 24 },

  cta: { ...Shadow.glow },

  note: {
    fontSize: T.size.sm, color: C.text4,
    textAlign: 'center', marginTop: S.lg, lineHeight: 18,
  },
});
