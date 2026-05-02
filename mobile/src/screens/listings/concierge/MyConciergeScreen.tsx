/**
 * MyConciergeScreen — Phase 1 placeholder; Phase 4 implements the real
 * timeline view (master spec section 7).
 *
 * For Phase 1 we just need the route to exist so BookingConfirmedScreen's
 * "Track visit" CTA has a target. The placeholder copy reflects the
 * "matching specialist" state since that's the only thing currently
 * happening.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { BackButton, Button } from '../../../components/ui';
import { FEVisits, type FEVisit } from '../../../services/api';
import { C, R, S, Shadow } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

export default function MyConciergeScreen({
  navigation,
}: RootScreen<'MyConcierge'>) {
  const [visits, setVisits] = useState<FEVisit[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await FEVisits.mine();
      setVisits(r.data);
    } catch {
      setVisits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>My Concierge</Text>
        </View>
        <View style={s.center}>
          <ActivityIndicator color={C.honey} />
        </View>
      </SafeAreaView>
    );
  }

  if (visits.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>My Concierge</Text>
        </View>
        <View style={s.center}>
          <Text style={s.emoji}>📦</Text>
          <Text style={s.emptyTitle}>No visits yet</Text>
          <Text style={s.emptyBody}>
            Book a free Owmee Specialist visit to get started.
          </Text>
          <View style={{ height: S.xl }} />
          <Button
            label="Book a visit"
            onPress={() => navigation.navigate('SellModeFork')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>My Concierge</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg }}>
        {visits.map((v) => (
          <TouchableOpacity
            key={v.id}
            style={s.visitCard}
            onPress={() => navigation.navigate('VisitDetail', { visit_id: v.id })}
            activeOpacity={0.85}
          >
            <View style={s.visitHead}>
              <Text style={s.visitDate}>{summary(v)}</Text>
              <StatusPill status={v.status} />
            </View>
            <Text style={s.visitAddress} numberOfLines={1}>
              {addressLine(v.address)}
            </Text>
            {v.notes_tags?.length ? (
              <Text style={s.visitTags}>{v.notes_tags.join(' · ')}</Text>
            ) : null}
          </TouchableOpacity>
        ))}

        <Text style={s.footnote}>
          The full timeline view (live items, sales, payouts) lands in the next update.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function summary(visit: FEVisit): string {
  const iso = visit.scheduled_slot_start || visit.requested_slot_start;
  if (!iso) return 'Visit';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function addressLine(snap: any): string {
  if (!snap) return '—';
  return [snap.flat_house_number || snap.house, snap.locality || snap.city]
    .filter(Boolean)
    .join(', ');
}

function StatusPill({ status }: { status: FEVisit['status'] }) {
  const map: Record<FEVisit['status'], { bg: string; fg: string; label: string }> = {
    requested: { bg: C.honeyLight, fg: C.honeyText, label: 'Matching' },
    scheduled: { bg: C.honeyLight, fg: C.honeyText, label: 'Scheduled' },
    in_progress: { bg: C.forestLight, fg: C.forest, label: 'In progress' },
    completed: { bg: C.forestLight, fg: C.forest, label: 'Completed' },
    postponed: { bg: C.sand, fg: C.text2, label: 'Postponed' },
    cancelled: { bg: C.redLight, fg: C.red, label: 'Cancelled' },
    no_show: { bg: C.redLight, fg: C.red, label: 'No show' },
  };
  const m = map[status] ?? { bg: C.sand, fg: C.text2, label: status };
  return (
    <View style={[s.pill, { backgroundColor: m.bg }]}>
      <Text style={[s.pillText, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
  },
  emoji: { fontSize: 56, marginBottom: S.md },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    color: C.text2,
    textAlign: 'center',
    marginTop: S.sm,
    lineHeight: 20,
  },
  visitCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  visitHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  visitDate: {
    fontSize: 16,
    fontWeight: '700',
    color: C.text,
  },
  visitAddress: {
    fontSize: 13,
    color: C.text2,
  },
  visitTags: {
    fontSize: 12,
    color: C.text3,
    marginTop: 4,
    fontWeight: '500',
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: R.pill,
  },
  pillText: { fontSize: 11, fontWeight: '700' },
  footnote: {
    fontSize: 12,
    color: C.text3,
    textAlign: 'center',
    marginTop: S.md,
    fontStyle: 'italic',
  },
});
