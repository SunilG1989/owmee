/**
 * VisitDetailScreen — Concierge master spec section 5
 *
 * The seller's view of an upcoming or in-progress visit. Deep-link
 * target for N2-N5 push notifications. Shows:
 *   - Visit slot + address (read from snapshot)
 *   - SpecialistProfileCard once assigned
 *   - Arrival verification code (visible after specialist marks "arrived")
 *   - Notes the seller submitted at booking
 *
 * Phase 4 will add timeline state for completed visits (sold items,
 * payouts). For Phase 2 we just show the active-visit info.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { FEVisits, type FEVisit, type FEVisitCancelReason } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import SpecialistProfileCard from '../../../components/concierge/SpecialistProfileCard';
import ReasonSheet, { type ReasonOption } from '../../../components/listing/ReasonSheet';
import { parseApiError } from '../../../utils/errors';
import { C, R, S, T, Shadow } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';
import { afterInteractions } from '../../../utils/schedule';

// Mirrors backend _VALID_CANCEL_REASONS. Order = chip order users see.
const CANCEL_REASONS: ReasonOption<FEVisitCancelReason>[] = [
  { key: 'changed_mind',       label: 'Changed my mind' },
  { key: 'sold_elsewhere',     label: 'Sold elsewhere' },
  { key: 'schedule_conflict',  label: 'Schedule clash' },
  { key: 'fe_late',            label: 'Specialist running late' },
  { key: 'no_longer_selling',  label: 'Not selling anymore' },
  { key: 'other',              label: 'Other' },
];

// Visit statuses where the seller can self-serve cancel. `in_progress`
// or terminal (completed / cancelled / no_show) means the FE is at the
// door or the visit is already closed — block here, point at support.
const CANCELLABLE_STATUSES = new Set<FEVisit['status']>(['requested', 'scheduled']);

export default function VisitDetailScreen({
  navigation,
  route,
}: RootScreen<'VisitDetail'>) {
  const { visit_id } = route.params;
  const [visit, setVisit] = useState<FEVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCancelSheet, setShowCancelSheet] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await FEVisits.get(visit_id);
      setVisit(r.data);
    } catch {
      setVisit(null);
    } finally {
      setLoading(false);
    }
  }, [visit_id]);

  useFocusEffect(
    useCallback(() => afterInteractions(load), [load]),
  );

  const submitCancel = useCallback(
    async (reason: FEVisitCancelReason, note: string) => {
      if (!visit) return;
      setCancelling(true);
      try {
        await FEVisits.cancel(visit.id, reason, note);
        setShowCancelSheet(false);
        Alert.alert(
          'Visit cancelled',
          'Your specialist has been notified. You can book another visit anytime.',
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      } catch (e) {
        Alert.alert('Could not cancel', parseApiError(e));
      } finally {
        setCancelling(false);
      }
    },
    [visit, navigation],
  );

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator color={C.petrol} />
        </View>
      </SafeAreaView>
    );
  }

  if (!visit) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
        </View>
        <View style={s.center}>
          <Text style={{ color: C.text3 }}>We couldn't load this visit.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const slotLabel = formatSlotLabel(visit);
  const addressText = formatAddress(visit.address);
  const isAssigned = !!visit.fe_id;
  const showCode = visit.status === 'in_progress' && visit.arrival_verification_code;
  const canCancel = CANCELLABLE_STATUSES.has(visit.status);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Your visit</Text>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.card}>
          <Text style={s.cardLabel}>WHEN</Text>
          <Text style={s.cardValue}>{slotLabel}</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardLabel}>WHERE</Text>
          <Text style={s.cardValue}>{addressText}</Text>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Your specialist</Text>
          {isAssigned ? (
            <SpecialistProfileCard visitId={visit.id} />
          ) : (
            <View style={s.matchingCard}>
              <Text style={s.matchingTitle}>Matching specialist</Text>
              <Text style={s.matchingBody}>
                We'll notify you within 4 hours once an Owmee Specialist
                accepts your visit.
              </Text>
            </View>
          )}
        </View>

        {showCode ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Verification code</Text>
            <View style={s.codeCard}>
              <Text style={s.codeText}>{visit.arrival_verification_code}</Text>
              <Text style={s.codeHint}>
                Your specialist should tell you this code at the door.
              </Text>
              <Button
                label="Open verification"
                onPress={() =>
                  navigation.navigate('ArrivalVerification', { visit_id: visit.id })
                }
                variant="secondary"
                size="sm"
                style={{ marginTop: S.md }}
              />
            </View>
          </View>
        ) : null}

        {visit.notes_tags && visit.notes_tags.length > 0 ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>What you mentioned</Text>
            <Text style={s.tagsLine}>
              {visit.notes_tags.join(' · ')}
            </Text>
            {visit.item_notes ? (
              <Text style={s.notesLine}>"{visit.item_notes}"</Text>
            ) : null}
          </View>
        ) : visit.item_notes ? (
          <View style={s.section}>
            <Text style={s.sectionTitle}>What you mentioned</Text>
            <Text style={s.notesLine}>"{visit.item_notes}"</Text>
          </View>
        ) : null}

        {canCancel ? (
          <View style={s.section}>
            <Button
              label="Cancel visit"
              variant="secondary"
              size="lg"
              fullWidth
              onPress={() => setShowCancelSheet(true)}
            />
            <Text style={s.cancelHelp}>
              Free to cancel. Your specialist will be notified.
            </Text>
          </View>
        ) : null}

        <View style={{ height: S.xl }} />
      </ScrollView>

      <ReasonSheet<FEVisitCancelReason>
        visible={showCancelSheet}
        title="Cancel this visit?"
        message="Your concierge specialist will be notified right away. You can book another visit whenever you're ready."
        reasons={CANCEL_REASONS}
        confirmLabel="Cancel visit"
        loading={cancelling}
        onConfirm={submitCancel}
        onClose={() => !cancelling && setShowCancelSheet(false)}
      />
    </SafeAreaView>
  );
}

function formatSlotLabel(visit: FEVisit): string {
  const startIso = visit.scheduled_slot_start || visit.requested_slot_start;
  const endIso = visit.scheduled_slot_end || visit.requested_slot_end;
  if (!startIso) return '—';
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : null;
  const dayLabel = start.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  const sH = start.getHours();
  const eH = end?.getHours() ?? sH + 2;
  const fmt = (h: number) =>
    h === 12 ? '12' : h > 12 ? String(h - 12) : String(h);
  const ampm = (h: number) => (h < 12 ? 'am' : 'pm');
  const samePeriod = (sH < 12) === (eH < 12);
  const time = samePeriod
    ? `${fmt(sH)}-${fmt(eH)}${ampm(eH)}`
    : `${fmt(sH)}${ampm(sH)}-${fmt(eH)}${ampm(eH)}`;
  return `${dayLabel}, ${time}`;
}

function formatAddress(snap: any): string {
  if (!snap) return '—';
  const parts = [
    snap.flat_house_number || snap.house,
    snap.building_name,
    snap.locality,
    snap.city,
    snap.pincode,
  ].filter(Boolean);
  return parts.join(', ');
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
  },
  body: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.xl,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.md,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  cardLabel: {
    fontSize: T.size.sm,
    color: C.text3,
    fontWeight: T.weight.bold,
    letterSpacing: 0.5,
    marginBottom: S.xs,
  },
  cardValue: {
    fontSize: T.size.md,
    color: C.text,
    fontWeight: T.weight.medium,
    lineHeight: 21,
  },
  section: { marginTop: S.md },
  sectionTitle: {
    fontSize: T.size.lg - 1,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.sm,
  },
  matchingCard: {
    backgroundColor: C.petrolLight,
    borderRadius: R.lg,
    padding: S.lg,
  },
  matchingTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.petrolText,
  },
  matchingBody: {
    fontSize: T.size.base,
    color: C.petrolText,
    marginTop: S.xs,
    lineHeight: 18,
  },
  codeCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    alignItems: 'center',
    ...Shadow.glow,
  },
  codeText: {
    fontSize: T.size.display + 6,
    fontWeight: T.weight.heavy,
    color: C.petrolDeep,
    letterSpacing: 6,
  },
  codeHint: {
    fontSize: T.size.sm,
    color: C.text3,
    marginTop: S.xs + 2,
    textAlign: 'center',
  },
  tagsLine: {
    fontSize: T.size.base,
    color: C.text2,
    fontWeight: T.weight.medium,
    marginBottom: S.xs + 2,
  },
  notesLine: {
    fontSize: T.size.sm + 1,
    color: C.text,
    fontStyle: 'italic',
    lineHeight: 20,
  },
  cancelHelp: {
    fontSize: T.size.sm,
    color: C.text3,
    textAlign: 'center',
    marginTop: S.sm,
  },
});
