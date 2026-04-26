import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, R } from '../../utils/tokens';
import type { AuthScreen } from '../../navigation/types';
import { Auth, Community } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { parseApiError } from '../../utils/errors';

/** Extract user_id (sub claim) from JWT */
function extractUserId(token: string): string {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(atob(payload));
    return decoded.sub || '';
  } catch { return ''; }
}

export default function OtpVerifyScreen({ navigation, route }: AuthScreen<'OtpVerify'>) {
  const { phone } = route.params;
  const { setTokens, setPhone: storePhone } = useAuthStore();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(30);
  // FIX: prevent double-fire from useEffect + manual press
  const verifyingRef = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setCountdown(c => c > 0 ? c - 1 : 0), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (code.length === 6 && !loading && !verifyingRef.current) verify();
  }, [code]);

  const verify = async () => {
    if (code.length !== 6 || verifyingRef.current) return;
    verifyingRef.current = true;
    setLoading(true);
    try {
      const r = await Auth.verifyOtp(phone, code);
      // FIX: backend returns {access_token, refresh_token, tier, kyc_status} — NO user_id
      // Extract user_id from JWT sub claim
      const { access_token, refresh_token, tier, kyc_status, auth_state, buyer_eligible, seller_tier, role } = r.data;
      const userId = extractUserId(access_token);
      // FIX: pass tier + kycStatus to setTokens
      setTokens(access_token, refresh_token, userId, tier, kyc_status, auth_state, buyer_eligible, seller_tier, role);
      storePhone(phone);
      // Save profile data collected during registration
      const profile = route.params?.profile;
      if (profile) {
        try {
          await Auth.updateProfile({
            name: profile.name,
            email: profile.email,
            ...(profile.address || {}),
          });
          // Save address locally for checkout
          if (profile.address) {
            const AsyncStorage = require('@react-native-async-storage/async-storage').default;
            await AsyncStorage.setItem('@ow_address', JSON.stringify(profile.address));
          }
        } catch {} // Non-blocking — profile save failure shouldn't block login
      }
      // Sprint 7 / Phase 1: community gate disabled — global marketplace mode.
      // (Foundation is in place behind the scenes; flip OtpVerifyScreen + browse default
      // to re-enable community-scoped flow when desired.)
      navigation.getParent()?.goBack();
    } catch (e: any) {
      // FIX: handle error object in detail field (was showing [object Object])
      Alert.alert('Invalid OTP', parseApiError(e, 'Check and try again'));
    } finally {
      setLoading(false);
      verifyingRef.current = false;
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 16 }}>
        <Text style={{ fontSize: 20, color: C.text2 }}>←</Text>
      </TouchableOpacity>
      <View style={s.body}>
        <Text style={s.title}>Enter OTP</Text>
        <Text style={s.sub}>Sent to {phone}</Text>
        <TextInput style={s.input} placeholder="000000" placeholderTextColor={C.text4}
          keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} autoFocus />
        <TouchableOpacity style={[s.btn, code.length !== 6 && { opacity: 0.4 }]}
          disabled={code.length !== 6 || loading} onPress={verify}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Verify</Text>}
        </TouchableOpacity>
        <TouchableOpacity disabled={countdown > 0}
          onPress={async () => { try { await Auth.requestOtp(phone); setCountdown(30); } catch {} }}
          style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 13, color: countdown > 0 ? C.text4 : C.honey, textAlign: 'center' }}>
            {countdown > 0 ? `Resend in ${countdown}s` : 'Resend OTP'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 40 },
  title: { fontSize: 22, fontWeight: '700', color: C.text, marginBottom: 4 },
  sub: { fontSize: 13, color: C.text3, marginBottom: 32 },
  input: { backgroundColor: C.surface, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 14,
    fontSize: 24, letterSpacing: 8, color: C.text, textAlign: 'center',
    borderWidth: 0.5, borderColor: C.border, marginBottom: 24 },
  btn: { backgroundColor: C.honey, borderRadius: R.sm, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontSize: 14, color: '#fff', fontWeight: '600' },
});
