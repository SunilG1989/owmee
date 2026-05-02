import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, ScrollView, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton, Button } from '../../components/ui';
import { C, T, S, R } from '../../utils/tokens';
import { Auth } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { INDIAN_CITIES } from '../../hooks/useLocation';

export default function EditProfileScreen({ navigation }: any) {
  const { phone, kycStatus } = useAuthStore();
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCities, setShowCities] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await Auth.me();
        const u = res.data;
        setName(u.name || '');
        setCity(u.city || '');
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    if (!name.trim()) { Alert.alert('Name required', 'Please enter your name'); return; }
    setSaving(true);
    try {
      await Auth.updateProfile({ name: name.trim(), city: city || undefined });
      Alert.alert('Saved', 'Profile updated', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Could not save');
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color={C.petrol} style={s.loading} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Edit Profile</Text>
        <Button
          label={saving ? 'Saving...' : 'Save'}
          variant="ghost"
          size="sm"
          disabled={saving}
          onPress={save}
        />
      </View>

      <ScrollView style={s.body}>
        <View style={s.avatarWrap}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{name ? name[0].toUpperCase() : '?'}</Text>
          </View>
        </View>

        <Text style={s.label}>Name</Text>
        <TextInput
          style={s.input}
          placeholder="Your name"
          placeholderTextColor={C.text4}
          value={name}
          onChangeText={setName}
          autoFocus
        />

        <Text style={s.label}>Phone</Text>
        <View style={[s.input, s.readonly]}>
          <Text style={s.readonlyText}>{phone || 'Not set'}</Text>
        </View>

        <Text style={s.label}>City</Text>
        <TouchableOpacity style={s.input} onPress={() => setShowCities(true)}>
          <Text style={[s.cityValue, !city && s.cityPlaceholder]}>
            {city || 'Select your city'}
          </Text>
        </TouchableOpacity>

        <Text style={s.label}>Verification</Text>
        <View style={[s.input, s.readonly]}>
          <View style={s.kycRow}>
            <View style={[s.kycDot, kycStatus === 'verified' && s.kycDotOn]} />
            <Text style={s.readonlyText}>
              {kycStatus === 'verified'
                ? 'KYC Verified ✓'
                : kycStatus === 'in_progress'
                  ? 'KYC In Progress'
                  : 'Not Verified'}
            </Text>
          </View>
          {kycStatus !== 'verified' && (
            <Text style={s.kycLink} onPress={() => navigation.navigate('KycFlow')}>
              Complete →
            </Text>
          )}
        </View>
      </ScrollView>

      <Modal visible={showCities} animationType="slide" transparent>
        <View style={s.modalOv}>
          <View style={s.modalC}>
            <Text style={s.modalTitle}>Select city</Text>
            <ScrollView>
              {INDIAN_CITIES.map(c => (
                <TouchableOpacity
                  key={c.name}
                  style={s.cityRow}
                  onPress={() => { setCity(c.name); setShowCities(false); }}
                >
                  <Text style={s.cityRowText}>{c.name}</Text>
                  {city === c.name && <Text style={s.cityRowCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => setShowCities(false)}
              style={s.modalClose}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  loading: { marginTop: S.xxxl + S.xxxl },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingVertical: S.sm + 2,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: T.size.lg - 1, fontWeight: T.weight.semi, color: C.text },

  body: { flex: 1, padding: S.lg },
  avatarWrap: { alignItems: 'center', marginBottom: S.xxl },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.petrolLight,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: T.size.display, fontWeight: T.weight.bold, color: C.petrolDeep },

  label: {
    fontSize: T.size.sm, fontWeight: T.weight.semi, color: C.text3,
    marginTop: S.lg, marginBottom: S.xs + 2,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: C.surface, borderRadius: R.sm,
    paddingHorizontal: S.md + 2, paddingVertical: S.md + 2,
    fontSize: T.size.md, color: C.text,
    borderWidth: 0.5, borderColor: C.border,
  },
  readonly: {
    backgroundColor: C.bone2,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  readonlyText: { fontSize: T.size.md, color: C.text3 },

  cityValue: { fontSize: T.size.md, color: C.text },
  cityPlaceholder: { color: C.text4 },

  kycRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  kycDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.text4 },
  kycDotOn: { backgroundColor: C.petrol },
  kycLink: { fontSize: T.size.base, color: C.petrol, fontWeight: T.weight.semi },

  modalOv: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalC: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    padding: S.xl,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text, marginBottom: S.lg },
  modalClose: { marginTop: S.lg, alignSelf: 'center' },

  cityRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: S.md + 2,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  cityRowText: { fontSize: T.size.md, color: C.text },
  cityRowCheck: { fontSize: T.size.lg - 1, color: C.petrol },
});
