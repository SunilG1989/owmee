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

import { FE, type FEVisit } from '../../services/api';
import { Button, Chip, IconButton } from '../../components/ui';
import { C, S, R, T, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';

type Tab = 'active' | 'scheduled' | 'completed';

function visitBucket(v: FEVisit): Tab {
  if (v.status === 'in_progress') return 'active';
  if (v.status === 'scheduled') return 'scheduled';
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('active');
  const [error, setError] = useState<string | null>(null);

  const logout = useAuthStore((s) => s.logout);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await FE.assignedVisits();
      setVisits(res.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail?.message || 'Could not load assigned visits.');
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

  const filtered = visits.filter((v) => visitBucket(v) === tab);

  const counts: Record<Tab, number> = {
    active: visits.filter((v) => visitBucket(v) === 'active').length,
    scheduled: visits.filter((v) => visitBucket(v) === 'scheduled').length,
    completed: visits.filter((v) => visitBucket(v) === 'completed').length,
  };

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <View style={st.header}>
        <View>
          <Text style={st.h1}>Field visits</Text>
          <Text style={st.subtitle}>{counts.active} active · {counts.scheduled} upcoming</Text>
        </View>
        <View style={st.headerActions}>
          <IconButton
            icon="📦"
            onPress={() => navigation.navigate('FeOps')}
            a11y="Operations"
            variant="outlined"
          />
          <IconButton
            icon="⌕"
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
      ) : filtered.length === 0 ? (
        <View style={st.centerFill}>
          <Text style={st.empty}>No {tab} visits.</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(v) => v.id}
          contentContainerStyle={st.listPadding}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.petrol} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={st.card}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('FeVisitDetail', { visitId: item.id })}
            >
              <View style={st.cardTop}>
                <Text style={st.cardTitle}>{item.category_hint}</Text>
                <StatusPill status={item.status} />
              </View>
              <Text style={st.cardAddr} numberOfLines={2}>
                {[item.address?.locality, item.address?.city].filter(Boolean).join(', ') || '—'}
              </Text>
              {item.scheduled_slot_start ? (
                <Text style={st.cardSlot}>
                  {formatSlot(item.scheduled_slot_start)} – {formatSlot(item.scheduled_slot_end)}
                </Text>
              ) : (
                <Text style={st.cardSlot}>Requested: {formatSlot(item.requested_slot_start)}</Text>
              )}
              {item.item_notes ? (
                <Text style={st.cardNotes} numberOfLines={2}>{item.item_notes}</Text>
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
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
