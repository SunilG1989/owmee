import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R } from '../../utils/tokens';
import { Button, IconButton } from '../../components/ui';
import type { AuthScreen } from '../../navigation/types';
import { Auth } from '../../services/api';
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
    const t = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (code.length === 6 && !loading && !verifyingRef.current) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const verify = async () => {
    if (code.length !== 6 || verifyingRef.current) return;
    verifyingRef.current = true;
    setLoading(true);
    try {
      const r = await Auth.verifyOtp(phone, code);
      const {
        access_token, refresh_token, tier, kyc_status,
        auth_state, buyer_eligible, seller_tier, role,
      } = r.data;
      const userId = extractUserId(access_token);
      setTokens(
        access_token, refresh_token, userId,
        tier, kyc_status, auth_state, buyer_eligible, seller_tier, role,
      );
      storePhone(phone);
      const profile = route.params?.profile;
      if (profile) {
        try {
          await Auth.updateProfile({
            name: profile.name,
            email: profile.email,
            ...(profile.address || {}),
          });
          if (profile.address) {
            const AsyncStorage = require('@react-native-async-storage/async-storage').default;
            await AsyncStorage.setItem('@ow_address', JSON.stringify(profile.address));
          }
        } catch {}
      }
      navigation.getParent()?.goBack();
    } catch (e: any) {
      Alert.alert('Invalid OTP', parseApiError(e, 'Check and try again'));
    } finally {
      setLoading(false);
      verifyingRef.current = false;
    }
  };

  const resend = async () => {
    try { await Auth.requestOtp(phone); setCountdown(30); } catch {}
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.backWrap}>
        <IconButton icon="←" onPress={() => navigation.goBack()} a11y="Back" size="sm" />
      </View>
      <View style={s.body}>
        <Text style={s.title}>Enter OTP</Text>
        <Text style={s.sub}>Sent to {phone}</Text>
        <TextInput
          style={s.input}
          placeholder="000000"
          placeholderTextColor={C.text4}
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={setCode}
          autoFocus
        />
        <Button
          label="Verify"
          variant="primary"
          size="lg"
          disabled={code.length !== 6 || loading}
          loading={loading}
          onPress={verify}
          fullWidth
        />
        <Text
          style={[s.resend, countdown > 0 ? s.resendDisabled : s.resendActive]}
          onPress={countdown === 0 ? resend : undefined}
          accessibilityRole={countdown === 0 ? 'button' : undefined}
        >
          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend OTP'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  backWrap: { paddingHorizontal: S.lg, paddingVertical: S.sm },
  body: { flex: 1, paddingHorizontal: S.xxl, paddingTop: S.xxxl + S.sm },
  title: {
    fontSize: T.size.xxl - 2,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.xs,
  },
  sub: { fontSize: T.size.base, color: C.text3, marginBottom: S.xxxl },
  input: {
    backgroundColor: C.surface, borderRadius: R.sm,
    paddingHorizontal: S.md, paddingVertical: S.md + 2,
    fontSize: T.size.xxl,
    letterSpacing: 8,
    color: C.text, textAlign: 'center',
    borderWidth: 0.5, borderColor: C.border,
    marginBottom: S.xxl,
  },
  resend: { fontSize: T.size.base, textAlign: 'center', marginTop: S.lg },
  resendDisabled: { color: C.text4 },
  resendActive: { color: C.petrol, fontWeight: T.weight.semi },
});
