/**
 * SellTabRedirect — Sprint 8 Phase 2.1 FINAL (SPRINT8_PHASE2_FINAL_NAV)
 *
 * Why this design (after v1, v2, v3, v3.1 all had nav bugs):
 *
 *   The repeated bug class was: auto-navigation from a tab screen
 *   conflicts with React Navigation 6's focus/mount/tabPress lifecycle
 *   in unpredictable ways. Every fix opened a new edge case.
 *
 *   This version stops trying. The Sell tab shows a simple landing
 *   screen with a clear "Take photos" button. The user taps that
 *   button to open the camera. That's it.
 *
 *   Behavior:
 *   - Tap Sell tab → see landing screen with prominent CTA
 *   - Tap CTA → camera opens
 *   - Tap ✕ in camera → goBack() pops the modal, returns to landing
 *   - Tap CTA again → camera opens again (no state, no magic)
 *   - Tap any other tab → leave normally
 *
 *   No useFocusEffect. No tabPress listener. No refs. No setTimeout.
 *   Pure declarative React. Cannot loop. Cannot get stuck.
 *
 *   Cost: one extra tap per Sell flow. Worth it for unbreakable UX.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { C, T, S, R, Shadow, MIN_TAP } from '../../../utils/tokens';

export default function SellTabRedirect() {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <View style={st.center}>
        {/* Big camera glyph */}
        <View style={st.cameraIconWrap}>
          <Text style={st.cameraIcon}>📸</Text>
        </View>

        <Text style={st.title}>Sell something</Text>
        <Text style={st.subtitle}>
          Take 4–6 photos of your item.{'\n'}AI fills in the rest.
        </Text>

        <TouchableOpacity
          style={st.cta}
          onPress={() => navigation.navigate('AIListingCamera')}
          activeOpacity={0.85}
        >
          <Text style={st.ctaText}>Take photos →</Text>
        </TouchableOpacity>

        <View style={st.tipsWrap}>
          <Tip emoji="💡" text="Show all sides — front, back, both edges" />
          <Tip emoji="✨" text="Bright light makes AI more accurate" />
          <Tip emoji="🔍" text="For phones: include a clear IMEI shot" />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Tip({ emoji, text }: { emoji: string; text: string }) {
  return (
    <View style={st.tipRow}>
      <Text style={st.tipEmoji}>{emoji}</Text>
      <Text style={st.tipText}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.cream,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
  },
  cameraIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: C.honeyLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: S.xl,
    ...Shadow.glow,
  },
  cameraIcon: {
    fontSize: 48,
  },
  title: {
    fontSize: T.size.xxl,
    fontWeight: T.weight.bold,
    color: C.ink,
    marginBottom: S.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: T.size.md,
    color: C.text2,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: S.xxxl,
  },
  cta: {
    backgroundColor: C.honey,
    paddingHorizontal: S.xxxl,
    paddingVertical: S.lg,
    borderRadius: R.pill,
    minHeight: MIN_TAP,
    minWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.glow,
  },
  ctaText: {
    color: C.white,
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
  },
  tipsWrap: {
    marginTop: S.xxxl,
    paddingHorizontal: S.lg,
    width: '100%',
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: S.md,
  },
  tipEmoji: {
    fontSize: 18,
    marginRight: S.md,
    width: 24,
    textAlign: 'center',
  },
  tipText: {
    flex: 1,
    fontSize: T.size.base,
    color: C.text2,
    lineHeight: 20,
  },
});
