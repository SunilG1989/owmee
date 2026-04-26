/**
 * FE Visit History — Sprint 4 / Pass 2
 *
 * All past visits with their outcomes. Simple list view.
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
import { C, S, R, T, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

const TERMINAL_STATUSES: FEVisit['status'][] = ['completed', 'cancelled', 'no_show'];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function outcomeLabel(outcome: string | null): string {
  if (!outcome) return '—';
  return outcome.replace(/_/g, ' ');
}

export default function FeVisitHistoryScreen({ navigation }: RootScreen<'FeVisitHistory'>) {
  const [visits, setVisits] = useState<FEVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await FE.assignedVisits();
      const past = (res.data || []).filter((v: FEVisit) => TERMINAL_STATUSES.includes(v.status));
      setVisits(past);
    } catch {
      setVisits([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={st.back}>‹</Text>
        </TouchableOpacity>
        <Text style={st.h1}>Visit history</Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={C.honey} /></View>
      ) : visits.length === 0 ? (
        <View style={st.center}><Text style={st.empty}>No past visits yet.</Text></View>
      ) : (
        <FlatList
          data={visits}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ padding: S.lg }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.honey} />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={st.card}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('FeVisitDetail', { visitId: item.id })}
            >
              <View style={st.row}>
                <Text style={st.category}>{item.category_hint}</Text>
                <Text style={st.date}>{formatDate(item.completed_at || item.created_at)}</Text>
              </View>
              <Text style={st.addr} numberOfLines={1}>
                {[item.address?.locality, item.address?.city].filter(Boolean).join(', ') || '—'}
              </Text>
              <Text style={st.outcome}>Outcome: <Text style={{ color: C.text }}>{outcomeLabel(item.outcome)}</Text></Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg },
  back: { fontSize: 28, color: C.text, paddingHorizontal: S.xs },
  h1: { fontSize: T.h3, fontWeight: '600', color: C.text },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, marginBottom: S.md, ...Shadow.glow },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  category: { fontSize: T.h3, fontWeight: '600', color: C.text },
  date: { fontSize: T.small, color: C.text3 },
  addr: { fontSize: T.body, color: C.text2, marginTop: 4 },
  outcome: { fontSize: T.small, color: C.text3, marginTop: S.xs, textTransform: 'capitalize' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl },
  empty: { fontSize: T.body, color: C.text3 },
});
