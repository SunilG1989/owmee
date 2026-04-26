/**
 * OtpVerifyScreen
 * 6-digit OTP entry with auto-submit and resend.
 * India UX: countdown timer, clear error states, resend after 30s.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Radius } from '../../utils/tokens';
import { Auth, setAuthToken } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import type { AuthStackParams } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<AuthStackParams>;
type Route = RouteProp<AuthStackParams, 'OtpVerify'>;

export default function OtpVerifyScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { phone } = route.params;
  const { setTokens } = useAuthStore();

  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(30);
  const [resending, setResending] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Countdown timer
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  // Focus input on mount
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  const handleVerify = useCallback(async (code: string) => {
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await Auth.verifyOtp(phone, code);
      const { access_token, refresh_token, tier, kyc_status } = res.data;
      // Fetch user_id from /me so TransactionListScreen can distinguish buyer/seller
      let user_id: string | undefined;
      try {
        setAuthToken(access_token);
        const meRes = await Auth.me();
        user_id = meRes.data.user_id;
      } catch {}
      setTokens(access_token, refresh_token, tier, kyc_status, user_id);
      // Navigation handled by RootNavigator auth state change
    } catch (e: any) {
      setError(e.message ?? 'Invalid OTP. Please try again.');
      setOtp('');
    } finally {
      setLoading(false);
    }
  }, [phone, setTokens]);

  const handleChange = useCallback((val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 6);
    setOtp(digits);
    setError(null);
    if (digits.length === 6) handleVerify(digits);
  }, [handleVerify]);

  const handleResend = useCallback(async () => {
    if (resendCountdown > 0) return;
    setResending(true);
    try {
      await Auth.sendOtp(phone);
      setResendCountdown(30);
      setOtp('');
      setError(null);
    } catch (e: any) {
      setError('Could not resend OTP. Try again.');
    } finally {
      setResending(false);
    }
  }, [phone, resendCountdown]);

  const maskedPhone = phone.replace(/(\+91)(\d{2})(\d{5})(\d{3})/, '$1 $2XXXXX$4');

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={s.back} onPress={() => navigation.goBack()}>
          <Text style={s.backText}>←</Text>
        </TouchableOpacity>

        <View style={s.content}>
          <Text style={s.title}>Enter OTP</Text>
          <Text style={s.sub}>Sent to {maskedPhone}</Text>

          {/* OTP dots display */}
          <TouchableOpacity activeOpacity={1} onPress={() => inputRef.current?.focus()}>
            <View style={s.dotsRow}>
              {[0,1,2,3,4,5].map(i => (
                <View
                  key={i}
                  style={[
                    s.dot,
                    otp[i] ? s.dotFilled : null,
                    i === otp.length && s.dotActive,
                    error && s.dotError,
                  ]}
                >
                  <Text style={s.dotText}>{otp[i] ?? ''}</Text>
                </View>
              ))}
            </View>
          </TouchableOpacity>

          {/* Hidden text input */}
          <TextInput
            ref={inputRef}
            value={otp}
            onChangeText={handleChange}
            keyboardType="number-pad"
            maxLength={6}
            style={s.hiddenInput}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
          />

          {error && <Text style={s.error}>{error}</Text>}

          {loading && (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color={Colors.teal} />
              <Text style={s.loadingText}>Verifying...</Text>
            </View>
          )}

          {/* Resend */}
          <View style={s.resendRow}>
            {resendCountdown > 0 ? (
              <Text style={s.resendTimer}>Resend OTP in {resendCountdown}s</Text>
            ) : (
              <TouchableOpacity onPress={handleResend} disabled={resending}>
                <Text style={s.resendBtn}>{resending ? 'Sending...' : 'Resend OTP'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surface },
  flex: { flex: 1 },
  back: { padding: Spacing.lg, paddingBottom: 0 },
  backText: { fontSize: 22, color: Colors.text3 },
  content: { flex: 1, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxxl },
  title: { fontSize: 26, fontWeight: '500', color: Colors.text, letterSpacing: -0.5, marginBottom: 8 },
  sub: { fontSize: 14, color: Colors.text3, marginBottom: Spacing.xxxl },
  dotsRow: { flexDirection: 'row', gap: 10, marginBottom: Spacing.xl },
  dot: {
    width: 46, height: 56, borderRadius: Radius.md,
    backgroundColor: Colors.border2,
    border: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dotFilled: { backgroundColor: Colors.tealLight, borderColor: Colors.teal },
  dotActive: { borderColor: Colors.teal, borderWidth: 1.5 },
  dotError: { borderColor: Colors.error, backgroundColor: Colors.errorLight },
  dotText: { fontSize: 22, fontWeight: '600', color: Colors.text },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  error: { fontSize: 13, color: Colors.error, marginTop: -4, marginBottom: Spacing.md },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md },
  loadingText: { fontSize: 13, color: Colors.text3 },
  resendRow: { marginTop: Spacing.xl },
  resendTimer: { fontSize: 13, color: Colors.text4 },
  resendBtn: { fontSize: 14, color: Colors.teal, fontWeight: '500' },
});
