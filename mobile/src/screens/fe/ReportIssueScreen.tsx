/**
 * ReportIssueScreen — Concierge master spec section 8.2
 *
 * Specialist-facing modal for raising an issue mid-visit. Categories
 * map to severity server-side; safety_concern auto-fires the urgent
 * admin alert path.
 *
 * Photo upload is deliberately out of scope here for the MVP — the
 * existing presigned-upload pipeline can be wired in a follow-up. For
 * pilot, free-text + category is enough for ops to triage.
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

import { FE } from '../../services/api';
import { BackButton, Button } from '../../components/ui';
import { parseApiError } from '../../utils/errors';
import { C, R, S, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

const CATEGORIES: Array<{
  key:
    | 'item_damage'
    | 'seller_backout'
    | 'address_mismatch'
    | 'seller_absent'
    | 'safety_concern'
    | 'other';
  emoji: string;
  label: string;
  hint: string;
}> = [
  { key: 'item_damage', emoji: '⚠️', label: 'Item is damaged / not as described', hint: 'medium severity' },
  { key: 'seller_backout', emoji: '⚠️', label: 'Seller wants to back out', hint: 'medium severity' },
  { key: 'address_mismatch', emoji: '⚠️', label: 'Address doesn\'t match', hint: 'low severity' },
  { key: 'seller_absent', emoji: '⚠️', label: 'Seller not present', hint: 'high severity' },
  { key: 'safety_concern', emoji: '🚨', label: 'Safety concern', hint: 'urgent — admin paged immediately' },
  { key: 'other', emoji: '⚠️', label: 'Other', hint: 'low severity' },
];

export default function ReportIssueScreen({
  navigation,
  route,
}: RootScreen<'ReportIssue'>) {
  const { visitId } = route.params;
  const [category, setCategory] = useState<typeof CATEGORIES[number]['key'] | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!category) return;
    setSubmitting(true);
    try {
      await FE.reportIssue(visitId, {
        category,
        description: description.trim() || undefined,
      });
      Alert.alert('Reported', 'Ops has been notified.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Could not report', parseApiError(e, 'Try again.'));
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Report an issue</Text>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.label}>What happened?</Text>
        {CATEGORIES.map((c) => {
          const isOn = category === c.key;
          return (
            <TouchableOpacity
              key={c.key}
              style={[s.row, isOn && s.rowOn]}
              onPress={() => setCategory(c.key)}
              activeOpacity={0.85}
            >
              <Text style={s.emoji}>{c.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.rowLabel, isOn && s.rowLabelOn]}>{c.label}</Text>
                <Text style={s.rowHint}>{c.hint}</Text>
              </View>
              {isOn ? <Text style={s.tick}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}

        <Text style={[s.label, { marginTop: S.lg }]}>Tell us more</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={2000}
          placeholder="What happened? Be specific."
          placeholderTextColor={C.text4}
          style={s.input}
          textAlignVertical="top"
        />

        <View style={{ height: S.lg }} />

        <Button
          label="Submit report"
          onPress={onSubmit}
          disabled={!category || submitting}
          loading={submitting}
        />
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
    gap: S.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  body: { padding: S.lg },
  label: {
    fontSize: 13,
    color: C.text2,
    fontWeight: '600',
    marginBottom: S.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: R.md,
    padding: S.md,
    marginBottom: S.sm,
    borderWidth: 1,
    borderColor: C.border,
    gap: S.md,
  },
  rowOn: {
    backgroundColor: C.honeyLight,
    borderColor: C.honey,
  },
  emoji: { fontSize: 22 },
  rowLabel: {
    fontSize: 14,
    color: C.text,
    fontWeight: '600',
  },
  rowLabelOn: {
    color: C.honeyDeep,
  },
  rowHint: {
    fontSize: 12,
    color: C.text3,
    marginTop: 2,
  },
  tick: {
    fontSize: 18,
    color: C.honeyDeep,
    fontWeight: '700',
  },
  input: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 100,
    padding: S.md,
    fontSize: 14,
    color: C.text,
  },
});
