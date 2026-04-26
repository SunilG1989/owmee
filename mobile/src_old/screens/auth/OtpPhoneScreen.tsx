/**
 * OtpPhoneScreen + OtpVerifyScreen
 * Phone number entry → OTP verification → auth store populated
 */

import React, { useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Radius } from '../../utils/tokens';
import { Auth } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import type { AuthStackParams } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<AuthStackParams>;

// ── Phone screen ─────────────────────────────────────────────────────────────

export function OtpPhoneScreen() {
  const navigation = useNavigation<Nav>();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const formatPhone = (raw: string) => raw.replace(/[^0-9]/g, '').slice(0, 10);

  const submit = async () => {
    if (phone.length !== 10) {
      Alert.alert('Enter a valid 10-digit mobile number');
      return;
    }
    setLoading(true);
    try {
      await Auth.sendOtp(`+91${phone}`);
      navigation.navigate('OtpVerify', { phone: `+91${phone}` });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not send OTP. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.inner}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>

          <Text style={styles.title}>What's your{'\n'}mobile number?</Text>
          <Text style={styles.subtitle}>
            We'll send a one-time code to verify it's you.
          </Text>

          <View style={styles.phoneRow}>
            <View style={styles.countryCode}>
              <Text style={styles.countryFlag}>🇮🇳</Text>
              <Text style={styles.countryNum}>+91</Text>
            </View>
            <TextInput
              style={styles.phoneInput}
              placeholder="98765 43210"
              placeholderTextColor={Colors.text4}
              keyboardType="phone-pad"
              maxLength={10}
              value={phone}
              onChangeText={v => setPhone(formatPhone(v))}
              autoFocus
            />
          </View>

          <Text style={styles.privacyNote}>
            Your number is used only for verification. We never share it.
          </Text>

          <TouchableOpacity
            style={[styles.ctaBtn, phone.length === 10 && styles.ctaBtnActive]}
            onPress={submit}
            disabled={phone.length !== 10 || loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={Colors.white} size="small" />
              : <Text style={styles.ctaBtnText}>Send OTP →</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default OtpPhoneScreen;

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  kav: { flex: 1 },
  inner: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  backBtn: { marginBottom: Spacing.xl, padding: 4, alignSelf: 'flex-start' },
  backText: { fontSize: 20, color: Colors.text3 },

  title: {
    fontSize: 30,
    fontWeight: '300',
    color: Colors.text,
    letterSpacing: -0.5,
    lineHeight: 37,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.text3,
    lineHeight: 21,
    marginBottom: Spacing.xxxl,
  },

  // Phone input
  phoneRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 0.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
  },
  countryFlag: { fontSize: 18 },
  countryNum: { fontSize: 15, fontWeight: '500', color: Colors.text },
  phoneInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 0.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: '400',
    color: Colors.text,
    letterSpacing: 1,
  },
  privacyNote: {
    fontSize: 12,
    color: Colors.text4,
    marginBottom: Spacing.xxxl,
    lineHeight: 18,
  },

  ctaBtn: {
    width: '100%',
    paddingVertical: 15,
    borderRadius: Radius.md + 2,
    backgroundColor: Colors.border2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaBtnActive: {
    backgroundColor: Colors.teal,
  },
  ctaBtnText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.white,
  },

  // OTP boxes
  otpContainer: {
    flexDirection: 'row',
    gap: Spacing.sm,
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  otpBox: {
    width: 46,
    height: 56,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  otpBoxActive: {
    borderColor: Colors.teal,
  },
  otpBoxFilled: {
    borderColor: Colors.teal,
    backgroundColor: Colors.tealLight,
  },
  otpDigit: {
    fontSize: 22,
    fontWeight: '500',
    color: Colors.text,
  },
  otpCursor: {
    position: 'absolute',
    bottom: 10,
    width: 2,
    height: 20,
    backgroundColor: Colors.teal,
    borderRadius: 1,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  loadingText: { fontSize: 13, color: Colors.text3 },
  resendText: {
    fontSize: 14,
    color: Colors.teal,
    fontWeight: '500',
    textAlign: 'center',
  },
  resendDisabled: {
    color: Colors.text4,
  },
});
