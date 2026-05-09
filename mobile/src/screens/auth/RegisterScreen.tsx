/**
 * RegisterScreen — PHONE NUMBER ONLY
 *
 * Goal: fastest possible signup. No name, no email, no address.
 * User enters 10-digit mobile → OTP → account created → browse.
 *
 * Address is captured later:
 *   - Location/address collected by the saved-address flow after sign-in
 *   - Buy/Sell triggers KYC with address confirm from Aadhaar
 *
 * Why phone-only:
 *   - Matches OLX, Cashify, Meesho signup friction (all phone-only)
 *   - India uses phone as primary ID (not email)
 *   - Trust is earned through KYC, not self-reported name
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R, Shadow } from '../../utils/tokens';
import { Button, IconButton } from '../../components/ui';
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
      navigation.navigate('OtpVerify', { phone: `+91${phoneClean}` });
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e, 'Could not send OTP'));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.getParent()?.goBack();
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.flex}
      >
        <View style={s.backWrap}>
          <IconButton icon="←" onPress={handleBack} a11y="Back" size="sm" />
        </View>

        <View style={s.body}>
          <Text style={s.title}>Enter your mobile number</Text>
          <Text style={s.sub}>We'll send you a 6-digit OTP to verify</Text>

          <View style={s.badges}>
            <View style={s.badge}>
              <Text style={s.badgeIcon}>🛡️</Text>
              <Text style={s.badgeText}>Aadhaar-verified sellers</Text>
            </View>
            <View style={s.badge}>
              <Text style={s.badgeIcon}>💳</Text>
              <Text style={s.badgeText}>UPI-protected payments</Text>
            </View>
          </View>

          <View style={s.inputRow}>
            <View style={s.flag}>
              <Text style={s.flagEmoji}>🇮🇳</Text>
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

          <Button
            label="Send OTP"
            variant="primary"
            size="lg"
            disabled={!isValid || loading}
            loading={loading}
            onPress={submit}
            fullWidth
            style={s.cta}
          />

          <View style={s.infoCard}>
            <Text style={s.infoIcon}>ℹ️</Text>
            <Text style={s.infoText}>
              Just phone required. We'll ask for Aadhaar and PAN only when you
              buy or sell — never before.
            </Text>
          </View>

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
  safe: { flex: 1, backgroundColor: C.bone },
  flex: { flex: 1 },
  backWrap: { paddingHorizontal: S.lg, paddingVertical: S.sm },
  body: { flex: 1, paddingHorizontal: S.xl, paddingTop: S.md },

  title: {
    fontSize: T.size.xxl,
    fontWeight: T.weight.bold,
    color: C.ink,
    marginBottom: S.xs,
    letterSpacing: -0.5,
  },
  sub: { fontSize: T.size.md, color: C.text3, marginBottom: S.xl, lineHeight: 21 },

  badges: { flexDirection: 'row', gap: S.sm, marginBottom: S.xxl },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: S.xs + 2,
    backgroundColor: C.petrolLight,
    paddingHorizontal: S.md, paddingVertical: S.sm,
    borderRadius: R.pill,
  },
  badgeIcon: { fontSize: T.size.sm + 1 },
  badgeText: { fontSize: T.size.sm, fontWeight: T.weight.semi, color: C.petrolDeep },

  inputRow: { flexDirection: 'row', gap: S.sm, marginBottom: S.lg },
  flag: {
    flexDirection: 'row', alignItems: 'center', gap: S.xs + 2,
    backgroundColor: C.surface, borderRadius: R.sm,
    paddingHorizontal: S.md + 2, paddingVertical: S.md + 2,
    borderWidth: 1, borderColor: C.border,
  },
  flagEmoji: { fontSize: T.size.lg - 1 },
  flagText: { fontSize: T.size.md, color: C.text, fontWeight: T.weight.semi },
  input: {
    flex: 1,
    backgroundColor: C.surface, borderRadius: R.sm,
    paddingHorizontal: S.md + 2, paddingVertical: S.md + 2,
    fontSize: T.size.xl,
    letterSpacing: 2, color: C.text,
    borderWidth: 1, borderColor: C.border,
  },

  cta: { ...Shadow.glow },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: S.sm + 2,
    backgroundColor: C.bone2, borderRadius: R.md,
    padding: S.md + 2, marginTop: S.xl,
  },
  infoIcon: { fontSize: T.size.sm + 1 },
  infoText: { flex: 1, fontSize: T.size.sm, color: C.text3, lineHeight: 18 },

  terms: {
    fontSize: T.size.sm,
    color: C.text4, textAlign: 'center',
    marginTop: S.xl, lineHeight: 17,
  },
  link: { color: C.petrol, fontWeight: T.weight.semi },
});
