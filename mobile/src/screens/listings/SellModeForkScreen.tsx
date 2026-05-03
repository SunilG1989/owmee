/**
 * SellModeForkScreen — Sell-flow entry point (2026-05-03 redesign)
 *
 * The asymmetric fork. Concierge card carries the visual weight; the
 * self-service card sits below as a quieter secondary path. The
 * asymmetry IS the message: we want sellers to pick concierge.
 *
 * Below the two cards: an inline "Already booked. Track it →" footer
 * appears only when the user has at least one active FE visit, so the
 * primary fork stays uncluttered for first-time sellers.
 *
 * No "Compare" link, no "Help me decide" modal — friction kills
 * conversion at the moment of decision.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
import { FEVisits, type FEVisit } from '../../services/api';

const ACTIVE_VISIT_STATUSES = new Set([
  'requested',
  'approved',
  'pickup_scheduled',
  'in_progress',
  'at_hub',
]);

export default function SellModeForkScreen({ navigation }: any) {
  const C_STR = CONCIERGE_STRINGS.forkScreen;

  // Track whether the seller has any in-flight Owmee visit. Used to
  // surface the "Already booked. Track it →" footer. We swallow errors
  // silently — the screen is fully usable without this footer.
  const [activeVisit, setActiveVisit] = useState<FEVisit | null>(null);
  const [visitLoading, setVisitLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await FEVisits.mine();
        const candidates = (res.data || []).filter(v =>
          ACTIVE_VISIT_STATUSES.has(String(v.status || '').toLowerCase()),
        );
        if (!cancelled) setActiveVisit(candidates[0] || null);
      } catch {
        if (!cancelled) setActiveVisit(null);
      } finally {
        if (!cancelled) setVisitLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
          <View style={s.heroHeader}>
            <View style={{ flex: 1 }}>
              <View style={s.heroPill}>
                <Text style={s.heroPillText}>{C_STR.concierge.pillBadge}</Text>
              </View>
              <Text style={s.heroHeading}>{C_STR.concierge.heading}</Text>
            </View>
            <View style={s.heroIllustration}>
              <Text style={s.heroIllGlyph} allowFontScaling={false}>👨‍💼</Text>
              <View style={s.heroIllStripe} />
            </View>
          </View>

          <Text style={s.heroTagline}>{C_STR.concierge.tagline}</Text>

          <View style={s.bulletList}>
            {C_STR.concierge.bullets.map((b, i) => (
              <View key={i} style={s.bulletRow}>
                <View style={s.bulletTickWrap}>
                  <Text style={s.bulletTick} allowFontScaling={false}>✓</Text>
                </View>
                <Text style={s.bulletText}>{b}</Text>
              </View>
            ))}
          </View>

          <View style={s.heroCta}>
            <Text style={s.heroCtaText}>{C_STR.concierge.cta}</Text>
            <Text style={s.heroCtaArrow} allowFontScaling={false}>→</Text>
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
            <View style={s.subCardIconWrap}>
              <Text style={s.subCardIconGlyph} allowFontScaling={false}>📷</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.subCardHeading}>{C_STR.selfService.heading}</Text>
              <Text style={s.subCardTagline}>{C_STR.selfService.tagline}</Text>
            </View>
          </View>
          <View style={s.subCardCtaRow}>
            <Text style={s.subCardCta}>{C_STR.selfService.cta}</Text>
            <Text style={s.subCardCtaArrow} allowFontScaling={false}>→</Text>
          </View>
        </TouchableOpacity>

        {/* ── Already booked footer (conditional) ──────────────────────── */}
        {visitLoading ? (
          <View style={s.bookedFooterLoading}>
            <ActivityIndicator size="small" color={C.petrol} />
          </View>
        ) : activeVisit ? (
          <TouchableOpacity
            style={s.bookedFooter}
            onPress={() => navigation.navigate('VisitDetail', { visit_id: activeVisit.id })}
            activeOpacity={0.85}
          >
            <Text style={s.bookedLabel}>{C_STR.alreadyBooked.label}</Text>
            <View style={s.bookedCtaRow}>
              <Text style={s.bookedCta}>{C_STR.alreadyBooked.cta}</Text>
              <Text style={s.bookedCtaArrow} allowFontScaling={false}>→</Text>
            </View>
          </TouchableOpacity>
        ) : null}

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
    fontSize: T.size.xl,
    fontWeight: T.weight.heavy,
    color: C.text,
    flex: 1,
    letterSpacing: -0.3,
  },
  flex: { flex: 1 },
  gap: { height: S.xl },
  body: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.xl,
  },

  // Concierge hero card — white surface, mint-tinted accents.
  heroCard: {
    backgroundColor: C.white,
    borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1,
    borderColor: C.mintBorder,
    ...Shadow.lifted,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: S.sm,
  },
  heroPill: {
    alignSelf: 'flex-start',
    backgroundColor: C.mintSoft,
    borderWidth: 1,
    borderColor: C.mintBorder,
    paddingHorizontal: S.sm + 2,
    paddingVertical: 3,
    borderRadius: R.pill,
    marginBottom: S.sm,
  },
  heroPillText: {
    color: C.petrol,
    fontSize: T.size.xs,
    fontWeight: T.weight.heavy,
    letterSpacing: 0.4,
  },
  heroHeading: {
    fontSize: T.size.xxl - 2,
    fontWeight: T.weight.heavy,
    color: C.text,
    letterSpacing: -0.4,
  },
  heroIllustration: {
    width: 64,
    height: 64,
    borderRadius: R.md,
    backgroundColor: C.mintSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  heroIllGlyph: {
    fontSize: T.size.display - 4,
  },
  heroIllStripe: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 8,
    backgroundColor: C.petrolLight,
  },
  heroTagline: {
    fontSize: T.size.base + 1,
    color: C.text2,
    lineHeight: T.size.base + 8,
    marginBottom: S.md,
    fontWeight: T.weight.medium,
  },
  bulletList: {
    gap: S.sm,
    marginBottom: S.lg,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
  },
  bulletTickWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.greenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulletTick: {
    fontSize: T.size.xs + 1,
    color: C.green,
    fontWeight: T.weight.heavy,
  },
  bulletText: {
    fontSize: T.size.base + 1,
    color: C.text,
    flex: 1,
    fontWeight: T.weight.semi,
  },
  heroCta: {
    backgroundColor: C.petrol,
    borderRadius: R.md,
    paddingVertical: S.md,
    paddingHorizontal: S.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: S.xs + 2,
    minHeight: MIN_TAP,
    ...Shadow.glow,
  },
  heroCtaText: {
    color: C.white,
    fontSize: T.size.md,
    fontWeight: T.weight.heavy,
  },
  heroCtaArrow: {
    color: C.white,
    fontSize: T.size.md + 1,
    fontWeight: T.weight.heavy,
  },

  // Self-service card — smaller, quieter
  subCard: {
    marginTop: S.md,
    backgroundColor: C.white,
    borderRadius: R.lg,
    padding: S.md + 2,
    borderWidth: 1,
    borderColor: C.border,
    ...Shadow.subtle,
  },
  subCardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: S.md,
    marginBottom: S.sm + 2,
  },
  subCardIconWrap: {
    width: 44,
    height: 44,
    borderRadius: R.md,
    backgroundColor: C.bone2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subCardIconGlyph: {
    fontSize: T.size.xl,
  },
  subCardHeading: {
    fontSize: T.size.md + 1,
    fontWeight: T.weight.heavy,
    color: C.text,
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  subCardTagline: {
    fontSize: T.size.sm + 1,
    color: C.text2,
    lineHeight: T.size.sm + 7,
    fontWeight: T.weight.medium,
  },
  subCardCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: S.xs,
  },
  subCardCta: {
    fontSize: T.size.base + 1,
    color: C.petrol,
    fontWeight: T.weight.heavy,
  },
  subCardCtaArrow: {
    fontSize: T.size.md,
    color: C.petrol,
    fontWeight: T.weight.heavy,
  },

  // Already-booked footer
  bookedFooterLoading: {
    marginTop: S.lg,
    alignItems: 'center',
    paddingVertical: S.md,
  },
  bookedFooter: {
    marginTop: S.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.bone2,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm + 2,
    borderWidth: 1,
    borderColor: C.border,
  },
  bookedLabel: {
    flex: 1,
    fontSize: T.size.sm + 1,
    color: C.text2,
    fontWeight: T.weight.semi,
  },
  bookedCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  bookedCta: {
    fontSize: T.size.sm + 1,
    color: C.petrol,
    fontWeight: T.weight.heavy,
  },
  bookedCtaArrow: {
    fontSize: T.size.md,
    color: C.petrol,
    fontWeight: T.weight.heavy,
  },
});
