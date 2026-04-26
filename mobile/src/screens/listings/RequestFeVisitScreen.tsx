/**
 * RequestFeVisit (A9) — Sprint 4 / Pass 2
 *
 * Seller-facing screen to request an FE visit. Collects:
 *   - Address (pre-filled from their profile address if set)
 *   - Preferred 2-hour slot
 *   - Category hint
 *   - Item notes
 *
 * Then POSTs to /v1/fe-visits/request and shows a confirmation toast.
 */
import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Auth, FEVisits } from '../../services/api';
import { C, S, R, T, Shadow } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

type SlotOption = { label: string; start: Date; end: Date };

function buildSlotOptions(): SlotOption[] {
  const opts: SlotOption[] = [];
  const now = new Date();
  // Offer next 3 days, 4 two-hour slots per day (10-12, 12-2, 2-4, 4-6)
  const hours = [10, 12, 14, 16];
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    for (const h of hours) {
      const start = new Date(now);
      start.setDate(start.getDate() + dayOffset);
      start.setHours(h, 0, 0, 0);
      if (start.getTime() <= now.getTime() + 60 * 60 * 1000) continue; // skip past/too-soon
      const end = new Date(start);
      end.setHours(h + 2);
      const label = start.toLocaleString('en-IN', {
        weekday: 'short', day: '2-digit', month: 'short',
        hour: '2-digit', minute: '2-digit',
      }) + ` – ${end.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
      opts.push({ label, start, end });
    }
  }
  return opts.slice(0, 8); // cap at 8 visible
}

const CATEGORY_HINTS = [
  { slug: 'smartphones', label: 'Phone' },
  { slug: 'laptops-tablets', label: 'Laptop / Tablet' },
  { slug: 'small-appliances', label: 'Appliance' },
  { slug: 'kids-utility', label: 'Kids / Utility' },
];

export default function RequestFeVisitScreen({ route, navigation }: RootScreen<'RequestFeVisit'>) {
  const initialCategory = route.params?.categoryHint || 'smartphones';

  const [address, setAddress] = useState({
    house: '', street: '', locality: '', city: '', pincode: '', state: '', landmark: '',
  });
  const [categoryHint, setCategoryHint] = useState(initialCategory);
  const [notes, setNotes] = useState('');
  const [slotIdx, setSlotIdx] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const slotOptions = useMemo(() => buildSlotOptions(), []);

  React.useEffect(() => {
    Auth.me()
      .then((res) => {
        const u = res.data || {};
        setAddress({
          house: u.address_house || '',
          street: u.address_street || '',
          locality: u.address_locality || '',
          city: u.address_city || '',
          pincode: u.address_pincode || '',
          state: u.address_state || '',
          landmark: '',
        });
      })
      .catch(() => {})
      .finally(() => setLoadingProfile(false));
  }, []);

  const canSubmit = useMemo(() => {
    if (!address.city.trim()) return false;
    if (!address.locality.trim() && !address.street.trim()) return false;
    if (slotIdx === null) return false;
    return true;
  }, [address, slotIdx]);

  const submit = async () => {
    if (!canSubmit || slotIdx === null) return;
    const slot = slotOptions[slotIdx];
    setSubmitting(true);
    try {
      const res = await FEVisits.request({
        requested_slot_start: slot.start.toISOString(),
        requested_slot_end: slot.end.toISOString(),
        category_hint: categoryHint,
        item_notes: notes || undefined,
        address: {
          house: address.house || undefined,
          street: address.street || undefined,
          locality: address.locality || undefined,
          city: address.city,
          pincode: address.pincode || undefined,
          state: address.state || undefined,
          landmark: address.landmark || undefined,
        },
      });
      const visitId = res.data?.id;
      Alert.alert(
        'Visit requested',
        'An Owmee Field Executive will be assigned shortly. You\'ll get a call and a notification with the scheduled slot.',
        [
          {
            text: 'Got it',
            onPress: () => {
              if (visitId) {
                navigation.replace('FeVisitConfirmation', { visitId });
              } else {
                navigation.goBack();
              }
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert('Could not request visit', e?.response?.data?.detail?.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={st.root} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={st.back}>‹</Text>
        </TouchableOpacity>
        <Text style={st.h1}>Request FE visit</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: S.lg, paddingBottom: 160 }}>
          <View style={st.infoCard}>
            <Text style={st.infoHead}>How it works</Text>
            <Text style={st.infoBody}>
              An Owmee Field Executive comes to your home, photographs your item,
              checks its condition, and creates the listing for you. You don\'t need
              to complete KYC first — the FE helps you with that on the visit.
            </Text>
          </View>

          <Text style={st.sectionTitle}>What are you selling?</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {CATEGORY_HINTS.map((c) => (
              <TouchableOpacity
                key={c.slug}
                onPress={() => setCategoryHint(c.slug)}
                style={[st.chip, categoryHint === c.slug && st.chipActive]}
              >
                <Text style={[st.chipText, categoryHint === c.slug && st.chipTextActive]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={st.sectionTitle}>Pickup address</Text>
          <LabeledInput label="House / Flat no." value={address.house}
            onChangeText={(v) => setAddress({ ...address, house: v })} placeholder="Flat 304" />
          <LabeledInput label="Street" value={address.street}
            onChangeText={(v) => setAddress({ ...address, street: v })} placeholder="12th Main" />
          <LabeledInput label="Locality" value={address.locality}
            onChangeText={(v) => setAddress({ ...address, locality: v })} placeholder="HSR Layout" />
          <LabeledInput label="City" value={address.city}
            onChangeText={(v) => setAddress({ ...address, city: v })} placeholder="Bengaluru" />
          <LabeledInput label="Pincode" value={address.pincode}
            onChangeText={(v) => setAddress({ ...address, pincode: v })} placeholder="560102" keyboardType="number-pad" />
          <LabeledInput label="Landmark (optional)" value={address.landmark}
            onChangeText={(v) => setAddress({ ...address, landmark: v })} placeholder="Near HSR BDA complex" />

          <Text style={st.sectionTitle}>Preferred slot</Text>
          {slotOptions.map((opt, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => setSlotIdx(i)}
              style={[st.slot, slotIdx === i && st.slotActive]}
            >
              <Text style={[st.slotText, slotIdx === i && st.slotTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}

          <Text style={st.sectionTitle}>Anything we should know?</Text>
          <TextInput
            style={[st.input, { minHeight: 80, textAlignVertical: 'top' }]}
            multiline
            placeholder="e.g. iPhone 13 Pro, has a screen crack…"
            placeholderTextColor={C.text3}
            value={notes}
            onChangeText={setNotes}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={st.footer}>
        <TouchableOpacity
          style={[st.primaryBtn, (!canSubmit || submitting || loadingProfile) && { opacity: 0.5 }]}
          onPress={submit}
          disabled={!canSubmit || submitting || loadingProfile}
        >
          <Text style={st.primaryBtnText}>
            {submitting ? 'Requesting…' : 'Request visit'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function LabeledInput(props: { label: string; value: string; onChangeText: (s: string) => void; placeholder?: string; keyboardType?: any }) {
  return (
    <View style={{ marginBottom: S.md }}>
      <Text style={st.inputLabel}>{props.label}</Text>
      <TextInput
        style={st.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={C.text3}
        keyboardType={props.keyboardType}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: S.lg },
  back: { fontSize: 28, color: C.text, paddingHorizontal: S.xs },
  h1: { fontSize: T.h3, fontWeight: '600', color: C.text },
  infoCard: { backgroundColor: C.honeyLight, padding: S.lg, borderRadius: R.lg, marginBottom: S.lg, borderWidth: 1, borderColor: C.honey },
  infoHead: { fontSize: T.h3, fontWeight: '700', color: C.honeyText, marginBottom: S.xs },
  infoBody: { fontSize: T.body, color: C.honeyText, lineHeight: 20 },
  sectionTitle: { fontSize: T.h3, fontWeight: '600', color: C.text, marginTop: S.lg, marginBottom: S.md },
  chip: { paddingHorizontal: S.md, paddingVertical: S.sm, borderRadius: R.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, marginRight: S.sm, marginBottom: S.sm },
  chipActive: { backgroundColor: C.honey, borderColor: C.honey },
  chipText: { color: C.text2, fontSize: T.body, fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  inputLabel: { fontSize: T.small, color: C.text3, fontWeight: '600', marginBottom: 4 },
  input: { backgroundColor: C.surface, borderRadius: R.md, padding: S.md, fontSize: T.body, color: C.text, borderWidth: 1, borderColor: C.border },
  slot: { padding: S.md, backgroundColor: C.surface, borderRadius: R.md, borderWidth: 1, borderColor: C.border, marginBottom: S.sm },
  slotActive: { borderColor: C.honey, backgroundColor: C.honeyLight },
  slotText: { color: C.text2, fontSize: T.body },
  slotTextActive: { color: C.honeyText, fontWeight: '600' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: S.lg, backgroundColor: C.cream, borderTopWidth: 1, borderTopColor: C.border },
  primaryBtn: { backgroundColor: C.honey, paddingVertical: S.md, borderRadius: R.md, alignItems: 'center', ...Shadow.glow },
  primaryBtnText: { color: '#fff', fontSize: T.body, fontWeight: '700' },
});
