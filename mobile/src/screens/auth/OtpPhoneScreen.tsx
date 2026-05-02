import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R } from '../../utils/tokens';
import { Button, IconButton } from '../../components/ui';
import { Auth } from '../../services/api';

export default function OtpPhoneScreen({ navigation }: any) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const phoneClean = phone.replace(/\D/g, '');
  const isValid = phoneClean.length === 10;

  const submit = async () => {
    if (!isValid) { Alert.alert('Invalid', 'Enter a 10-digit number'); return; }
    setLoading(true);
    try {
      await Auth.requestOtp(`+91${phoneClean}`);
      navigation.navigate('OtpVerify', { phone: `+91${phoneClean}` });
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.backWrap}>
        <IconButton icon="←" onPress={() => navigation.goBack()} a11y="Back" size="sm" />
      </View>
      <View style={s.body}>
        <Text style={s.title}>Enter your mobile number</Text>
        <Text style={s.sub}>We'll send a 6-digit OTP to verify</Text>
        <View style={s.row}>
          <View style={s.flag}>
            <Text style={s.flagEmoji}>🇮🇳</Text>
            <Text style={s.flagText}>+91</Text>
          </View>
          <TextInput
            style={s.input}
            placeholder="98XXXXXXXX"
            placeholderTextColor={C.text4}
            keyboardType="phone-pad"
            maxLength={10}
            value={phone}
            onChangeText={setPhone}
            autoFocus
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
        />
        <Text style={s.terms}>
          By continuing, you agree to our{' '}
          <Text style={s.termsLink}>Terms of Service</Text> and{' '}
          <Text style={s.termsLink}>Privacy Policy</Text>
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
  row: { flexDirection: 'row', gap: S.sm, marginBottom: S.xxl },
  flag: {
    flexDirection: 'row', alignItems: 'center', gap: S.xs,
    backgroundColor: C.surface, borderRadius: R.sm,
    paddingHorizontal: S.md, paddingVertical: S.md,
    borderWidth: 0.5, borderColor: C.border,
  },
  flagEmoji: { fontSize: T.size.sm + 1 },
  flagText: { fontSize: T.size.sm + 1, color: C.text },
  input: {
    flex: 1, backgroundColor: C.surface, borderRadius: R.sm,
    paddingHorizontal: S.md, paddingVertical: S.md,
    fontSize: T.size.lg + 1, letterSpacing: 2, color: C.text,
    borderWidth: 0.5, borderColor: C.border,
  },
  terms: {
    fontSize: T.size.sm, color: C.text4,
    textAlign: 'center', marginTop: S.lg, lineHeight: 16,
  },
  termsLink: { color: C.petrol, fontWeight: T.weight.medium },
});
