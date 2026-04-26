import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={{ fontSize: 20, color: C.text2 }}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={save} disabled={saving}>
          <Text style={[s.saveText, saving && { opacity: 0.4 }]}>{saving ? 'Saving...' : 'Save'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.body}>
        {/* Avatar placeholder */}
        <View style={s.avatarWrap}>
          <View style={s.avatar}><Text style={s.avatarText}>{name ? name[0].toUpperCase() : '?'}</Text></View>
        </View>

        <Text style={s.label}>Name</Text>
        <TextInput style={s.input} placeholder="Your name" placeholderTextColor={C.text4}
          value={name} onChangeText={setName} autoFocus />

        <Text style={s.label}>Phone</Text>
        <View style={[s.input, s.readonly]}><Text style={{ fontSize: 15, color: C.text3 }}>{phone || 'Not set'}</Text></View>

        <Text style={s.label}>City</Text>
        <TouchableOpacity style={s.input} onPress={() => setShowCities(true)}>
          <Text style={{ fontSize: 15, color: city ? C.text : C.text4 }}>{city || 'Select your city'}</Text>
        </TouchableOpacity>

        <Text style={s.label}>Verification</Text>
        <View style={[s.input, s.readonly]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={[s.kycDot, kycStatus === 'verified' && { backgroundColor: C.forest }]} />
            <Text style={{ fontSize: 15, color: C.text }}>
              {kycStatus === 'verified' ? 'KYC Verified ✓' : kycStatus === 'in_progress' ? 'KYC In Progress' : 'Not Verified'}
            </Text>
          </View>
          {kycStatus !== 'verified' && (
            <TouchableOpacity onPress={() => navigation.navigate('KycFlow')}>
              <Text style={{ fontSize: 13, color: C.honey, fontWeight: '600' }}>Complete →</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* City picker */}
      <Modal visible={showCities} animationType="slide" transparent>
        <View style={s.modalOv}><View style={s.modalC}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: C.text, marginBottom: 16 }}>Select city</Text>
          <ScrollView>
            {INDIAN_CITIES.map(c => (
              <TouchableOpacity key={c.name} style={s.cityRow} onPress={() => { setCity(c.name); setShowCities(false); }}>
                <Text style={{ fontSize: 15, color: C.text }}>{c.name}</Text>
                {city === c.name && <Text style={{ fontSize: 16, color: C.honey }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={s.modalClose} onPress={() => setShowCities(false)}>
            <Text style={{ fontSize: 15, color: C.text3 }}>Cancel</Text>
          </TouchableOpacity>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  saveText: { fontSize: 15, color: C.honey, fontWeight: '600' },
  body: { flex: 1, padding: 16 },
  avatarWrap: { alignItems: 'center', marginBottom: 24 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.honeyLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30, fontWeight: '700', color: C.honeyDeep },
  label: { fontSize: 12, fontWeight: '600', color: C.text3, marginTop: 16, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: C.surface, borderRadius: R.sm, paddingHorizontal: 14, paddingVertical: 14, fontSize: 15, color: C.text, borderWidth: 0.5, borderColor: C.border },
  readonly: { backgroundColor: C.sand, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kycDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.honey },
  modalOv: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalC: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: S.xl, maxHeight: '70%' },
  cityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: C.border },
  modalClose: { marginTop: 16, alignItems: 'center', paddingVertical: 14 },
});
