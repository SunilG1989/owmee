/**
 * FE Home screen — Sprint 4 / Pass 2
 *
 * The Field Executive's default landing screen after login. Shows their
 * assigned visits grouped by status (Active / Scheduled / Completed).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FE, FEOnboarding, type DirectAcquisitionBooking, type FEProfile, type FEVisit } from '../../services/api';
import { Button, Chip, IconButton } from '../../components/ui';
import { C, S, R, T, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';

type Tab = 'active' | 'scheduled' | 'completed';
type WorkItem =
  | { kind: 'direct'; id: string; booking: DirectAcquisitionBooking }
  | { kind: 'legacy'; id: string; visit: FEVisit };

function visitBucket(v: FEVisit): Tab {
  if (v.status === 'in_progress') return 'active';
  if (v.status === 'scheduled') return 'scheduled';
  return 'completed';
}

function directBucket(b: DirectAcquisitionBooking): Tab {
  if ([
    'fe_arrived',
    'seller_verified',
    'pickup_qc_in_progress',
    'seller_final_acceptance',
    'payout_ready',
    'payout_completed',
  ].includes(String(b.status))) return 'active';
  if (['assigned_to_fe', 'fe_en_route'].includes(String(b.status))) return 'scheduled';
  return 'completed';
}

function formatSlot(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function StatusPill({ status }: { status: FEVisit['status'] }) {
  const map: Record<FEVisit['status'], { bg: string; fg: string; label: string }> = {
    requested: { bg: C.bone2, fg: C.text2, label: 'Requested' },
    scheduled: { bg: C.petrolLight, fg: C.petrolText, label: 'Scheduled' },
    in_progress: { bg: C.petrolLight, fg: C.petrolText, label: 'Active' },
    completed: { bg: C.petrolLight, fg: C.petrol, label: 'Completed' },
    postponed: { bg: C.bone2, fg: C.text2, label: 'Postponed' },
    cancelled: { bg: C.redLight, fg: C.red, label: 'Cancelled' },
    no_show: { bg: C.redLight, fg: C.red, label: 'No show' },
  };
  const m = map[status];
  return (
    <View style={[st.pill, { backgroundColor: m.bg }]}>
      <Text style={[st.pillText, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

export default function FeHomeScreen({ navigation }: RootScreen<'FeHome'>) {
  const [visits, setVisits] = useState<FEVisit[]>([]);
  const [directBookings, setDirectBookings] = useState<DirectAcquisitionBooking[]>([]);
  const [profile, setProfile] = useState<FEProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('active');
  const [error, setError] = useState<string | null>(null);

  const logout = useAuthStore((s) => s.logout);

  const load = useCallback(async () => {
    try {
      setError(null);
      const profileRes = await FEOnboarding.me();
      const nextProfile = profileRes.data;
      setProfile(nextProfile);
      if (!nextProfile.active || (nextProfile.readiness_gaps || []).length > 0) {
        navigation.reset({ index: 0, routes: [{ name: 'FeOnboarding' }] });
        return;
      }
      const [visitRes, directRes] = await Promise.all([
        FE.assignedVisits(),
        FE.directBookings(),
      ]);
      setVisits(visitRes.data || []);
      setDirectBookings(directRes.data?.bookings || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail?.message || 'Could not load assigned visits.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [navigation]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const runShift = async (mode: 'in' | 'out') => {
    setShiftBusy(true);
    try {
      const res = mode === 'in' ? await FEOnboarding.checkIn() : await FEOnboarding.checkOut();
      setProfile(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail?.message || 'Could not update shift.');
    } finally {
      setShiftBusy(false);
    }
  };

  const filteredVisits = visits.filter((v) => visitBucket(v) === tab);
  const filteredDirect = directBookings.filter((b) => directBucket(b) === tab);
  const workItems: WorkItem[] = [
    ...filteredDirect.map((booking) => ({ kind: 'direct' as const, id: `direct:${booking.id}`, booking })),
    ...filteredVisits.map((visit) => ({ kind: 'legacy' as const, id: `legacy:${visit.id}`, visit })),
  ];

  const counts: Record<Tab, number> = {
    active:
      visits.filter((v) => visitBucket(v) === 'active').length +
      directBookings.filter((b) => directBucket(b) === 'active').length,
    scheduled:
      visits.filter((v) => visitBucket(v) === 'scheduled').length +
      directBookings.filter((b) => directBucket(b) === 'scheduled').length,
    completed:
      visits.filter((v) => visitBucket(v) === 'completed').length +
      directBookings.filter((b) => directBucket(b) === 'completed').length,
  };

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <View style={st.header}>
        <View>
          <Text style={st.h1}>Field visits</Text>
          <Text style={st.subtitle}>
            {counts.active} active · {counts.scheduled} upcoming · Shift {String(profile?.current_shift || 'off').replace(/_/g, ' ')}
          </Text>
        </View>
        <View style={st.headerActions}>
          <Button
            label={profile?.current_shift === 'available' ? 'End shift' : 'Start shift'}
            size="sm"
            variant={profile?.current_shift === 'available' ? 'secondary' : 'primary'}
            loading={shiftBusy}
            onPress={() => runShift(profile?.current_shift === 'available' ? 'out' : 'in')}
          />
          <IconButton
            icon="📦"
            onPress={() => navigation.navigate('FeOps')}
            a11y="Operations"
            variant="outlined"
          />
          <IconButton
            icon="history"
            onPress={() => navigation.navigate('FeVisitHistory')}
            a11y="Visit history"
            variant="outlined"
          />
        </View>
      </View>

      <View style={st.tabs}>
        {(['active', 'scheduled', 'completed'] as Tab[]).map((t) => {
          const label = t === 'active' ? 'Active' : t === 'scheduled' ? 'Scheduled' : 'Done';
          const labelWithCount = counts[t] > 0 ? `${label} (${counts[t]})` : label;
          return (
            <Chip
              key={t}
              label={labelWithCount}
              selected={tab === t}
              variant="filter"
              onPress={() => setTab(t)}
              style={st.tab}
            />
          );
        })}
      </View>

      {loading ? (
        <View style={st.centerFill}>
          <ActivityIndicator color={C.petrol} />
        </View>
      ) : error ? (
        <View style={st.centerFill}>
          <Text style={st.err}>{error}</Text>
          <Button label="Try again" variant="primary" onPress={load} style={st.retryBtn} />
        </View>
      ) : workItems.length === 0 ? (
        <View style={st.centerFill}>
          <Text style={st.empty}>No {tab} visits.</Text>
        </View>
      ) : (
        <FlatList
          data={workItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={st.listPadding}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.petrol} />}
          renderItem={({ item }) => item.kind === 'direct' ? (
            <TouchableOpacity
              style={[st.card, st.directCard]}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('FeDirectBookingDetail', { bookingId: item.booking.id })}
            >
              <View style={st.cardTop}>
                <View style={{ flex: 1, marginRight: S.sm }}>
                  <Text style={st.directKicker}>Owmee Direct</Text>
                  <Text style={st.cardTitle}>{item.booking.booking_code}</Text>
                </View>
                <View style={st.directStatus}>
                  <Text style={st.directStatusText}>{String(item.booking.status).replace(/_/g, ' ')}</Text>
                </View>
              </View>
              <Text style={st.cardAddr} numberOfLines={2}>
                {[item.booking.pickup_locality, item.booking.pickup_address?.city, item.booking.pickup_pincode]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </Text>
              <Text style={st.cardSlot}>
                {formatSlot(item.booking.slot_start)} – {formatSlot(item.booking.slot_end)}
              </Text>
              <Text style={st.cardNotes} numberOfLines={2}>
                {item.booking.item_count} item{item.booking.item_count === 1 ? '' : 's'} · Estimated payout ₹{item.booking.estimated_total_offer_inr}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={st.card}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('FeVisitDetail', { visitId: item.visit.id })}
            >
              <View style={st.cardTop}>
                <Text style={st.cardTitle}>{item.visit.category_hint}</Text>
                <StatusPill status={item.visit.status} />
              </View>
              <Text style={st.cardAddr} numberOfLines={2}>
                {[item.visit.address?.locality, item.visit.address?.city].filter(Boolean).join(', ') || '—'}
              </Text>
              {item.visit.scheduled_slot_start ? (
                <Text style={st.cardSlot}>
                  {formatSlot(item.visit.scheduled_slot_start)} – {formatSlot(item.visit.scheduled_slot_end)}
                </Text>
              ) : (
                <Text style={st.cardSlot}>Requested: {formatSlot(item.visit.requested_slot_start)}</Text>
              )}
              {item.visit.item_notes ? (
                <Text style={st.cardNotes} numberOfLines={2}>{item.visit.item_notes}</Text>
              ) : null}
            </TouchableOpacity>
          )}
        />
      )}

      <Button label="Sign out" variant="ghost" size="sm" onPress={logout} style={st.logout} />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bone },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg },
  headerActions: { flexDirection: 'row', gap: S.sm },
  h1: { fontSize: T.h2, fontWeight: T.weight.bold, color: C.text },
  subtitle: { fontSize: T.body, color: C.text3, marginTop: 2 },

  tabs: { flexDirection: 'row', paddingHorizontal: S.lg, marginBottom: S.sm, gap: S.sm },
  tab: { flex: 0 },                                  // chip natural-width

  listPadding: { padding: S.lg, paddingBottom: S.xxxl },
  card: {
    backgroundColor: C.surface, borderRadius: R.lg,
    padding: S.lg, marginBottom: S.md,
    ...Shadow.glow,
  },
  directCard: {
    borderWidth: 1,
    borderColor: C.petrolGlow,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  directKicker: { fontSize: T.small, color: C.petrolDeep, fontWeight: T.weight.bold, marginBottom: 2 },
  directStatus: {
    backgroundColor: C.petrolLight,
    borderRadius: R.pill,
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    maxWidth: 142,
  },
  directStatusText: { color: C.petrolDeep, fontSize: T.small, fontWeight: T.weight.semi, textTransform: 'capitalize' },
  cardTitle: { fontSize: T.h3, fontWeight: T.weight.semi, color: C.text, flex: 1, marginRight: S.sm },
  cardAddr: { fontSize: T.body, color: C.text2, marginTop: S.xs },
  cardSlot: { fontSize: T.body, color: C.petrolText, fontWeight: T.weight.medium, marginTop: S.xs },
  cardNotes: { fontSize: T.small, color: C.text3, marginTop: S.sm, fontStyle: 'italic' },

  pill: { paddingHorizontal: S.sm, paddingVertical: 2, borderRadius: R.pill },
  pillText: { fontSize: T.small, fontWeight: T.weight.semi },

  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl },
  err: { fontSize: T.body, color: C.text2, textAlign: 'center' },
  retryBtn: { marginTop: S.md },
  empty: { fontSize: T.body, color: C.text3 },

  logout: { alignSelf: 'center', marginBottom: S.md },
});
