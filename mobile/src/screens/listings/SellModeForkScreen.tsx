/**
 * SellModeForkScreen — Concierge master spec section 4.2
 *
 * The asymmetric fork. Concierge card carries ~70% of the visual weight,
 * self-service card sits below at ~30%. The asymmetry IS the message:
 * "you should pick concierge." A balanced fork undermines the value prop.
 *
 * No "Compare" link. No "Help me decide" modal. Friction kills conversion
 * in the moment of decision.
 */
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CONCIERGE_STRINGS } from '../../utils/conciergeStrings';
import { BackButton } from '../../components/ui';
import { C, MIN_TAP, R, S, Shadow, T } from '../../utils/tokens';

/**
 * Used both as a tab root (Sell tab → fork) AND as a pushed RootStack
 * screen (e.g. from MyConcierge empty state). The two contexts give
 * different navigation prop shapes; we type loosely here so neither
 * complains.
 */
export default function SellModeForkScreen({ navigation }: any) {
  const C_STR = CONCIERGE_STRINGS.forkScreen;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>{C_STR.title}</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={s.body}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Concierge card (hero) ─────────────────────────────────────── */}
        <TouchableOpacity
          style={s.heroCard}
          onPress={() => navigation.navigate('ConciergeBooking')}
          activeOpacity={0.92}
          accessibilityRole="button"
          accessibilityLabel={`${C_STR.concierge.heading}. ${C_STR.concierge.tagline}`}
        >
          <View style={s.heroPill}>
            <Text style={s.heroPillText}>{C_STR.concierge.pillBadge}</Text>
          </View>

          <Text style={s.heroSparkle}>✨</Text>
          <Text style={s.heroHeading}>{C_STR.concierge.heading}</Text>
          <Text style={s.heroTagline}>{C_STR.concierge.tagline}</Text>

          <View style={s.bulletList}>
            {C_STR.concierge.bullets.map((b, i) => (
              <View key={i} style={s.bulletRow}>
                <Text style={s.bulletTick}>✓</Text>
                <Text style={s.bulletText}>{b}</Text>
              </View>
            ))}
          </View>

          <View style={s.heroCta}>
            <Text style={s.heroCtaText}>{C_STR.concierge.cta} →</Text>
          </View>
        </TouchableOpacity>

        {/* ── Self-service card (smaller) ───────────────────────────────── */}
        <TouchableOpacity
          style={s.subCard}
          onPress={() => navigation.navigate('AIListingCamera')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`${C_STR.selfService.heading}. ${C_STR.selfService.tagline}`}
        >
          <View style={s.subCardHead}>
            <Text style={s.subCardEmoji}>📷</Text>
            <Text style={s.subCardHeading}>{C_STR.selfService.heading}</Text>
          </View>
          <Text style={s.subCardTagline}>{C_STR.selfService.tagline}</Text>
          <Text style={s.subCardCta}>{C_STR.selfService.cta} →</Text>
        </TouchableOpacity>

        <View style={{ height: S.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    flex: 1,
  },
  body: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.xl,
  },

  // Hero card — Concierge
  heroCard: {
    backgroundColor: C.cream,
    borderRadius: R.xl,
    padding: S.xl,
    borderWidth: 2,
    borderColor: C.honey,
    ...Shadow.glow,
    minHeight: 360,
    position: 'relative',
  },
  heroPill: {
    position: 'absolute',
    top: 14,
    right: 14,
    backgroundColor: C.honey,
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
  },
  heroPillText: {
    color: C.cream,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  heroSparkle: {
    fontSize: 36,
    marginBottom: S.sm,
  },
  heroHeading: {
    fontSize: 26,
    fontWeight: '700',
    color: C.text,
    marginBottom: S.sm,
  },
  heroTagline: {
    fontSize: 15,
    color: C.text2,
    lineHeight: 22,
    marginBottom: S.lg,
  },
  bulletList: {
    gap: 8,
    marginBottom: S.lg,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletTick: {
    fontSize: 14,
    color: C.honeyDeep,
    fontWeight: '700',
    marginTop: 2,
  },
  bulletText: {
    fontSize: 14,
    color: C.text,
    flex: 1,
    lineHeight: 20,
  },
  heroCta: {
    backgroundColor: C.honey,
    borderRadius: R.pill,
    paddingVertical: S.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP,
    marginTop: S.sm,
  },
  heroCtaText: {
    color: C.cream,
    fontSize: 16,
    fontWeight: '700',
  },

  // Sub card — self-service
  subCard: {
    marginTop: S.lg,
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  subCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    marginBottom: S.sm,
  },
  subCardEmoji: { fontSize: 22 },
  subCardHeading: {
    fontSize: 17,
    fontWeight: '600',
    color: C.text2,
  },
  subCardTagline: {
    fontSize: 13,
    color: C.text3,
    lineHeight: 19,
    marginBottom: S.md,
  },
  subCardCta: {
    fontSize: 14,
    color: C.text2,
    fontWeight: '500',
    alignSelf: 'flex-end',
  },
});
