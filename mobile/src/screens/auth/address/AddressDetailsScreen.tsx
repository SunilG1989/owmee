/**
 * AddressDetailsScreen — Address PRD section 4.2 screen C.
 *
 * Structured form. User fills 1-3 fields (flat number is required, the
 * rest optional). Reverse-geocoded fields (line_1 / locality / city /
 * state / pincode) are pre-filled from LocationMap's reverse and are
 * editable — Photon often gets locality wrong in India.
 *
 * Save POST /v1/users/me/addresses → on success, navigate back to
 * whichever screen sent the user here. The first-address-becomes-default
 * shortcut is enforced server-side, so we don't have to detect "is this
 * my first address?" client-side.
 */
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Addresses,
  type CreateAddressRequest,
  type UserAddress,
} from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import { parseApiError } from '../../../utils/errors';
import { C, R, S, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

type Label = 'home' | 'work' | 'other';
const LABEL_OPTIONS: { key: Label; emoji: string; text: string }[] = [
  { key: 'home', emoji: '🏠', text: 'Home' },
  { key: 'work', emoji: '💼', text: 'Work' },
  { key: 'other', emoji: '📍', text: 'Other' },
];

export default function AddressDetailsScreen({
  navigation,
  route,
}: RootScreen<'AddressDetails'>) {
  const { lat, lng, source, reverse, returnTo } = route.params;

  // User-typed parts (only flat number is required)
  const [flatHouseNumber, setFlatHouseNumber] = useState('');
  const [buildingName, setBuildingName] = useState('');
  const [floor, setFloor] = useState('');
  const [landmark, setLandmark] = useState('');

  // Reverse-geocoded parts (pre-filled, editable)
  const [addressLine1, setAddressLine1] = useState(reverse?.address_line_1 ?? '');
  const [locality, setLocality] = useState(reverse?.locality ?? '');
  const [city, setCity] = useState(reverse?.city ?? '');
  const [state, setState] = useState(reverse?.state ?? '');
  const [pincode, setPincode] = useState(reverse?.pincode ?? '');

  // Label
  const [label, setLabel] = useState<Label>('home');
  const [customLabel, setCustomLabel] = useState('');
  const [setAsDefault, setSetAsDefault] = useState(true);

  const [saving, setSaving] = useState(false);

  const canSave =
    flatHouseNumber.trim().length > 0 &&
    city.trim().length > 0 &&
    state.trim().length > 0 &&
    !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);

    const body: CreateAddressRequest = {
      label,
      custom_label: label === 'other' ? customLabel.trim() || null : null,
      lat,
      lng,
      flat_house_number: flatHouseNumber.trim(),
      building_name: buildingName.trim() || null,
      floor: floor.trim() || null,
      landmark: landmark.trim() || null,
      address_line_1: addressLine1.trim() || null,
      locality: locality.trim() || null,
      city: city.trim(),
      state: state.trim(),
      pincode: pincode.trim() || null,
      is_default: setAsDefault,
      source: source === 'gps_detected' ? 'gps_detected' : 'manual',
    };

    try {
      const res = await Addresses.create(body);
      const created = res.data;
      onSaved(created);
    } catch (e) {
      Alert.alert('Could not save', parseApiError(e, 'Please try again.'));
      setSaving(false);
    }
  };

  const onSaved = (created: UserAddress) => {
    // If a returnTo was passed (e.g. caller wants control back), use the
    // navigation params hook instead. For Phase 1 we just navigate back to
    // the configured destination — RootNavigator will re-fetch the
    // address list on remount via useLocation's API call.
    if (returnTo === 'MainTabs') {
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' as never }] });
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' as never }] });
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Add your address</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={20}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field
            label="Flat / house number"
            value={flatHouseNumber}
            onChangeText={setFlatHouseNumber}
            placeholder="Flat 304"
            autoFocus
            required
          />
          <Field
            label="Building name (optional)"
            value={buildingName}
            onChangeText={setBuildingName}
            placeholder="Lotus Apartments"
          />
          <Field
            label="Floor (optional)"
            value={floor}
            onChangeText={setFloor}
            placeholder="3rd floor"
          />
          <Field
            label="Landmark (optional)"
            value={landmark}
            onChangeText={setLandmark}
            placeholder="Near Diary Circle"
          />

          <View style={s.divider} />

          <Field
            label="Address line 1"
            value={addressLine1}
            onChangeText={setAddressLine1}
            placeholder="12th Main Road"
          />
          <Field
            label="Locality"
            value={locality}
            onChangeText={setLocality}
            placeholder="JP Nagar Phase 7"
          />
          <Field
            label="City"
            value={city}
            onChangeText={setCity}
            placeholder="Bengaluru"
            required
          />
          <Field
            label="State"
            value={state}
            onChangeText={setState}
            placeholder="Karnataka"
            required
          />
          <Field
            label="Pincode"
            value={pincode}
            onChangeText={(v) => setPincode(v.replace(/[^\d]/g, '').slice(0, 6))}
            placeholder="560078"
            keyboardType="number-pad"
          />

          <Text style={s.sectionLabel}>Save as</Text>
          <View style={s.labelRow}>
            {LABEL_OPTIONS.map((opt) => {
              const active = label === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[s.labelBtn, active && s.labelBtnActive]}
                  onPress={() => setLabel(opt.key)}
                  activeOpacity={0.8}
                >
                  <Text style={s.labelEmoji}>{opt.emoji}</Text>
                  <Text style={[s.labelText, active && s.labelTextActive]}>
                    {opt.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {label === 'other' ? (
            <TextInput
              value={customLabel}
              onChangeText={setCustomLabel}
              placeholder="What should we call this place?"
              placeholderTextColor={C.text4}
              style={s.customLabelInput}
              maxLength={50}
            />
          ) : null}

          <View style={s.defaultRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.defaultText}>Set as default address</Text>
              <Text style={s.defaultHint}>
                Used by default at checkout and Concierge bookings.
              </Text>
            </View>
            <Switch
              value={setAsDefault}
              onValueChange={setSetAsDefault}
              trackColor={{ false: C.border, true: C.petrol }}
            />
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={s.bottomBar}>
        <Button
          label="Save address"
          onPress={handleSave}
          disabled={!canSave}
          loading={saving}
        />
      </View>
    </SafeAreaView>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  keyboardType?: 'default' | 'number-pad';
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  required,
  autoFocus,
  keyboardType = 'default',
}: FieldProps) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>
        {label}
        {required ? <Text style={s.fieldReq}> *</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.text4}
        style={s.input}
        autoFocus={autoFocus}
        keyboardType={keyboardType}
        autoCapitalize="words"
      />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
    backgroundColor: C.bone,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    flex: 1,
  },
  scrollBody: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.xxl,
  },
  divider: {
    height: 1,
    backgroundColor: C.border,
    marginVertical: S.lg,
  },
  field: { marginBottom: S.md },
  fieldLabel: {
    fontSize: 13,
    color: C.text2,
    marginBottom: 6,
    fontWeight: '500',
  },
  fieldReq: { color: C.petrolDeep },
  input: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
  },
  sectionLabel: {
    fontSize: 13,
    color: C.text2,
    marginTop: S.lg,
    marginBottom: S.sm,
    fontWeight: '500',
  },
  labelRow: { flexDirection: 'row', gap: S.sm },
  labelBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: R.md,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  labelBtnActive: {
    backgroundColor: C.petrolLight,
    borderColor: C.petrol,
  },
  labelEmoji: { fontSize: 22, marginBottom: 4 },
  labelText: { fontSize: 13, color: C.text2, fontWeight: '500' },
  labelTextActive: { color: C.petrolDeep, fontWeight: '600' },
  customLabelInput: {
    backgroundColor: C.surface,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: 12,
    fontSize: 15,
    color: C.text,
    borderWidth: 1,
    borderColor: C.petrol,
    marginTop: S.sm,
  },
  defaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: S.lg,
    paddingHorizontal: S.sm,
    gap: S.md,
  },
  defaultText: {
    fontSize: 15,
    color: C.text,
    fontWeight: '500',
  },
  defaultHint: {
    fontSize: 12,
    color: C.text3,
    marginTop: 2,
  },
  bottomBar: {
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    backgroundColor: C.bone,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
});
