/**
 * ArrivalVerificationScreen — Concierge master spec section 5.4
 *
 * The seller's at-door verification surface. Reached via N6 push deep
 * link or from VisitDetailScreen during in_progress.
 *
 * Two outcomes:
 *   - Code matched → POST seller-confirm-arrival { code_matched: true }
 *     stamps the visit's confirmation timestamp.
 *   - Didn't match → POST { code_matched: false } creates an urgent
 *     fe_visit_issue alert (Phase 5 lands the real table; Phase 2 logs
 *     to Sentry/server logs and admin gets paged).
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FEVisits, type FEVisit } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import { parseApiError } from '../../../utils/errors';
import { C, R, S, T, Shadow } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

export default function ArrivalVerificationScreen({
  navigation,
  route,
}: RootScreen<'ArrivalVerification'>) {
  const { visit_id } = route.params;
  const [visit, setVisit] = useState<FEVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'match' | 'mismatch' | null>(null);

  useEffect(() => {
    let cancelled = false;
    FEVisits.get(visit_id)
      .then((r) => {
        if (cancelled) return;
        setVisit(r.data);
      })
      .catch(() => {
        if (cancelled) return;
        setVisit(null);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [visit_id]);

  const onMatched = async () => {
    setSubmitting('match');
    try {
      await FEVisits.sellerConfirmArrival(visit_id, true);
      navigation.replace('VisitDetail', { visit_id });
    } catch (e) {
      Alert.alert('Could not confirm', parseApiError(e, 'Try again.'));
      setSubmitting(null);
    }
  };

  const onMismatch = async () => {
    setSubmitting('mismatch');
    try {
      await FEVisits.sellerConfirmArrival(visit_id, false);
      Alert.alert(
        'Don\'t open the door',
        "We're calling you in 60 seconds to verify what's going on. If you feel unsafe, call your local emergency number.",
        [{ text: 'OK' }],
      );
    } catch (e) {
      Alert.alert('Could not flag', parseApiError(e, 'Try again.'));
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator color={C.petrol} />
        </View>
      </SafeAreaView>
    );
  }

  const code = visit?.arrival_verification_code || '----';
  const codeChars = code.split('');

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
      </View>

      <View style={s.body}>
        <Text style={s.glyph}>👋</Text>
        <Text style={s.title}>Your specialist is at the door</Text>
        <Text style={s.intro}>
          Verify it's really them — they should tell you this code:
        </Text>

        <View style={s.codeRow}>
          {codeChars.map((c: string, i: number) => (
            <View key={i} style={s.codeCell}>
              <Text style={s.codeChar}>{c}</Text>
            </View>
          ))}
        </View>

        <View style={s.gap} />

        <Button
          label="✓ They told me this code"
          onPress={onMatched}
          loading={submitting === 'match'}
          disabled={submitting !== null}
          fullWidth
        />
        <Button
          label="⚠️ Code didn't match"
          onPress={onMismatch}
          loading={submitting === 'mismatch'}
          disabled={submitting !== null}
          variant="ghost"
          fullWidth
          style={s.spacedBtn}
        />
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: T.size.display + 26, marginBottom: S.md },     // 56
  title: {
    fontSize: T.size.xxl - 2,
    fontWeight: T.weight.bold,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.sm,
  },
  intro: {
    fontSize: T.size.md,
    color: C.text2,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: S.lg,
  },
  gap: { height: S.xl },
  spacedBtn: { marginTop: S.sm },
  codeRow: {
    flexDirection: 'row',
    gap: S.sm,
  },
  codeCell: {
    width: 60,
    height: 76,
    backgroundColor: C.surface,
    borderRadius: R.lg,
    borderWidth: 2,
    borderColor: C.petrol,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.glow,
  },
  codeChar: {
    fontSize: T.size.display + 8,
    fontWeight: T.weight.heavy,
    color: C.petrolDeep,
  },
});
