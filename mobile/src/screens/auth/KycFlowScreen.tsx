/**
 * KycFlowScreen — Sprint 3: 5-step KYC with address confirmation
 *
 * Flow: Aadhaar OTP → Address confirm (auto-filled) → PAN → Selfie → Payout
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, R, S, T, Shadow } from '../../utils/tokens';
import { KYC } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { parseApiError } from '../../utils/errors';

const STEPS = ['Aadhaar', 'Address', 'PAN', 'Selfie', 'Payout'];

export default function KycFlowScreen({ navigation }: any) {
  const { setKycStatus, setTier } = useAuthStore();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  // Aadhaar
  const [requestId, setRequestId] = useState('');
  const [otp, setOtp] = useState('');

  // Address (auto-filled from Aadhaar response or manual)
  const [addrHouse, setAddrHouse] = useState('');
  const [addrStreet, setAddrStreet] = useState('');
  const [addrLocality, setAddrLocality] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrPincode, setAddrPincode] = useState('');
  const [addrState, setAddrState] = useState('');

  // PAN + Payout
  const [pan, setPan] = useState('');
  const [upi, setUpi] = useState('');

  // ── Step 0: Aadhaar ──────────────────────────────────────────────

  const initAadhaar = async () => {
    setLoading(true);
    try {
      await KYC.consent('aadhaar_kyc');
      const r = await KYC.initiateAadhaar();
      setRequestId(r.data.request_id || 'ref');
      Alert.alert('OTP Sent', 'Check your Aadhaar-linked mobile');
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e, 'Could not initiate Aadhaar verification'));
    } finally { setLoading(false); }
  };

  const verAadhaar = async () => {
    setLoading(true);
    try {
      const r = await KYC.verifyAadhaar(otp, requestId);
      // Auto-fill address from Aadhaar response if partner provides it
      const addr = r.data?.address;
      if (addr) {
        setAddrHouse(addr.house || '');
        setAddrStreet(addr.street || '');
        setAddrLocality(addr.locality || addr.vtc || '');
        setAddrCity(addr.district || addr.city || '');
        setAddrPincode(addr.pincode || '');
        setAddrState(addr.state || '');
      }
      setStep(1);
      AsyncStorage.setItem('@ow_kyc_step', '1').catch(() => {});
    } catch (e: any) {
      const msg = parseApiError(e, 'Invalid Aadhaar OTP');
      if (msg.toLowerCase().includes('minor') || msg.includes('18')) {
        Alert.alert('Age requirement', 'You must be 18 or older to use Owmee.');
      } else {
        Alert.alert('Error', msg);
      }
    } finally { setLoading(false); }
  };

  // ── Step 1: Address confirm ──────────────────────────────────────

  const confirmAddress = async () => {
    if (!addrCity.trim() || !addrPincode.trim() || !addrState.trim()) {
      Alert.alert('Missing fields', 'City, pincode, and state are required.');
      return;
    }
    setLoading(true);
    try {
      await KYC.confirmAddress({
        address_house: addrHouse.trim() || undefined,
        address_street: addrStreet.trim() || undefined,
        address_locality: addrLocality.trim() || undefined,
        address_city: addrCity.trim(),
        address_pincode: addrPincode.trim(),
        address_state: addrState.trim(),
        source: addrCity ? 'aadhaar' : 'manual',
      });
      await AsyncStorage.setItem('@ow_address', JSON.stringify({
        city: addrCity.trim(), pincode: addrPincode.trim(), state: addrState.trim(),
      }));
      setStep(2);
      AsyncStorage.setItem('@ow_kyc_step', '2').catch(() => {});
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e, 'Could not save address'));
    } finally { setLoading(false); }
  };

  // ── Step 2: PAN ──────────────────────────────────────────────────

  const verPan = async () => {
    setLoading(true);
    try {
      await KYC.verifyPan(pan.toUpperCase());
      setStep(3);
      AsyncStorage.setItem('@ow_kyc_step', '3').catch(() => {});
    } catch (e: any) {
      const msg = parseApiError(e, 'PAN verification failed');
      if (msg.toLowerCase().includes('mismatch') || msg.includes('NAME')) {
        Alert.alert('Name mismatch', "PAN name doesn't match Aadhaar. Please check or contact support.");
      } else {
        Alert.alert('Error', msg);
      }
    } finally { setLoading(false); }
  };

  // ── Step 3: Liveness ─────────────────────────────────────────────

  const doLiveness = async () => {
    setLoading(true);
    try {
      const session = await KYC.livenessSession();
      const sessionId = session.data.session_id || session.data.id || 'mock-session';
      // In production: open camera SDK with sessionId
      await KYC.livenessVerify(sessionId);
      setStep(4);
      AsyncStorage.setItem('@ow_kyc_step', '4').catch(() => {});
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e, 'Liveness check failed'));
    } finally { setLoading(false); }
  };

  // ── Step 4: Payout ───────────────────────────────────────────────

  const verPayout = async () => {
    setLoading(true);
    try {
      await KYC.verifyPayout('upi', upi);
      setKycStatus('verified');
      setTier('verified');
      AsyncStorage.removeItem('@ow_kyc_step').catch(() => {});
      Alert.alert('Verified! 🎉', 'You can now buy and sell on Owmee.', [
        { text: 'Continue', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e, 'Payout verification failed'));
    } finally { setLoading(false); }
  };

  const addrValid = addrCity.trim().length >= 2 && addrPincode.trim().length >= 5 && addrState.trim().length >= 2;

  // ── UI ───────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.top}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontSize: 20, color: C.text2 }}>←</Text>
        </TouchableOpacity>
        <Text style={s.topT}>Verify identity</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Progress bar */}
      <View style={s.progress}>
        {STEPS.map((l, i) => (
          <View key={i} style={{ alignItems: 'center', gap: 3, flex: 1 }}>
            <View style={[s.bar, i <= step && { backgroundColor: C.honey }]} />
            <Text style={[s.barL, i <= step && { color: C.honey }]}>{l}</Text>
          </View>
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
          <View style={[s.card, Shadow.card]}>

            {/* ═══ Step 0: Aadhaar ═══ */}
            {step === 0 && (
              <>
                <Text style={{ fontSize: 48, marginBottom: 16 }}>🪪</Text>
                <Text style={s.cardT}>Aadhaar Verification</Text>
                <Text style={s.cardS}>
                  Verify via OTP sent to your Aadhaar-linked mobile.{'\n'}
                  Your Aadhaar number is never stored.
                </Text>
                {!requestId ? (
                  <TouchableOpacity style={s.btn} onPress={initAadhaar} disabled={loading}>
                    {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Send Aadhaar OTP</Text>}
                  </TouchableOpacity>
                ) : (
                  <>
                    <TextInput style={s.input} placeholder="6-digit OTP" placeholderTextColor={C.text4}
                      keyboardType="number-pad" maxLength={6} value={otp} onChangeText={setOtp} autoFocus />
                    <TouchableOpacity style={[s.btn, otp.length < 6 && { opacity: 0.4 }]}
                      onPress={verAadhaar} disabled={otp.length < 6 || loading}>
                      {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Verify</Text>}
                    </TouchableOpacity>
                  </>
                )}
              </>
            )}

            {/* ═══ Step 1: Address Confirm ═══ */}
            {step === 1 && (
              <>
                <Text style={{ fontSize: 48, marginBottom: 16 }}>📍</Text>
                <Text style={s.cardT}>Confirm your address</Text>
                <Text style={s.cardS}>
                  Auto-filled from your Aadhaar. Edit if needed.
                </Text>
                <View style={s.addrForm}>
                  <Text style={s.addrLabel}>House / Flat / Building</Text>
                  <TextInput style={s.addrInput} placeholder="e.g. Flat 402, Tower B"
                    placeholderTextColor={C.text4} value={addrHouse} onChangeText={setAddrHouse} />

                  <Text style={s.addrLabel}>Street / Area</Text>
                  <TextInput style={s.addrInput} placeholder="e.g. 100 Feet Road"
                    placeholderTextColor={C.text4} value={addrStreet} onChangeText={setAddrStreet} />

                  <Text style={s.addrLabel}>Locality / Landmark</Text>
                  <TextInput style={s.addrInput} placeholder="e.g. Near Forum Mall"
                    placeholderTextColor={C.text4} value={addrLocality} onChangeText={setAddrLocality} />

                  <View style={s.addrRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.addrLabel}>City *</Text>
                      <TextInput style={s.addrInput} placeholder="Bengaluru"
                        placeholderTextColor={C.text4} value={addrCity} onChangeText={setAddrCity} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.addrLabel}>Pincode *</Text>
                      <TextInput style={s.addrInput} placeholder="560034"
                        placeholderTextColor={C.text4} keyboardType="number-pad" maxLength={6}
                        value={addrPincode} onChangeText={setAddrPincode} />
                    </View>
                  </View>

                  <Text style={s.addrLabel}>State *</Text>
                  <TextInput style={s.addrInput} placeholder="Karnataka"
                    placeholderTextColor={C.text4} value={addrState} onChangeText={setAddrState} />
                </View>
                <TouchableOpacity style={[s.btn, !addrValid && { opacity: 0.4 }]}
                  onPress={confirmAddress} disabled={!addrValid || loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Confirm address</Text>}
                </TouchableOpacity>
              </>
            )}

            {/* ═══ Step 2: PAN ═══ */}
            {step === 2 && (
              <>
                <Text style={{ fontSize: 48, marginBottom: 16 }}>🪪</Text>
                <Text style={s.cardT}>PAN Verification</Text>
                <Text style={s.cardS}>
                  Required for tax compliance (TDS 194-O).{'\n'}
                  PAN must be linked to your Aadhaar.
                </Text>
                <TextInput style={s.input} placeholder="ABCDE1234F" placeholderTextColor={C.text4}
                  maxLength={10} autoCapitalize="characters" value={pan} onChangeText={setPan} autoFocus />
                <TouchableOpacity style={[s.btn, pan.length < 10 && { opacity: 0.4 }]}
                  onPress={verPan} disabled={pan.length < 10 || loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Verify PAN</Text>}
                </TouchableOpacity>
              </>
            )}

            {/* ═══ Step 3: Selfie ═══ */}
            {step === 3 && (
              <>
                <Text style={{ fontSize: 48, marginBottom: 16 }}>🤳</Text>
                <Text style={s.cardT}>Quick Selfie Check</Text>
                <Text style={s.cardS}>
                  A quick selfie to confirm it's really you.{'\n'}
                  Take it in a well-lit area.
                </Text>
                <TouchableOpacity style={s.btn} onPress={doLiveness} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Take selfie</Text>}
                </TouchableOpacity>
              </>
            )}

            {/* ═══ Step 4: Payout ═══ */}
            {step === 4 && (
              <>
                <Text style={{ fontSize: 48, marginBottom: 16 }}>💳</Text>
                <Text style={s.cardT}>Payout Account</Text>
                <Text style={s.cardS}>
                  Add your UPI ID to receive payouts when you sell.{'\n'}
                  This is the last step!
                </Text>
                <TextInput style={s.input} placeholder="yourname@upi" placeholderTextColor={C.text4}
                  value={upi} onChangeText={setUpi} autoCapitalize="none" autoFocus />
                <TouchableOpacity style={[s.btn, !upi.includes('@') && { opacity: 0.4 }]}
                  onPress={verPayout} disabled={!upi.includes('@') || loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnT}>Verify & complete</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>

          <Text style={s.footer}>
            Your data is encrypted per DPDP Act 2023.{'\n'}We never store your Aadhaar number.
          </Text>
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  top: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  topT: { fontSize: 16, fontWeight: '600', color: C.text },
  progress: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16 },
  bar: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.border },
  barL: { fontSize: 9, color: C.text4 },
  body: { flex: 1, padding: 16 },
  card: { backgroundColor: C.surface, borderRadius: 20, padding: 24, alignItems: 'center' },
  cardT: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 4 },
  cardS: { fontSize: 13, color: C.text3, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  input: {
    width: '100%', borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: C.text,
    textAlign: 'center', marginBottom: 16, backgroundColor: C.cream,
  },
  btn: { width: '100%', backgroundColor: C.honey, borderRadius: R.sm, paddingVertical: 14, alignItems: 'center' },
  btnT: { fontSize: 14, color: '#fff', fontWeight: '600' },
  footer: { textAlign: 'center', fontSize: 11, color: C.text4, marginTop: 20, lineHeight: 18 },
  // Address form
  addrForm: { width: '100%', marginBottom: 16 },
  addrLabel: { fontSize: 11, fontWeight: '600', color: C.text3, marginTop: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  addrInput: {
    borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.text,
    backgroundColor: C.cream,
  },
  addrRow: { flexDirection: 'row', gap: S.sm },
});
