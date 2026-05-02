/**
 * NpsScreen — Concierge master spec section 8.4
 *
 * 1-question NPS prompted after a completed visit + payout. Seller
 * picks a 0-10 score and optionally drops a free-text comment.
 *
 * Reached via push notification (concierge_nps_request) — Phase 4's
 * trigger fires once a transaction tied to a Concierge listing settles.
 * Also reachable from MyConciergeScreen's completed-visit cards as
 * a future enhancement (out of Phase 5 scope).
 */
import React, { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FEVisits } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import { parseApiError } from '../../../utils/errors';
import { C, R, S, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

const SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function NpsScreen({
  navigation,
  route,
}: RootScreen<'ConciergeNps'>) {
  const { visit_id, specialist_first_name } = route.params;
  const [score, setScore] = useState<number | null>(null);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (score === null) return;
    setSubmitting(true);
    try {
      await FEVisits.submitNps(visit_id, score, freeText.trim() || undefined);
      Alert.alert('Thanks', 'Your feedback helps us train better specialists.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Could not submit', parseApiError(e, 'Try again.'));
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Quick question</Text>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.q}>
          {specialist_first_name
            ? `Would you recommend ${specialist_first_name} to a friend?`
            : 'Would you recommend your Owmee Specialist to a friend?'}
        </Text>

        <View style={s.scoreRow}>
          {SCORES.map((n) => {
            const isOn = score === n;
            return (
              <TouchableOpacity
                key={n}
                style={[s.scoreChip, isOn && s.scoreChipOn]}
                onPress={() => setScore(n)}
                activeOpacity={0.85}
              >
                <Text style={[s.scoreText, isOn && s.scoreTextOn]}>{n}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.legendRow}>
          <Text style={s.legendText}>← Not at all</Text>
          <Text style={s.legendText}>Definitely →</Text>
        </View>

        <Text style={s.qSub}>(Optional) What made it good or bad?</Text>
        <TextInput
          value={freeText}
          onChangeText={setFreeText}
          multiline
          maxLength={2000}
          placeholder="Anything we should know?"
          placeholderTextColor={C.text4}
          style={s.input}
          textAlignVertical="top"
        />

        <View style={s.gap} />

        <Button
          label="Submit"
          onPress={onSubmit}
          disabled={score === null || submitting}
          loading={submitting}
        />
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
    gap: S.xs,
  },
  headerTitle: {
    fontSize: T.size.lg + 1,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  body: { padding: S.lg },
  gap: { height: S.lg },
  q: {
    fontSize: T.size.lg + 1,
    fontWeight: T.weight.semi,
    color: C.text,
    marginBottom: S.lg,
    lineHeight: 24,
  },
  qSub: {
    fontSize: T.size.base,
    color: C.text2,
    marginTop: S.lg,
    marginBottom: S.sm,
  },
  scoreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.sm,
    justifyContent: 'space-between',
  },
  scoreChip: {
    width: '8%',
    minWidth: 32,
    aspectRatio: 1,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreChipOn: {
    backgroundColor: C.petrol,
    borderColor: C.petrol,
  },
  scoreText: { fontSize: T.size.sm + 1, color: C.text, fontWeight: T.weight.semi },
  scoreTextOn: { color: C.bone, fontWeight: T.weight.heavy },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: S.sm,
  },
  legendText: { fontSize: T.size.sm, color: C.text3 },
  input: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 100,
    padding: S.md,
    fontSize: T.size.sm + 1,
    color: C.text,
  },
});
