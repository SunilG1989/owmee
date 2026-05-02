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
import { Button, IconButton } from '../../components/ui';
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

  // Concierge Phase 2 trust theater: N4 + N5 trigger buttons. These do
  // not change visit status; they fire seller-side notifications so the
  // seller sees progress before the door knock. Errors are non-fatal.
  const onStartRoute = async () => {
    if (!visit) return;
    try {
      await FE.startRoute(visit.id);
      Alert.alert('Notification sent', 'Seller has been told you\'re on the way.');
    } catch (e: any) {
      Alert.alert('Could not notify', e?.response?.data?.detail?.message || 'Try again.');
    }
  };
  const onArrivingSoon = async () => {
    if (!visit) return;
    try {
      await FE.arrivingSoon(visit.id);
      Alert.alert('Notification sent', 'Seller has been told you\'re 30 mins away.');
    } catch (e: any) {
      Alert.alert('Could not notify', e?.response?.data?.detail?.message || 'Try again.');
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
        <View style={st.center}><ActivityIndicator color={C.petrol} /></View>
      </SafeAreaView>
    );
  }

  if (error || !visit) {
    return (
      <SafeAreaView style={st.root} edges={['top']}>
        <View style={st.center}>
          <Text style={st.err}>{error || 'Visit not found.'}</Text>
          <Button label="Back" variant="primary" onPress={() => navigation.goBack()} style={st.retryBtn} />
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
        <IconButton icon="←" onPress={() => navigation.goBack()} a11y="Back" size="sm" />
        <Text style={st.h1}>Visit details</Text>
        {/* Concierge Phase 5 — Report issue corner */}
        <IconButton
          icon="⚠"
          onPress={() => navigation.navigate('ReportIssue', { visitId: visit.id })}
          a11y="Report issue"
          variant="danger"
          size="sm"
        />
      </View>

      <ScrollView contentContainerStyle={st.scrollPad}>
        <View style={st.card}>
          <Text style={st.label}>Category</Text>
          <Text style={st.value}>{visit.category_hint}</Text>
        </View>

        <View style={st.card}>
          <Text style={st.label}>Scheduled slot</Text>
          <Text style={st.value}>
            {formatSlot(visit.scheduled_slot_start)} – {formatSlot(visit.scheduled_slot_end)}
          </Text>
          <Text style={[st.subLabel, st.spacedSm]}>Seller requested</Text>
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
            <Text style={[st.subLabel, st.spacedSm]}>Landmark</Text>
          ) : null}
          {addr.landmark ? <Text style={st.subValue}>{addr.landmark}</Text> : null}

          <Button
            label="Open in Maps"
            variant="secondary"
            size="sm"
            onPress={onMaps}
            style={st.secondaryBtn}
          />
        </View>

        {/* Concierge Phase 3 — pre-visit briefing block.
            Reads notes_tags + item_notes from booking. The verification
            code subtitle is for the FE to read out at the door. */}
        {(visit.notes_tags && visit.notes_tags.length > 0) || visit.item_notes ? (
          <View style={st.card}>
            <Text style={st.label}>Seller notes</Text>
            {visit.notes_tags && visit.notes_tags.length > 0 ? (
              <Text style={[st.subValue, st.tagsSpaced]}>
                Tags: {visit.notes_tags.join(', ')}
              </Text>
            ) : null}
            {visit.item_notes ? (
              <Text style={st.value}>"{visit.item_notes}"</Text>
            ) : null}
          </View>
        ) : null}

        {visit.arrival_verification_code ? (
          <View style={st.card}>
            <Text style={st.label}>Verification code</Text>
            <Text style={[st.value, st.verificationCode]}>
              {visit.arrival_verification_code}
            </Text>
            <Text style={st.subValue}>
              Tell the seller this code when they ask — it proves you're really us.
            </Text>
          </View>
        ) : null}

        {/* Concierge Phase 2 — trust theater triggers (scheduled visits only) */}
        {canStart ? (
          <View style={st.card}>
            <Text style={st.label}>Notify seller</Text>
            <Button
              label="📍 I'm starting my route"
              variant="secondary"
              size="sm"
              onPress={onStartRoute}
              style={st.secondaryBtn}
            />
            <Button
              label="⏱ I'm 30 mins away"
              variant="secondary"
              size="sm"
              onPress={onArrivingSoon}
              style={[st.secondaryBtn, st.spacedSm]}
            />
          </View>
        ) : null}
      </ScrollView>

      <View style={st.footer}>
        {inProgress ? (
          <Button
            label="Continue capture"
            variant="primary"
            size="lg"
            onPress={() => navigation.navigate('FeCapture', { visitId: visit.id })}
            fullWidth
            style={st.primaryBtn}
          />
        ) : canStart ? (
          <Button
            label={starting ? 'Starting…' : 'Start visit'}
            variant="primary"
            size="lg"
            onPress={onStart}
            loading={starting}
            disabled={starting}
            fullWidth
            style={st.primaryBtn}
          />
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
  root: { flex: 1, backgroundColor: C.bone },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg },
  h1: { fontSize: T.h3, fontWeight: T.weight.semi, color: C.text },

  scrollPad: { padding: S.lg, paddingBottom: 120 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, marginBottom: S.md, ...Shadow.glow },
  label: { fontSize: T.small, color: C.text3, fontWeight: T.weight.semi, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: T.body, color: C.text, marginTop: S.xs, lineHeight: 22 },
  subLabel: { fontSize: T.small, color: C.text3 },
  subValue: { fontSize: T.body, color: C.text2 },

  spacedSm: { marginTop: S.sm },
  tagsSpaced: { marginBottom: S.sm },

  verificationCode: { fontSize: T.size.display - 2, letterSpacing: 6, fontWeight: T.weight.bold },

  secondaryBtn: { marginTop: S.md, alignSelf: 'flex-start' },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.bone, borderTopWidth: 1, borderTopColor: C.border },
  primaryBtn: { ...Shadow.glow },

  infoBox: { backgroundColor: C.bone2, padding: S.md, borderRadius: R.md },
  infoText: { color: C.text2, textAlign: 'center' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl },
  err: { fontSize: T.body, color: C.text2, textAlign: 'center' },
  retryBtn: { marginTop: S.md },
});
