/**
 * KycRequiredForActionScreen — Sprint 6a Phase 2d
 *
 * Shown when an action requires full KYC (e.g. refund, return, dispute-open).
 * Sprint 6 model: KYC is badge-only for listing/offer/buying. It's a HARD
 * gate only at the friction moments where platform needs provable identity.
 *
 * Route params:
 *   - actionLabel: string (e.g. "refund", "return", "dispute")
 *   - returnTo?: string (where to navigate after KYC completes)
 */
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { C, T, S } from '../utils/tokens';
import { Button } from '../components/ui';

type Props = {
  navigation: any;
  route: { params?: { actionLabel?: string; returnTo?: string } };
};

export default function KycRequiredForActionScreen({ navigation, route }: Props) {
  const actionLabel = route.params?.actionLabel || 'this action';
  const returnTo = route.params?.returnTo;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <Text style={s.icon}>🔒</Text>

        <Text style={s.title}>Verify to continue</Text>

        <Text style={s.body}>
          To process {actionLabel}, we need to verify your identity first.
        </Text>

        <Text style={s.sub}>
          This protects everyone on Owmee from fraud. Takes about 2 minutes —
          Aadhaar OTP + PAN. You'll also get the "Verified by Owmee" badge.
        </Text>

        <Button
          label="Start verification"
          variant="primary"
          size="lg"
          onPress={() => navigation.replace('KycFlow', { returnTo })}
          style={s.primary}
        />

        <Button
          label="Not now"
          variant="ghost"
          size="sm"
          onPress={() => navigation.goBack()}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.surface },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xl,
  },
  icon: { fontSize: T.size.display + 26, marginBottom: S.lg },     // 56
  title: {
    fontSize: T.size.xl,
    fontWeight: T.weight.heavy,
    color: C.ink,
    marginBottom: S.md,
    textAlign: 'center',
  },
  body: {
    fontSize: T.size.base,
    color: C.text2,
    textAlign: 'center',
    marginBottom: S.md,
    lineHeight: 22,
  },
  sub: {
    fontSize: T.size.sm,
    color: C.text3,
    textAlign: 'center',
    marginBottom: S.xxl,
    lineHeight: 20,
    paddingHorizontal: S.md,
  },
  primary: { minWidth: 220, marginBottom: S.md },
});
