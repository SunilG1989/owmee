/**
 * RegisterScreen — PHONE NUMBER ONLY
 *
 * Goal: fastest possible signup. No name, no email, no address.
 * User enters 10-digit mobile → OTP → account created → browse.
 *
 * Address is captured later:
 *   - Location auto-detected on first app open (LocationPickerScreen)
 *   - Buy/Sell triggers KYC with address confirm from Aadhaar
 *
 * Why phone-only:
 *   - Matches OLX, Cashify, Meesho signup friction (all phone-only)
 *   - India uses phone as primary ID (not email)
 *   - Trust is earned through KYC, not self-reported name
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R, Shadow } from '../../utils/tokens';
import { Auth } from '../../services/api';
import { parseApiError } from '../../utils/errors';

export default function RegisterScreen({ navigation }: any) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const phoneClean = phone.replace(/\D/g, '');
  const isValid = phoneClean.length === 10;

  const submit = async () => {
    if (!isValid) {
      Alert.alert('Invalid number', 'Please enter your 10-digit mobile number.');
      return;
    }
    setLoading(true);
    try {
      await Auth.requestOtp(`+91${phoneClean}`);
      // No profile params — just phone. Name can be added later in profile settings.
      navigation.navigate('OtpVerify', { phone: `+91${phoneClean}` });
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e, 'Could not send OTP'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Back */}
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backWrap}>
          <Text style={{ fontSize: 22, color: C.text2 }}>←</Text>
        </TouchableOpacity>

        <View style={s.body}>
          <Text style={s.title}>Enter your mobile number</Text>
          <Text style={s.sub}>
            We'll send you a 6-digit OTP to verify
          </Text>

          {/* Trust badges */}
          <View style={s.badges}>
            <View style={s.badge}>
              <Text style={{ fontSize: 14 }}>🛡️</Text>
              <Text style={s.badgeText}>Aadhaar-verified sellers</Text>
            </View>
            <View style={s.badge}>
              <Text style={{ fontSize: 14 }}>💳</Text>
              <Text style={s.badgeText}>UPI-protected payments</Text>
            </View>
          </View>

          {/* Phone input */}
          <View style={s.inputRow}>
            <View style={s.flag}>
              <Text style={{ fontSize: 16 }}>🇮🇳</Text>
              <Text style={s.flagText}>+91</Text>
            </View>
            <TextInput
              style={s.input}
              placeholder="98765 43210"
              placeholderTextColor={C.text4}
              keyboardType="phone-pad"
              maxLength={10}
              value={phone}
              onChangeText={setPhone}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => isValid && submit()}
            />
          </View>

          {/* CTA */}
          <TouchableOpacity
            style={[s.btn, !isValid && { opacity: 0.4 }]}
            onPress={submit}
            disabled={!isValid || loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.btnText}>Send OTP</Text>
            )}
          </TouchableOpacity>

          {/* Why KYC note */}
          <View style={s.infoCard}>
            <Text style={{ fontSize: 14 }}>ℹ️</Text>
            <Text style={s.infoText}>
              Just phone required. We'll ask for Aadhaar and PAN only when you
              buy or sell — never before.
            </Text>
          </View>

          {/* Terms */}
          <Text style={s.terms}>
            By continuing, you agree to our{' '}
            <Text style={s.link}>Terms of Service</Text>
            {' '}and{' '}
            <Text style={s.link}>Privacy Policy</Text>.{'\n'}
            Your data is protected under the DPDP Act 2023.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  backWrap: { padding: S.lg },
  body: { flex: 1, paddingHorizontal: S.xl, paddingTop: S.md },

  title: { fontSize: 24, fontWeight: '700', color: C.ink, marginBottom: S.xs, letterSpacing: -0.5 },
  sub: { fontSize: T.size.md, color: C.text3, marginBottom: S.xl, lineHeight: 21 },

  badges: { flexDirection: 'row', gap: S.sm, marginBottom: S.xxl },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.forestLight, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: R.pill,
  },
  badgeText: { fontSize: 11, fontWeight: '600', color: C.forest },

  inputRow: { flexDirection: 'row', gap: S.sm, marginBottom: S.lg },
  flag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surface, borderRadius: R.sm,
    paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: C.border,
  },
  flagText: { fontSize: 15, color: C.text, fontWeight: '600' },
  input: {
    flex: 1, backgroundColor: C.surface, borderRadius: R.sm,
    paddingHorizontal: 14, paddingVertical: 14,
    fontSize: 20, letterSpacing: 2, color: C.text,
    borderWidth: 1, borderColor: C.border,
  },

  btn: {
    backgroundColor: C.honey, borderRadius: R.sm, paddingVertical: 16,
    alignItems: 'center', ...Shadow.glow,
  },
  btnText: { fontSize: T.size.md, color: '#fff', fontWeight: '700' },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: C.sand, borderRadius: R.md, padding: 14, marginTop: S.xl,
  },
  infoText: { flex: 1, fontSize: 12, color: C.text3, lineHeight: 18 },

  terms: {
    fontSize: 11, color: C.text4, textAlign: 'center',
    marginTop: S.xl, lineHeight: 17,
  },
  link: { color: C.honey, fontWeight: '600' },
});
