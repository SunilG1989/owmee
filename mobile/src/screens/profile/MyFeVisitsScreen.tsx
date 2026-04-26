/**
 * My FE Visits — Sprint 4 / Pass 4d
 *
 * Shows the consumer (seller) their booked FE visits. Uses the existing
 * GET /v1/fe-visits/me endpoint already shipped in Pass 2.
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

import { FEVisits } from '../../services/api';
import { C, S, R, T, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

interface Visit {
  id: string;
  status: string;
  category_hint: string;
  requested_slot_start: string | null;
  requested_slot_end: string | null;
  scheduled_slot_start: string | null;
  scheduled_slot_end: string | null;
  fe_code: string | null;
  item_notes: string | null;
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

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    requested:   { bg: C.sand,        fg: C.text2,     label: 'Requested' },
    scheduled:   { bg: C.honeyLight,  fg: C.honeyText, label: 'Scheduled' },
    in_progress: { bg: '#E6F5EC',     fg: '#1F6B3A',   label: 'In progress' },
    completed:   { bg: '#E6F0FB',     fg: '#1F4E8F',   label: 'Completed' },
    postponed:   { bg: C.sand,        fg: C.text2,     label: 'Postponed' },
    cancelled:   { bg: '#FBE6E6',     fg: '#8F1F1F',   label: 'Cancelled' },
    no_show:     { bg: '#FBE6E6',     fg: '#8F1F1F',   label: 'No show' },
  };
  const m = map[status] || { bg: C.sand, fg: C.text2, label: status };
  return (
    <View style={[st.pill, { backgroundColor: m.bg }]}>
      <Text style={[st.pillText, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

export default function MyFeVisitsScreen({ navigation }: RootScreen<'MyFeVisits'>) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await FEVisits.mine();
      setVisits(res.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail?.message || 'Could not load your visits.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn}>
          <Text style={st.backGlyph}>‹</Text>
        </TouchableOpacity>
        <View>
          <Text style={st.h1}>Your FE visits</Text>
          <Text style={st.subtitle}>
            {visits.length} {visits.length === 1 ? 'booking' : 'bookings'}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={st.centerFill}>
          <ActivityIndicator color={C.honey} />
        </View>
      ) : error ? (
        <View style={st.centerFill}>
          <Text style={st.err}>{error}</Text>
          <TouchableOpacity onPress={load} style={st.retryBtn}>
            <Text style={st.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : visits.length === 0 ? (
        <View style={st.centerFill}>
          <Text style={st.empty}>No FE visits booked yet.</Text>
          <Text style={st.emptyHint}>
            Book an FE visit when you list an item — our executive will come
            pick up photos and verify your item for you.
          </Text>
        </View>
      ) : (
        <FlatList
          data={visits}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: S.lg, paddingBottom: S.xxxl }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.honey} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={st.card}
              activeOpacity={0.8}
              onPress={() =>
                navigation.navigate('FeVisitConfirmation', { visitId: item.id })
              }
            >
              <View style={st.cardTop}>
                <Text style={st.cardTitle}>{item.category_hint}</Text>
                <StatusPill status={item.status} />
              </View>
              {item.scheduled_slot_start ? (
                <Text style={st.cardSlot}>
                  📅 {formatSlot(item.scheduled_slot_start)}
                  {' – '}
                  {formatSlot(item.scheduled_slot_end)}
                </Text>
              ) : (
                <Text style={st.cardSlot}>
                  Requested: {formatSlot(item.requested_slot_start)}
                </Text>
              )}
              {item.fe_code ? (
                <Text style={st.cardFe}>FE assigned: {item.fe_code}</Text>
              ) : null}
              {item.item_notes ? (
                <Text style={st.cardNotes} numberOfLines={2}>{item.item_notes}</Text>
              ) : null}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', padding: S.lg, gap: S.md },
  backBtn: {
    width: 40, height: 40, borderRadius: R.md, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.glow,
  },
  backGlyph: { fontSize: 28, lineHeight: 30, color: C.text, fontWeight: '300' },
  h1: { fontSize: T.h2, fontWeight: '700', color: C.text },
  subtitle: { fontSize: T.body, color: C.text3, marginTop: 2 },
  card: {
    backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, marginBottom: S.md,
    ...Shadow.glow,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: T.h3, fontWeight: '600', color: C.text, flex: 1, marginRight: S.sm },
  cardSlot: { fontSize: T.body, color: C.honeyText, fontWeight: '500', marginTop: S.sm },
  cardFe: { fontSize: T.body, color: C.text2, marginTop: S.xs },
  cardNotes: { fontSize: T.small, color: C.text3, marginTop: S.sm, fontStyle: 'italic' },
  pill: { paddingHorizontal: S.sm, paddingVertical: 2, borderRadius: R.pill },
  pillText: { fontSize: T.small, fontWeight: '600' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl },
  err: { fontSize: T.body, color: C.text2, textAlign: 'center' },
  retryBtn: {
    marginTop: S.md, paddingHorizontal: S.lg, paddingVertical: S.sm,
    backgroundColor: C.honey, borderRadius: R.md,
  },
  retryBtnText: { color: '#fff', fontWeight: '600' },
  empty: { fontSize: T.h3, color: C.text, fontWeight: '600' },
  emptyHint: { fontSize: T.body, color: C.text3, marginTop: S.sm, textAlign: 'center' },
});
