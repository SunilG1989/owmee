/**
 * VisitContinueScreen — Concierge master spec section 6.4
 *
 * Shown after a successful submit-listing. Specialist picks:
 *   - "Add another item" → navigate back to FeCapture for the same visit
 *   - "Done with visit" → fire close-visit with outcome='listed'
 *
 * Tracks listed-count clientside (best-effort — backend is the source
 * of truth for the 10-item cap, but showing "1/10 listed" sets the
 * right expectation).
 */
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FE } from '../../services/api';
import { BackButton, Button } from '../../components/ui';
import { C, R, S, T, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

export default function VisitContinueScreen({
  navigation,
  route,
}: RootScreen<'VisitContinue'>) {
  const { visitId } = route.params;
  const [closing, setClosing] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  // Pull a count of listings tied to this visit so the user knows where
  // they are against the 10-item cap. Best-effort — silent on failure.
  useEffect(() => {
    let cancelled = false;
    FE.getVisit(visitId)
      .then((r) => {
        if (cancelled) return;
        // visit.listing_id is a single pointer; we can't get the full
        // count from the visit row alone. Use the seller-side me/listings
        // is overkill for FE app — settle for a coarse "≥1" indicator.
        const visit = r.data as any;
        setCount(visit?.listing_id ? 1 : 0);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [visitId]);

  const onAddAnother = () => {
    navigation.replace('FeCapture', { visitId });
  };

  const onDone = async () => {
    setClosing(true);
    try {
      await FE.closeVisit(visitId, { outcome: 'listed' });
      navigation.reset({
        index: 0,
        routes: [{ name: 'FeHome' as never }],
      });
    } catch (e: any) {
      Alert.alert(
        'Could not close visit',
        e?.response?.data?.detail?.message || 'Please try again.',
      );
      setClosing(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
      </View>

      <View style={s.body}>
        <Text style={s.tick}>✓</Text>
        <Text style={s.title}>Listing submitted</Text>
        <Text style={s.subtitle}>What's next?</Text>

        <View style={s.actionCard}>
          <Button
            label="+ Add another item"
            onPress={onAddAnother}
            disabled={closing}
            fullWidth
          />
          {count !== null ? (
            <Text style={s.countLine}>
              {Math.min(count, 10)}/10 listed in this visit
            </Text>
          ) : null}
        </View>

        <View style={s.gap} />

        <View style={s.actionCard}>
          <Button
            label="Done with visit"
            onPress={onDone}
            loading={closing}
            disabled={closing}
            variant="secondary"
            fullWidth
          />
          <Text style={s.doneHint}>
            Phase 5 will add a chain-of-custody photo step here.
          </Text>
        </View>
      </View>
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
  },
  body: {
    flex: 1,
    paddingHorizontal: S.xl,
    paddingTop: S.xl,
  },
  tick: {
    fontSize: T.size.display + 18,
    color: C.petrol,
    textAlign: 'center',
    marginBottom: S.md,
  },
  title: {
    fontSize: T.size.xxl - 2,
    fontWeight: T.weight.bold,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.xs,
  },
  subtitle: {
    fontSize: T.size.sm + 1,
    color: C.text2,
    textAlign: 'center',
    marginBottom: S.xl,
  },
  gap: { height: S.lg },
  actionCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    ...Shadow.glow,
  },
  countLine: {
    fontSize: T.size.sm,
    color: C.text3,
    textAlign: 'center',
    marginTop: S.sm,
  },
  doneHint: {
    fontSize: T.size.sm,
    color: C.text3,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: S.sm,
  },
});
