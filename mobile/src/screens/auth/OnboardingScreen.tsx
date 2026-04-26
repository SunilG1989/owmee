/**
 * OnboardingScreen — Sprint 3
 *
 * Shown ONCE on first ever app open (after location picker).
 * After user taps "Start browsing", stored in AsyncStorage, never shown again.
 * NOT part of the auth flow anymore — auth goes straight to Register.
 *
 * Purpose: explain what Owmee is, build trust, show value prop.
 * User can browse without signing up after this.
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  useWindowDimensions, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R, Shadow } from '../../utils/tokens';

const SLIDES = [
  {
    emoji: '🛡️',
    title: 'Every seller is verified',
    sub: 'Aadhaar + PAN verified sellers only.\nNo fake profiles, no scams.',
    bg: C.forestLight,
    accent: C.forest,
  },
  {
    emoji: '💳',
    title: 'Your money is protected',
    sub: 'Payment held safely by our partner until you confirm the item.\nFull refund if it doesn\'t match.',
    bg: C.honeyLight,
    accent: C.honeyDeep,
  },
  {
    emoji: '📱',
    title: 'Phones, laptops & more',
    sub: 'Thousands of pre-owned items near you.\nSmartphones, laptops, appliances, kids items.',
    bg: '#F0F0FF',
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
      // Done — navigate calls the RootNavigator callback
      navigation.navigate();
    }
  };

  const skip = () => {
    navigation.navigate();
  };

  return (
    <SafeAreaView style={s.safe}>
      {/* Skip button */}
      <View style={s.topBar}>
        <View style={{ width: 60 }} />
        <Text style={s.logo}>owm<Text style={{ color: C.honey }}>ee</Text></Text>
        {idx < SLIDES.length - 1 ? (
          <TouchableOpacity onPress={skip} style={s.skipBtn}>
            <Text style={s.skipText}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      {/* Slides */}
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

      {/* Dots + CTA */}
      <View style={s.bottom}>
        <View style={s.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                s.dot,
                i === idx && s.dotActive,
              ]}
            />
          ))}
        </View>

        <TouchableOpacity style={s.btn} onPress={goNext} activeOpacity={0.85}>
          <Text style={s.btnText}>
            {idx < SLIDES.length - 1 ? 'Next' : 'Start browsing →'}
          </Text>
        </TouchableOpacity>

        {idx === SLIDES.length - 1 && (
          <Text style={s.note}>No sign-up needed to browse. Create an account when you're ready to buy or sell.</Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.xl, paddingVertical: S.sm,
  },
  logo: { fontSize: 20, fontWeight: '700', color: C.ink, letterSpacing: -0.8 },
  skipBtn: { padding: 8 },
  skipText: { fontSize: 14, color: C.text3, fontWeight: '500' },

  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emojiCircle: {
    width: 120, height: 120, borderRadius: 60,
    alignItems: 'center', justifyContent: 'center', marginBottom: 32,
  },
  emoji: { fontSize: 56 },
  title: {
    fontSize: 26, fontWeight: '800', textAlign: 'center',
    marginBottom: 12, letterSpacing: -0.5,
  },
  sub: {
    fontSize: 15, color: C.text3, textAlign: 'center', lineHeight: 23,
  },

  bottom: { paddingHorizontal: S.xl, paddingBottom: 40 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.border },
  dotActive: { backgroundColor: C.honey, width: 24 },

  btn: {
    backgroundColor: C.honey, borderRadius: R.sm, paddingVertical: 16,
    alignItems: 'center', ...Shadow.glow,
  },
  btnText: { fontSize: 16, color: '#fff', fontWeight: '700' },

  note: {
    fontSize: 12, color: C.text4, textAlign: 'center', marginTop: 16, lineHeight: 18,
  },
});
