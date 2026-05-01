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
  SafeAreaView, View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, ActivityIndicator, Alert,
} from 'react-native';

import { FEVisits } from '../../services/api';
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
      return { label: 'Looking for a field executive', color: C.honeyText, bg: C.honeyLight };
    case 'scheduled':
      return { label: 'Scheduled', color: C.forestText, bg: C.forestLight };
    case 'in_progress':
      return { label: 'In progress', color: C.forest, bg: C.forestLight };
    case 'completed':
      return { label: 'Completed', color: C.forestText, bg: C.forestLight };
    case 'cancelled':
      return { label: 'Cancelled', color: C.red, bg: C.redLight };
    case 'no_show':
      return { label: 'No-show', color: C.red, bg: C.redLight };
    case 'postponed':
      return { label: 'Postponed', color: C.honeyText, bg: C.honeyLight };
    default:
      return { label: status, color: C.text3, bg: C.sand };
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
          <ActivityIndicator color={C.honey} />
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
        contentContainerStyle={{ padding: S.xxxl, paddingBottom: S.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.honey} />}
      >
        <View style={st.check}>
          <Text style={st.checkIcon}>✓</Text>
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

        <View style={{ height: S.xl }} />

        <Text style={st.refLabel}>Booking reference</Text>
        <Text style={st.ref}>{visitId}</Text>

        <TouchableOpacity
          style={st.primaryBtn}
          onPress={() => navigation.navigate('MainTabs' as never)}
        >
          <Text style={st.primaryBtnText}>Back to home</Text>
        </TouchableOpacity>

        {canCancel ? (
          <TouchableOpacity
            style={st.cancelBtn}
            onPress={cancel}
            disabled={cancelling}
          >
            <Text style={st.cancelBtnText}>
              {cancelling ? 'Cancelling…' : 'Cancel this visit'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  check: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.forestLight,
    alignSelf: 'center',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: S.xl,
    ...Shadow.glow,
  },
  checkIcon: { fontSize: 36, color: C.forestText, fontWeight: '700' },
  h1: { fontSize: T.h1, fontWeight: '700', color: C.text, textAlign: 'center', marginBottom: 6 },
  sub: { fontSize: T.body, color: C.text3, textAlign: 'center', marginBottom: S.lg },
  statusPill: {
    alignSelf: 'center',
    paddingHorizontal: S.md, paddingVertical: 6,
    borderRadius: R.pill,
    marginBottom: S.xl,
  },
  statusPillText: { fontSize: T.small, fontWeight: '700' },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  cardLabel: { fontSize: T.small, color: C.text3, fontWeight: '600', marginBottom: 4 },
  cardValue: { fontSize: T.body, color: C.text, fontWeight: '600' },
  cardHint: { fontSize: T.small, color: C.text3, marginTop: 4 },
  refLabel: { fontSize: T.small, color: C.text3, marginBottom: 2 },
  ref: {
    fontSize: T.small, color: C.text2, fontFamily: 'monospace',
    marginBottom: S.xl,
  },
  primaryBtn: {
    backgroundColor: C.honey, paddingVertical: S.md,
    borderRadius: R.md, alignItems: 'center',
    ...Shadow.glow,
  },
  primaryBtnText: { color: C.white, fontSize: T.body, fontWeight: '700' },
  cancelBtn: { paddingVertical: S.md, alignItems: 'center', marginTop: S.sm },
  cancelBtnText: { color: C.red, fontSize: T.small, textDecorationLine: 'underline' },
});
