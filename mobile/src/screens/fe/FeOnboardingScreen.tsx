/**
 * FE onboarding gate.
 *
 * Candidate FEs can enter this screen before activation to bind their device
 * and see the admin-controlled checks still pending. Work queues remain behind
 * the backend live readiness guard; this screen is status + device binding only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip } from '../../components/ui';
import { FEOnboarding, type FEProfile } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { C, R, S, T } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

const DEVICE_KEY = '@ow_fe_device_id';

const GAP_LABELS: Record<string, string> = {
  verification_not_approved: 'Admin verification pending',
  training_not_certified: 'Training certification pending',
  device_not_approved: 'Device approval pending',
  capacity_missing: 'Daily capacity missing',
  service_zones_missing: 'Service zone missing',
  category_certification_missing: 'Category certification missing',
  suspended: 'Suspended by ops',
  rejected: 'Verification rejected',
  deactivated: 'Profile deactivated',
};

function statusLabel(value?: string | null): string {
  return String(value || 'pending').replace(/_/g, ' ');
}

function statusTone(value?: string | null): 'good' | 'warn' | 'bad' | 'neutral' {
  const v = String(value || '');
  if (['active', 'approved', 'certified', 'device_ready', 'available'].includes(v)) return 'good';
  if (['candidate', 'verification_pending', 'training_pending', 'pending', 'not_started', 'pending_admin_approval', 'off'].includes(v)) return 'warn';
  if (['suspended', 'rejected', 'deactivated', 'failed', 'expired', 'blocked'].includes(v)) return 'bad';
  return 'neutral';
}

function toneStyle(tone: 'good' | 'warn' | 'bad' | 'neutral') {
  if (tone === 'good') return { bg: C.petrolLight, fg: C.petrolText };
  if (tone === 'warn') return { bg: '#FFF4D8', fg: '#7A4C00' };
  if (tone === 'bad') return { bg: C.redLight, fg: C.red };
  return { bg: C.bone2, fg: C.text2 };
}

async function stableDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const id = `ow-fe-${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_KEY, id);
  return id;
}

export default function FeOnboardingScreen({ navigation }: RootScreen<'FeOnboarding'>) {
  const [profile, setProfile] = useState<FEProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logout = useAuthStore((s) => s.logout);

  const ready = Boolean(profile?.active && (profile.readiness_gaps || []).length === 0);
  const blocked = ['suspended', 'rejected', 'deactivated'].includes(String(profile?.onboarding_status));

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await FEOnboarding.me();
      setProfile(res.data);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(detail?.message || detail?.error || 'Could not load FE onboarding status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (ready) {
      navigation.reset({ index: 0, routes: [{ name: 'FeHome' }] });
    }
  }, [navigation, ready]);

  const gaps = useMemo(() => profile?.readiness_gaps || [], [profile]);

  const bindDevice = async () => {
    setBinding(true);
    setError(null);
    try {
      const deviceId = await stableDeviceId();
      const res = await FEOnboarding.bindDevice({
        device_id: deviceId,
        platform: Platform.OS,
        os_version: String(Platform.Version || ''),
        device_model: Platform.select({ ios: 'iPhone', android: 'Android device', default: 'Mobile device' }),
      });
      setProfile(res.data);
      Alert.alert('Device submitted', 'Admin can now approve this device for FE work.');
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(detail?.message || detail?.error || 'Could not submit device.');
    } finally {
      setBinding(false);
    }
  };

  if (loading || ready) {
    return (
      <SafeAreaView style={st.root}>
        <View style={st.center}>
          <ActivityIndicator color={C.petrol} />
          <Text style={st.centerText}>Checking FE access...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <ScrollView contentContainerStyle={st.scroll}>
        <View style={st.header}>
          <View style={{ flex: 1 }}>
            <Text style={st.kicker}>Owmee Field Executive</Text>
            <Text style={st.h1}>{profile?.fe_code || 'FE onboarding'}</Text>
            <Text style={st.subtitle}>
              Complete these checks before receiving visits or direct pickup work.
            </Text>
          </View>
          {profile ? <StatusPill value={profile.onboarding_status} /> : null}
        </View>

        {error ? (
          <View style={st.errorBox}>
            <Text style={st.errorText}>{error}</Text>
          </View>
        ) : null}

        {profile ? (
          <>
            <View style={st.summary}>
              <Info label="City" value={profile.city} />
              <Info label="Shift" value={statusLabel(profile.current_shift)} />
              <Info label="Capacity" value={`${profile.daily_capacity || 0}/day`} />
            </View>

            <View style={st.card}>
              <Text style={st.sectionTitle}>Required checks</Text>
              <CheckRow label="Admin verification" value={profile.verification_status} />
              <CheckRow label="Training certification" value={profile.training_status} />
              <CheckRow label="Device approval" value={profile.device_status} />
              <CheckRow label="Service zones" value={profile.service_zones?.length ? 'approved' : 'pending'} detail={(profile.service_zones || []).join(', ') || 'Not set'} />
              <CheckRow label="Category access" value={profile.category_certifications?.length ? 'approved' : 'pending'} detail={(profile.category_certifications || []).join(', ') || 'Not set'} />
            </View>

            <View style={st.card}>
              <Text style={st.sectionTitle}>Pending</Text>
              {gaps.length === 0 ? (
                <Text style={st.body}>All P0 checks are done. Waiting for final activation.</Text>
              ) : (
                <View style={st.gapWrap}>
                  {gaps.map((gap) => (
                    <Chip key={gap} label={GAP_LABELS[gap] || gap.replace(/_/g, ' ')} variant="soft" size="sm" />
                  ))}
                </View>
              )}
              {profile.suspended_reason ? <Text style={st.dangerNote}>{profile.suspended_reason}</Text> : null}
            </View>

            <View style={st.card}>
              <Text style={st.sectionTitle}>This device</Text>
              <Text style={st.body}>
                {profile.device_binding?.device_id
                  ? 'Device submitted. Admin approval is required before field work starts.'
                  : 'Bind this phone so work cannot be performed from an unknown device.'}
              </Text>
              <Button
                label={profile.device_binding?.device_id ? 'Resubmit device' : 'Bind this device'}
                variant="primary"
                fullWidth
                loading={binding}
                disabled={blocked}
                onPress={bindDevice}
                style={st.buttonTop}
              />
            </View>

            <Button label="Refresh status" variant="secondary" fullWidth onPress={load} style={st.buttonTop} />
            <Button label="Sign out" variant="ghost" fullWidth onPress={logout} style={st.signOut} />
          </>
        ) : (
          <View style={st.card}>
            <Text style={st.sectionTitle}>No FE invite found</Text>
            <Text style={st.body}>Ask an Owmee admin to create an FE invite for this phone number.</Text>
            <Button label="Sign out" variant="ghost" fullWidth onPress={logout} style={st.buttonTop} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone = toneStyle(statusTone(value));
  return (
    <View style={[st.statusPill, { backgroundColor: tone.bg }]}>
      <Text style={[st.statusText, { color: tone.fg }]}>{statusLabel(value)}</Text>
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.info}>
      <Text style={st.infoLabel}>{label}</Text>
      <Text style={st.infoValue}>{value || '—'}</Text>
    </View>
  );
}

function CheckRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  const tone = toneStyle(statusTone(value));
  return (
    <View style={st.checkRow}>
      <View style={{ flex: 1 }}>
        <Text style={st.checkLabel}>{label}</Text>
        {detail ? <Text style={st.checkDetail} numberOfLines={2}>{detail}</Text> : null}
      </View>
      <View style={[st.statusPill, { backgroundColor: tone.bg }]}>
        <Text style={[st.statusText, { color: tone.fg }]}>{statusLabel(value)}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bone },
  scroll: { padding: S.lg, paddingBottom: S.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: S.md },
  centerText: { color: C.text3, fontSize: T.body },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md, marginBottom: S.lg },
  kicker: { fontSize: T.size.sm, color: C.petrolText, fontWeight: T.weight.semi, marginBottom: 4 },
  h1: { fontSize: T.h2, color: C.text, fontWeight: T.weight.bold },
  subtitle: { marginTop: 4, color: C.text3, fontSize: T.body, lineHeight: 20 },
  statusPill: { borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: S.xs, alignSelf: 'flex-start' },
  statusText: { fontSize: T.size.xs, fontWeight: T.weight.semi, textTransform: 'capitalize' },
  summary: { flexDirection: 'row', gap: S.sm, marginBottom: S.md },
  info: { flex: 1, backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1, borderColor: C.border, padding: S.md },
  infoLabel: { fontSize: T.size.xs, color: C.text3, marginBottom: 4 },
  infoValue: { fontSize: T.size.sm, color: C.text, fontWeight: T.weight.semi, textTransform: 'capitalize' },
  card: { backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 1, borderColor: C.border, padding: S.lg, marginTop: S.md },
  sectionTitle: { fontSize: T.size.md, color: C.text, fontWeight: T.weight.bold, marginBottom: S.md },
  body: { color: C.text2, fontSize: T.body, lineHeight: 21 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.sm, borderTopWidth: 1, borderTopColor: C.border },
  checkLabel: { color: C.text, fontSize: T.body, fontWeight: T.weight.semi },
  checkDetail: { color: C.text3, fontSize: T.size.sm, marginTop: 2 },
  gapWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  dangerNote: { color: C.red, fontSize: T.body, marginTop: S.md },
  errorBox: { backgroundColor: C.redLight, borderRadius: R.md, padding: S.md, marginBottom: S.md },
  errorText: { color: C.red, fontSize: T.body, fontWeight: T.weight.semi },
  buttonTop: { marginTop: S.md },
  signOut: { marginTop: S.sm },
});
