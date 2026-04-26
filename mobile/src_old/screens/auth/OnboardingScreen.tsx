/**
 * OnboardingScreen
 *
 * 3 slides before OTP — India UX requirement:
 * "Ye app kya karta hai?" before asking for phone number.
 *
 * Slide 1: Buy safely from verified people near you
 * Slide 2: Sell your unused stuff in 3 steps
 * Slide 3: Every deal is protected
 *
 * Skip → OTP directly (browse as guest is still available from Home)
 */

import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Dimensions, TouchableOpacity,
  ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Radius } from '../../utils/tokens';
import type { AuthStackParams } from '../../navigation/RootNavigator';

const { width, height } = Dimensions.get('window');
type Nav = NativeStackNavigationProp<AuthStackParams>;

const SLIDES = [
  {
    emoji: '🔐',
    title: 'Buy safely from\nverified people near you',
    body: 'Every buyer and seller on Owmee is identity-verified with Aadhaar and PAN. No more strangers — only verified neighbours.',
    accent: Colors.teal,
    accentBg: Colors.tealLight,
  },
  {
    emoji: '📱',
    title: 'Sell your unused stuff\nin 3 steps',
    body: 'Take 3 photos, set your price, publish in 2 minutes. Owmee suggests a fair price based on similar listings near you.',
    accent: Colors.teal,
    accentBg: Colors.tealLight,
  },
  {
    emoji: '🛡️',
    title: 'Every deal is\nprotected',
    body: 'Pay only after you verify the item in person. If something goes wrong, our support team steps in within 48 hours.',
    accent: Colors.teal,
    accentBg: Colors.tealLight,
  },
];

export default function OnboardingScreen() {
  const navigation = useNavigation<Nav>();
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const next = () => {
    if (activeIndex < SLIDES.length - 1) {
      const next = activeIndex + 1;
      scrollRef.current?.scrollTo({ x: next * width, animated: true });
      setActiveIndex(next);
    } else {
      navigation.navigate('OtpPhone');
    }
  };

  const skip = () => navigation.navigate('OtpPhone');

  return (
    <SafeAreaView style={styles.safe}>
      {/* Skip */}
      <View style={styles.skipRow}>
        <TouchableOpacity onPress={skip} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.slider}
      >
        {SLIDES.map((slide, i) => (
          <View key={i} style={styles.slide}>
            <View style={[styles.emojiBox, { backgroundColor: slide.accentBg }]}>
              <Text style={styles.emoji}>{slide.emoji}</Text>
            </View>
            <Text style={styles.slideTitle}>{slide.title}</Text>
            <Text style={styles.slideBody}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      {/* Dots */}
      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i === activeIndex && styles.dotActive,
            ]}
          />
        ))}
      </View>

      {/* CTA */}
      <View style={styles.ctaRow}>
        <TouchableOpacity style={styles.ctaBtn} onPress={next} activeOpacity={0.85}>
          <Text style={styles.ctaBtnText}>
            {activeIndex === SLIDES.length - 1 ? 'Get started →' : 'Next →'}
          </Text>
        </TouchableOpacity>
        {activeIndex === SLIDES.length - 1 && (
          <Text style={styles.guestNote}>
            Browse without signing in — no account needed to look around
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  skipRow: {
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  skipText: {
    fontSize: 14,
    color: Colors.text3,
    fontWeight: '500',
  },
  slider: {
    flex: 1,
  },
  slide: {
    width,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxxl,
    gap: Spacing.xl,
  },
  emojiBox: {
    width: 100,
    height: 100,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  emoji: {
    fontSize: 48,
  },
  slideTitle: {
    fontSize: 26,
    fontWeight: '300',
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 33,
    letterSpacing: -0.3,
  },
  slideBody: {
    fontSize: 14,
    color: Colors.text3,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 300,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.xl,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.border,
  },
  dotActive: {
    width: 20,
    backgroundColor: Colors.teal,
  },
  ctaRow: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.md,
    alignItems: 'center',
  },
  ctaBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: Radius.md + 2,
    backgroundColor: Colors.teal,
    alignItems: 'center',
  },
  ctaBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.white,
  },
  guestNote: {
    fontSize: 12,
    color: Colors.text4,
    textAlign: 'center',
    lineHeight: 17,
  },
});
