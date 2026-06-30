/**
 * KycFlowScreen — Sprint 3: 5-step KYC with address confirmation
 *
 * Flow: Aadhaar OTP → Address confirm (auto-filled) → PAN → Selfie → Payout
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, R, S, T, Shadow } from '../../utils/tokens';
import { Button, ScreenHeader } from '../../components/ui';
import { KYC } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { parseApiError } from '../../utils/errors';

const STEPS = ['Aadhaar', 'Address', 'PAN', 'Selfie', 'Payout'];

export default function KycFlowScreen({ navigation }: any) {
  const { setKycStatus, setTier } = useAuthStore();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const [requestId, setRequestId] = useState('');
  const [otp, setOtp] = useState('');

  const [addrHouse, setAddrHouse] = useState('');
  const [addrStreet, setAddrStreet] = useState('');
  const [addrLocality, setAddrLocality] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrPincode, setAddrPincode] = useState('');
  const [addrState, setAddrState] = useState('');

  const [pan, setPan] = useState('');
  const [upi, setUpi] = useState('');

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
      setStep(2);
      AsyncStorage.setItem('@ow_kyc_step', '2').catch(() => {});
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e, 'Could not save address'));
    } finally { setLoading(false); }
  };

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

  const doLiveness = async () => {
    setLoading(true);
    try {
      const session = await KYC.livenessSession();
      const sessionId = session.data.session_id || session.data.id || 'mock-session';
      await KYC.livenessVerify(sessionId);
      setStep(4);
      AsyncStorage.setItem('@ow_kyc_step', '4').catch(() => {});
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e, 'Liveness check failed'));
    } finally { setLoading(false); }
  };

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

  const addrValid =
    addrCity.trim().length >= 2 &&
    addrPincode.trim().length >= 5 &&
    addrState.trim().length >= 2;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScreenHeader title="Verify identity" onBack={() => navigation.goBack()} tone="canvas" />

      <View style={s.progress}>
        {STEPS.map((l, i) => (
          <View key={i} style={s.progressItem}>
            <View style={[s.bar, i <= step && s.barOn]} />
            <Text style={[s.barL, i <= step && s.barLOn]}>{l}</Text>
          </View>
        ))}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.flex}
      >
        <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
          <View style={[s.card, Shadow.card]}>

            {step === 0 && (
              <>
                <Text style={s.cardEmoji}>🪪</Text>
                <Text style={s.cardT}>Aadhaar Verification</Text>
                <Text style={s.cardS}>
                  Verify via OTP sent to your Aadhaar-linked mobile.{'\n'}
                  Your Aadhaar number is never stored.
                </Text>
                {!requestId ? (
                  <Button
                    label="Send Aadhaar OTP"
                    variant="primary"
                    size="lg"
                    onPress={initAadhaar}
                    loading={loading}
                    fullWidth
                  />
                ) : (
                  <>
                    <TextInput
                      style={s.input}
                      placeholder="6-digit OTP"
                      placeholderTextColor={C.text4}
                      keyboardType="number-pad"
                      maxLength={6}
                      value={otp}
                      onChangeText={setOtp}
                      autoFocus
                    />
                    <Button
                      label="Verify"
                      variant="primary"
                      size="lg"
                      disabled={otp.length < 6 || loading}
                      loading={loading}
                      onPress={verAadhaar}
                      fullWidth
                    />
                  </>
                )}
              </>
            )}

            {step === 1 && (
              <>
                <Text style={s.cardEmoji}>📍</Text>
                <Text style={s.cardT}>Confirm your address</Text>
                <Text style={s.cardS}>Auto-filled from your Aadhaar. Edit if needed.</Text>
                <View style={s.addrForm}>
                  <Text style={s.addrLabel}>House / Flat / Building</Text>
                  <TextInput
                    style={s.addrInput}
                    placeholder="e.g. Flat 402, Tower B"
                    placeholderTextColor={C.text4}
                    value={addrHouse}
                    onChangeText={setAddrHouse}
                  />

                  <Text style={s.addrLabel}>Street / Area</Text>
                  <TextInput
                    style={s.addrInput}
                    placeholder="e.g. 100 Feet Road"
                    placeholderTextColor={C.text4}
                    value={addrStreet}
                    onChangeText={setAddrStreet}
                  />

                  <Text style={s.addrLabel}>Locality / Landmark</Text>
                  <TextInput
                    style={s.addrInput}
                    placeholder="e.g. Near Forum Mall"
                    placeholderTextColor={C.text4}
                    value={addrLocality}
                    onChangeText={setAddrLocality}
                  />

                  <View style={s.addrRow}>
                    <View style={s.flex}>
                      <Text style={s.addrLabel}>City *</Text>
                      <TextInput
                        style={s.addrInput}
                        placeholder="Bengaluru"
                        placeholderTextColor={C.text4}
                        value={addrCity}
                        onChangeText={setAddrCity}
                      />
                    </View>
                    <View style={s.flex}>
                      <Text style={s.addrLabel}>Pincode *</Text>
                      <TextInput
                        style={s.addrInput}
                        placeholder="560034"
                        placeholderTextColor={C.text4}
                        keyboardType="number-pad"
                        maxLength={6}
                        value={addrPincode}
                        onChangeText={setAddrPincode}
                      />
                    </View>
                  </View>

                  <Text style={s.addrLabel}>State *</Text>
                  <TextInput
                    style={s.addrInput}
                    placeholder="Karnataka"
                    placeholderTextColor={C.text4}
                    value={addrState}
                    onChangeText={setAddrState}
                  />
                </View>
                <Button
                  label="Confirm address"
                  variant="primary"
                  size="lg"
                  disabled={!addrValid || loading}
                  loading={loading}
                  onPress={confirmAddress}
                  fullWidth
                />
              </>
            )}

            {step === 2 && (
              <>
                <Text style={s.cardEmoji}>🪪</Text>
                <Text style={s.cardT}>PAN Verification</Text>
                <Text style={s.cardS}>
                  Required for tax compliance (TDS 194-O).{'\n'}
                  PAN must be linked to your Aadhaar.
                </Text>
                <TextInput
                  style={s.input}
                  placeholder="ABCDE1234F"
                  placeholderTextColor={C.text4}
                  maxLength={10}
                  autoCapitalize="characters"
                  value={pan}
                  onChangeText={setPan}
                  autoFocus
                />
                <Button
                  label="Verify PAN"
                  variant="primary"
                  size="lg"
                  disabled={pan.length < 10 || loading}
                  loading={loading}
                  onPress={verPan}
                  fullWidth
                />
              </>
            )}

            {step === 3 && (
              <>
                <Text style={s.cardEmoji}>🤳</Text>
                <Text style={s.cardT}>Quick Selfie Check</Text>
                <Text style={s.cardS}>
                  A quick selfie to confirm it's really you.{'\n'}
                  Take it in a well-lit area.
                </Text>
                <Button
                  label="Take selfie"
                  variant="primary"
                  size="lg"
                  loading={loading}
                  onPress={doLiveness}
                  fullWidth
                />
              </>
            )}

            {step === 4 && (
              <>
                <Text style={s.cardEmoji}>💳</Text>
                <Text style={s.cardT}>Payout Account</Text>
                <Text style={s.cardS}>
                  Add your UPI ID to receive payouts when you sell.{'\n'}
                  This is the last step!
                </Text>
                <TextInput
                  style={s.input}
                  placeholder="yourname@upi"
                  placeholderTextColor={C.text4}
                  value={upi}
                  onChangeText={setUpi}
                  autoCapitalize="none"
                  autoFocus
                />
                <Button
                  label="Verify & complete"
                  variant="primary"
                  size="lg"
                  disabled={!upi.includes('@') || loading}
                  loading={loading}
                  onPress={verPayout}
                  fullWidth
                />
              </>
            )}
          </View>

          <Text style={s.footer}>
            Your data is encrypted per DPDP Act 2023.{'\n'}
            We never store your Aadhaar number.
          </Text>
          <View style={s.bottomSpacer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  flex: { flex: 1 },

  top: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingVertical: S.sm + 2,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  topT: { fontSize: T.size.lg - 1, fontWeight: T.weight.semi, color: C.text },
  topSpacer: { width: 48 },

  progress: {
    flexDirection: 'row', justifyContent: 'center',
    gap: S.sm, paddingVertical: S.md, paddingHorizontal: S.lg,
  },
  progressItem: { alignItems: 'center', gap: 3, flex: 1 },
  bar: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.border },
  barOn: { backgroundColor: C.petrol },
  barL: { fontSize: T.size.xs - 1, color: C.text4 },
  barLOn: { color: C.petrol },

  body: { flex: 1, padding: S.lg },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.xl,
    padding: S.xxl,
    alignItems: 'center',
  },
  cardEmoji: { fontSize: T.size.display + 18, marginBottom: S.lg },     // 48
  cardT: { fontSize: T.size.xl, fontWeight: T.weight.bold, color: C.text, marginBottom: S.xs },
  cardS: {
    fontSize: T.size.base, color: C.text3,
    textAlign: 'center', marginBottom: S.xxl, lineHeight: 20,
  },
  input: {
    width: '100%',
    borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: S.md, paddingVertical: S.md,
    fontSize: T.size.lg - 1,
    color: C.text, textAlign: 'center',
    marginBottom: S.lg,
    backgroundColor: C.bone,
  },

  footer: {
    textAlign: 'center', fontSize: T.size.sm, color: C.text4,
    marginTop: S.xl, lineHeight: 18,
  },
  bottomSpacer: { height: 40 },

  addrForm: { width: '100%', marginBottom: S.lg },
  addrLabel: {
    fontSize: T.size.sm, fontWeight: T.weight.semi, color: C.text3,
    marginTop: S.md, marginBottom: S.xs,
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  addrInput: {
    borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: S.md, paddingVertical: S.sm + 2,
    fontSize: T.size.sm + 1, color: C.text,
    backgroundColor: C.bone,
  },
  addrRow: { flexDirection: 'row', gap: S.sm },
});
