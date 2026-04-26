/**
 * FE Visit Detail — Sprint 4 / Pass 2
 *
 * Shows seller + address + category + notes. Primary action is "Start visit";
 * once started, user proceeds to FeCapture. Also offers "Call seller" and
 * "Open in Maps" (device-native links).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FE, type FEVisit } from '../../services/api';
import { C, S, R, T, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

function formatSlot(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function FeVisitDetailScreen({ route, navigation }: RootScreen<'FeVisitDetail'>) {
  const { visitId } = route.params;
  const [visit, setVisit] = useState<FEVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await FE.getVisit(visitId);
      setVisit(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail?.message || 'Could not load visit.');
    } finally {
      setLoading(false);
    }
  }, [visitId]);

  useEffect(() => { load(); }, [load]);

  const onStart = async () => {
    if (!visit) return;
    setStarting(true);
    try {
      await FE.startVisit(visit.id);
      navigation.replace('FeCapture', { visitId: visit.id });
    } catch (e: any) {
      Alert.alert('Could not start visit', e?.response?.data?.detail?.message || 'Please try again.');
    } finally {
      setStarting(false);
    }
  };

  const onMaps = () => {
    if (!visit) return;
    const a = visit.address || {};
    if (a.lat && a.lng) {
      Linking.openURL(`geo:${a.lat},${a.lng}?q=${a.lat},${a.lng}`).catch(() => {
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${a.lat},${a.lng}`);
      });
      return;
    }
    const q = encodeURIComponent(
      [a.house, a.street, a.locality, a.city, a.pincode].filter(Boolean).join(', '),
    );
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
  };

  if (loading) {
    return (
      <SafeAreaView style={st.root} edges={['top']}>
        <View style={st.center}><ActivityIndicator color={C.honey} /></View>
      </SafeAreaView>
    );
  }

  if (error || !visit) {
    return (
      <SafeAreaView style={st.root} edges={['top']}>
        <View style={st.center}>
          <Text style={st.err}>{error || 'Visit not found.'}</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={st.retryBtn}>
            <Text style={st.retryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const addr = visit.address || {};
  const canStart = visit.status === 'scheduled';
  const inProgress = visit.status === 'in_progress';

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={st.back}>‹</Text>
        </TouchableOpacity>
        <Text style={st.h1}>Visit details</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 120 }}>
        <View style={st.card}>
          <Text style={st.label}>Category</Text>
          <Text style={st.value}>{visit.category_hint}</Text>
        </View>

        <View style={st.card}>
          <Text style={st.label}>Scheduled slot</Text>
          <Text style={st.value}>
            {formatSlot(visit.scheduled_slot_start)} – {formatSlot(visit.scheduled_slot_end)}
          </Text>
          <Text style={[st.subLabel, { marginTop: S.sm }]}>Seller requested</Text>
          <Text style={st.subValue}>
            {formatSlot(visit.requested_slot_start)} – {formatSlot(visit.requested_slot_end)}
          </Text>
        </View>

        <View style={st.card}>
          <Text style={st.label}>Address</Text>
          <Text style={st.value}>
            {[addr.house, addr.street].filter(Boolean).join(', ') || '—'}
          </Text>
          <Text style={st.value}>
            {[addr.locality, addr.city, addr.pincode].filter(Boolean).join(', ') || '—'}
          </Text>
          {addr.landmark ? (
            <Text style={[st.subLabel, { marginTop: S.sm }]}>Landmark</Text>
          ) : null}
          {addr.landmark ? <Text style={st.subValue}>{addr.landmark}</Text> : null}

          <TouchableOpacity style={st.secondaryBtn} onPress={onMaps}>
            <Text style={st.secondaryBtnText}>Open in Maps</Text>
          </TouchableOpacity>
        </View>

        {visit.item_notes ? (
          <View style={st.card}>
            <Text style={st.label}>Seller notes</Text>
            <Text style={st.value}>{visit.item_notes}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={st.footer}>
        {inProgress ? (
          <TouchableOpacity
            style={st.primaryBtn}
            onPress={() => navigation.navigate('FeCapture', { visitId: visit.id })}
          >
            <Text style={st.primaryBtnText}>Continue capture</Text>
          </TouchableOpacity>
        ) : canStart ? (
          <TouchableOpacity
            style={[st.primaryBtn, starting && { opacity: 0.6 }]}
            onPress={onStart}
            disabled={starting}
          >
            <Text style={st.primaryBtnText}>{starting ? 'Starting…' : 'Start visit'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={st.infoBox}>
            <Text style={st.infoText}>
              This visit is {visit.status.replace('_', ' ')}. No actions available.
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg },
  back: { fontSize: 28, color: C.text, paddingHorizontal: S.xs },
  h1: { fontSize: T.h3, fontWeight: '600', color: C.text },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, marginBottom: S.md, ...Shadow.glow },
  label: { fontSize: T.small, color: C.text3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: T.body, color: C.text, marginTop: S.xs, lineHeight: 22 },
  subLabel: { fontSize: T.small, color: C.text3 },
  subValue: { fontSize: T.body, color: C.text2 },
  secondaryBtn: {
    marginTop: S.md, alignSelf: 'flex-start',
    paddingHorizontal: S.lg, paddingVertical: S.sm,
    backgroundColor: C.honeyLight, borderRadius: R.md,
  },
  secondaryBtnText: { color: C.honeyText, fontWeight: '600' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.cream, borderTopWidth: 1, borderTopColor: C.border },
  primaryBtn: {
    backgroundColor: C.honey, paddingVertical: S.md, borderRadius: R.md,
    alignItems: 'center', ...Shadow.glow,
  },
  primaryBtnText: { color: '#fff', fontSize: T.body, fontWeight: '700' },
  infoBox: { backgroundColor: C.sand, padding: S.md, borderRadius: R.md },
  infoText: { color: C.text2, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl },
  err: { fontSize: T.body, color: C.text2, textAlign: 'center' },
  retryBtn: { marginTop: S.md, paddingHorizontal: S.lg, paddingVertical: S.sm, backgroundColor: C.honey, borderRadius: R.md },
  retryBtnText: { color: '#fff', fontWeight: '600' },
});
