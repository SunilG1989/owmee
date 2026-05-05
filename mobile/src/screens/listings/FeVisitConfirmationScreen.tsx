/**
 * FeVisitConfirmation — Sprint 4 / Pass 3 (3f)
 *
 * Shown after the seller successfully books an FE visit. Real screen
 * replacing the Pass 2 stub.
 *
 * Fetches the visit detail from /v1/fe-visits/me so the seller sees the
 * slot they requested plus status updates (requested → scheduled).
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  SafeAreaView, View, Text, ScrollView,
  StyleSheet, RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { CircleCheck } from 'lucide-react-native';

import { FEVisits } from '../../services/api';
import { Button } from '../../components/ui';
import { C, T, S, R, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

interface Visit {
  id: string;
  status: string;
  fe_code?: string | null;
  category_hint: string;
  category_name?: string | null;
  requested_slot_start: string;
  requested_slot_end: string;
  scheduled_slot_start?: string | null;
  scheduled_slot_end?: string | null;
  address: any;
  created_at: string;
}

function fmtSlot(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusMeta(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case 'requested':
      return { label: 'Looking for a field executive', color: C.petrolText, bg: C.petrolLight };
    case 'scheduled':
      return { label: 'Scheduled', color: C.petrolText, bg: C.petrolLight };
    case 'in_progress':
      return { label: 'In progress', color: C.petrol, bg: C.petrolLight };
    case 'completed':
      return { label: 'Completed', color: C.petrolText, bg: C.petrolLight };
    case 'cancelled':
      return { label: 'Cancelled', color: C.red, bg: C.redLight };
    case 'no_show':
      return { label: 'No-show', color: C.red, bg: C.redLight };
    case 'postponed':
      return { label: 'Postponed', color: C.petrolText, bg: C.petrolLight };
    default:
      return { label: status, color: C.text3, bg: C.bone2 };
  }
}

export default function FeVisitConfirmationScreen({
  route, navigation,
}: RootScreen<'FeVisitConfirmation'>) {
  const { visitId } = route.params;
  const [visit, setVisit] = useState<Visit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const loadVisit = useCallback(async () => {
    try {
      const r = await FEVisits.mine();
      const visits: Visit[] = r.data || [];
      const found = visits.find((v) => v.id === visitId);
      setVisit(found || null);
    } catch (e) {
      // Show UI even on fetch error — we know the ID at least
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [visitId]);

  useEffect(() => {
    loadVisit();
  }, [loadVisit]);

  const onRefresh = () => {
    setRefreshing(true);
    loadVisit();
  };

  const cancel = () => {
    Alert.alert(
      'Cancel visit?',
      'This will release your slot. You can book again anytime.',
      [
        { text: 'Keep visit', style: 'cancel' },
        {
          text: 'Cancel visit',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await FEVisits.cancel(visitId);
              navigation.navigate('MainTabs' as never);
            } catch (e: any) {
              Alert.alert(
                'Failed',
                e?.response?.data?.detail?.message || 'Could not cancel. Try again.',
              );
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={st.root}>
        <View style={st.center}>
          <ActivityIndicator color={C.petrol} />
        </View>
      </SafeAreaView>
    );
  }

  const meta = visit ? statusMeta(visit.status) : statusMeta('requested');
  const scheduled = visit?.scheduled_slot_start;
  const canCancel = visit && ['requested', 'scheduled'].includes(visit.status);

  return (
    <SafeAreaView style={st.root}>
      <ScrollView
        contentContainerStyle={st.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.petrol} />}
      >
        <View style={st.check}>
          <CircleCheck size={40} strokeWidth={2.2} color={C.petrolDeep} />
        </View>
        <Text style={st.h1}>Visit booked</Text>
        <Text style={st.sub}>
          An Owmee Field Executive will bring your listing to life.
        </Text>

        <View style={[st.statusPill, { backgroundColor: meta.bg }]}>
          <Text style={[st.statusPillText, { color: meta.color }]}>
            {meta.label}
          </Text>
        </View>

        {visit?.fe_code ? (
          <View style={st.card}>
            <Text style={st.cardLabel}>Your FE</Text>
            <Text style={st.cardValue}>{visit.fe_code}</Text>
          </View>
        ) : null}

        <View style={st.card}>
          <Text style={st.cardLabel}>Category</Text>
          <Text style={st.cardValue}>
            {visit?.category_name || visit?.category_hint || '—'}
          </Text>
        </View>

        <View style={st.card}>
          <Text style={st.cardLabel}>
            {scheduled ? 'Scheduled time' : 'Your requested slot'}
          </Text>
          <Text style={st.cardValue}>
            {fmtSlot(scheduled || visit?.requested_slot_start)}
          </Text>
          {!scheduled ? (
            <Text style={st.cardHint}>
              We’ll confirm the exact time once an FE accepts.
            </Text>
          ) : null}
        </View>

        {visit?.address ? (
          <View style={st.card}>
            <Text style={st.cardLabel}>Visit address</Text>
            <Text style={st.cardValue}>
              {[
                visit.address.house, visit.address.street, visit.address.locality,
                visit.address.city, visit.address.pincode,
              ].filter(Boolean).join(', ')}
            </Text>
          </View>
        ) : null}

        <View style={st.gap} />

        <Text style={st.refLabel}>Booking reference</Text>
        <Text style={st.ref}>{visitId}</Text>

        <Button
          label="Back to home"
          variant="primary"
          size="lg"
          onPress={() => navigation.navigate('MainTabs' as never)}
          fullWidth
          style={st.primaryBtn}
        />

        {canCancel ? (
          <Text
            style={st.cancelLink}
            onPress={cancel}
            accessibilityRole="button"
          >
            {cancelling ? 'Cancelling…' : 'Cancel this visit'}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bone },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  check: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.petrolLight,
    alignSelf: 'center',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: S.xl,
    ...Shadow.glow,
  },
  scroll: { padding: S.xxxl, paddingBottom: S.xxl },
  gap: { height: S.xl },
  h1: { fontSize: T.h1, fontWeight: T.weight.bold, color: C.text, textAlign: 'center', marginBottom: S.xs + 2 },
  sub: { fontSize: T.body, color: C.text3, textAlign: 'center', marginBottom: S.lg },
  statusPill: {
    alignSelf: 'center',
    paddingHorizontal: S.md, paddingVertical: S.xs + 2,
    borderRadius: R.pill,
    marginBottom: S.xl,
  },
  statusPillText: { fontSize: T.small, fontWeight: T.weight.bold },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  cardLabel: { fontSize: T.small, color: C.text3, fontWeight: T.weight.semi, marginBottom: S.xs },
  cardValue: { fontSize: T.body, color: C.text, fontWeight: T.weight.semi },
  cardHint: { fontSize: T.small, color: C.text3, marginTop: S.xs },
  refLabel: { fontSize: T.small, color: C.text3, marginBottom: 2 },
  ref: {
    fontSize: T.small, color: C.text2, fontFamily: 'monospace',
    marginBottom: S.xl,
  },
  primaryBtn: { ...Shadow.glow },
  cancelLink: {
    color: C.red, fontSize: T.small,
    textDecorationLine: 'underline',
    textAlign: 'center',
    marginTop: S.md,
    paddingVertical: S.md,
  },
});
