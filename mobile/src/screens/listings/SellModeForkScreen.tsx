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
        style={s.flex}
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

        <View style={s.gap} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
  },
  headerTitle: {
    fontSize: T.size.lg + 1,
    fontWeight: T.weight.bold,
    color: C.text,
    flex: 1,
  },
  flex: { flex: 1 },
  gap: { height: S.xl },
  body: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.xl,
  },

  // Hero card — Concierge
  heroCard: {
    backgroundColor: C.bone,
    borderRadius: R.xl,
    padding: S.xl,
    borderWidth: 2,
    borderColor: C.petrol,
    ...Shadow.glow,
    minHeight: 360,
    position: 'relative',
  },
  heroPill: {
    position: 'absolute',
    top: S.md + 2,
    right: S.md + 2,
    backgroundColor: C.petrol,
    paddingHorizontal: S.md,
    paddingVertical: S.xs + 2,
    borderRadius: R.pill,
  },
  heroPillText: {
    color: C.bone,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    letterSpacing: 0.4,
  },
  heroSparkle: {
    fontSize: T.size.display + 6,
    marginBottom: S.sm,
  },
  heroHeading: {
    fontSize: T.size.display - 4,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.sm,
  },
  heroTagline: {
    fontSize: T.size.md,
    color: C.text2,
    lineHeight: 22,
    marginBottom: S.lg,
  },
  bulletList: {
    gap: S.sm,
    marginBottom: S.lg,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: S.sm,
  },
  bulletTick: {
    fontSize: T.size.sm + 1,
    color: C.petrolDeep,
    fontWeight: T.weight.bold,
    marginTop: 2,
  },
  bulletText: {
    fontSize: T.size.sm + 1,
    color: C.text,
    flex: 1,
    lineHeight: 20,
  },
  heroCta: {
    backgroundColor: C.petrol,
    borderRadius: R.pill,
    paddingVertical: S.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TAP,
    marginTop: S.sm,
  },
  heroCtaText: {
    color: C.bone,
    fontSize: T.size.lg - 1,
    fontWeight: T.weight.bold,
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
  subCardEmoji: { fontSize: T.size.xxl - 2 },
  subCardHeading: {
    fontSize: T.size.lg,
    fontWeight: T.weight.semi,
    color: C.text2,
  },
  subCardTagline: {
    fontSize: T.size.base,
    color: C.text3,
    lineHeight: 19,
    marginBottom: S.md,
  },
  subCardCta: {
    fontSize: T.size.sm + 1,
    color: C.text2,
    fontWeight: T.weight.medium,
    alignSelf: 'flex-end',
  },
});
