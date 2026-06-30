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
import { ScreenHeader } from '../../components/ui';
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
      <ScreenHeader title="Visit history" onBack={() => navigation.goBack()} tone="canvas" />

      {loading ? (
        <View style={st.center}><ActivityIndicator color={C.petrol} /></View>
      ) : visits.length === 0 ? (
        <View style={st.center}><Text style={st.empty}>No past visits yet.</Text></View>
      ) : (
        <FlatList
          data={visits}
          keyExtractor={(v) => v.id}
          contentContainerStyle={st.listPadding}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.petrol} />
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
              <Text style={st.outcome}>Outcome: <Text style={st.outcomeStrong}>{outcomeLabel(item.outcome)}</Text></Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bone },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg },
  headerSpacer: { width: 48 },
  h1: { fontSize: T.h3, fontWeight: T.weight.semi, color: C.text },
  listPadding: { padding: S.lg },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, marginBottom: S.md, ...Shadow.glow },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  category: { fontSize: T.h3, fontWeight: T.weight.semi, color: C.text },
  date: { fontSize: T.small, color: C.text3 },
  addr: { fontSize: T.body, color: C.text2, marginTop: 4 },
  outcome: { fontSize: T.small, color: C.text3, marginTop: S.xs, textTransform: 'capitalize' },
  outcomeStrong: { color: C.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl },
  empty: { fontSize: T.body, color: C.text3 },
});
