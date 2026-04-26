/**
 * KycRequiredForActionScreen — Sprint 6a Phase 2d
 *
 * Shown when an action requires full KYC (e.g. refund, return, dispute-open).
 * Sprint 6 model: KYC is badge-only for listing/offer/buying. It's a HARD
 * gate only at the friction moments where platform needs provable identity.
 *
 * Not wired to any action yet — refund/return/dispute features arrive later.
 * This screen is ready for those callsites when they land.
 *
 * Route params:
 *   - actionLabel: string (e.g. "refund", "return", "dispute")
 *   - returnTo?: string (where to navigate after KYC completes)
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { C, T, S, R } from '../utils/tokens';

// Fallback spacing if tokens are missing. Safe at runtime.
const SP_XXL = (S as any).xxl ?? 32;

type Props = {
  navigation: any;
  route: { params?: { actionLabel?: string; returnTo?: string } };
};

export default function KycRequiredForActionScreen({ navigation, route }: Props) {
  const actionLabel = route.params?.actionLabel || 'this action';
  const returnTo = route.params?.returnTo;

  const onVerify = () => {
    navigation.replace('KycFlow', { returnTo });
  };

  const onCancel = () => {
    navigation.goBack();
  };

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

        <TouchableOpacity style={s.primary} onPress={onVerify} activeOpacity={0.85}>
          <Text style={s.primaryText}>Start verification</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.secondary} onPress={onCancel} activeOpacity={0.7}>
          <Text style={s.secondaryText}>Not now</Text>
        </TouchableOpacity>
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
  icon: { fontSize: 56, marginBottom: S.lg },
  title: {
    fontSize: (T.size as any).xl ?? 22,
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
    marginBottom: SP_XXL,
    lineHeight: 20,
    paddingHorizontal: S.md,
  },
  primary: {
    backgroundColor: C.honey,
    paddingVertical: 14,
    paddingHorizontal: SP_XXL,
    borderRadius: R.md,
    minWidth: 220,
    alignItems: 'center',
    marginBottom: S.md,
  },
  primaryText: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: '#fff',
  },
  secondary: {
    paddingVertical: 12,
    paddingHorizontal: S.xl,
  },
  secondaryText: {
    fontSize: T.size.sm,
    color: C.text3,
    fontWeight: T.weight.medium,
  },
});
