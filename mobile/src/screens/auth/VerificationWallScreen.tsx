/**
 * VerificationWall — Sprint 4 / Pass 3 (3f)
 *
 * Full-screen modal shown when an unverified user tries to buy, sell, or
 * publish. Presents two paths:
 *   1. Self-verify (KYC flow) — recommended for most users
 *   2. Book an Owmee Field Executive (FE visit) — for sellers who want
 *      a human to come to their house and handle everything
 */
import React from 'react';
import {
  SafeAreaView, View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from 'react-native';
import { ShieldCheck } from 'lucide-react-native';

import { C, T, S, R, Shadow } from '../../utils/tokens';
import { Button, ScreenHeader } from '../../components/ui';
import type { RootScreen } from '../../navigation/types';

type Intent = 'buy' | 'sell' | 'publish' | undefined;

const COPY: Record<string, { title: string; body: string; cta: string }> = {
  buy: {
    title: 'Verify to buy',
    body:
      'To protect everyone on Owmee, buyers are verified before making offers or payments. ' +
      'It takes about 3 minutes — Aadhaar OTP, PAN, and a quick selfie.',
    cta: 'Verify my identity',
  },
  sell: {
    title: 'Verify to sell',
    body:
      'Sellers on Owmee are verified so buyers can trust the listings. ' +
      'Complete Aadhaar OTP and PAN to start listing.',
    cta: 'Verify my identity',
  },
  publish: {
    title: 'One step before publishing',
    body:
      'Your listing is almost ready. Complete identity verification so buyers know they’re dealing with a real, verified seller.',
    cta: 'Verify my identity',
  },
  default: {
    title: 'Verification required',
    body:
      'Owmee is a trust-first marketplace. Complete verification to continue.',
    cta: 'Verify my identity',
  },
};

export default function VerificationWallScreen({
  route, navigation,
}: RootScreen<'VerificationWall'>) {
  const intent: Intent = route.params?.intent;
  const copy = COPY[intent || 'default'] || COPY.default;

  const bookFeVisit = () => navigation.replace('ConciergeBooking');
  const startKyc = () => navigation.replace('KycFlow', { returnTo: intent });
  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('MainTabs' as never);
  };

  return (
    <SafeAreaView style={st.root}>
      <ScreenHeader onBack={close} backKind="close" tone="canvas" />

      <ScrollView
        contentContainerStyle={st.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={st.shield}>
          <ShieldCheck size={42} strokeWidth={2.1} color={C.petrolDeep} />
        </View>

        <Text style={st.h1}>{copy.title}</Text>
        <Text style={st.body}>{copy.body}</Text>

        <View style={st.bulletBox}>
          <Bullet text="We only ask for what’s required by law (Aadhaar + PAN)" />
          <Bullet text="Your Aadhaar number is never stored on our servers" />
          <Bullet text="Verified users get a blue check across the app" />
        </View>

        <Button
          label={copy.cta}
          variant="primary"
          size="lg"
          onPress={startKyc}
          fullWidth
          style={st.primaryBtn}
        />

        {(intent === 'sell' || intent === 'publish' || intent === undefined) && (
          <>
            <View style={st.orRow}>
              <View style={st.orLine} />
              <Text style={st.orText}>OR</Text>
              <View style={st.orLine} />
            </View>

            <TouchableOpacity style={st.secondaryBtn} onPress={bookFeVisit}>
              <Text style={st.secondaryBtnText}>Book an Owmee Specialist visit</Text>
              <Text style={st.secondaryBtnSub}>
                An Owmee Specialist visits your home, verifies your ID, packs the item, and lists it for you.
              </Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={st.laterLink} onPress={close} accessibilityRole="button">
          I’ll do this later
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={st.bulletRow}>
      <Text style={st.bulletDot}>•</Text>
      <Text style={st.bulletText}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bone },

  scroll: { padding: S.xxxl, paddingBottom: S.xxl },

  shield: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.petrolLight,
    alignSelf: 'center',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: S.xl,
    ...Shadow.glow,
  },
  h1: {
    fontSize: T.h1, fontWeight: T.weight.bold, color: C.text,
    textAlign: 'center', marginBottom: S.md,
  },
  body: {
    fontSize: T.body, color: C.text2,
    textAlign: 'center', lineHeight: 22, marginBottom: S.xl,
  },

  bulletBox: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.xl,
    ...Shadow.glow,
  },
  bulletRow: { flexDirection: 'row', marginBottom: 6 },
  bulletDot: { color: C.petrol, fontSize: T.body, marginRight: S.sm, lineHeight: 22 },
  bulletText: { color: C.text2, fontSize: T.small, flex: 1, lineHeight: 20 },

  primaryBtn: { ...Shadow.glow },

  orRow: { flexDirection: 'row', alignItems: 'center', marginVertical: S.lg },
  orLine: { flex: 1, height: 1, backgroundColor: C.border },
  orText: {
    marginHorizontal: S.md,
    color: C.text3,
    fontSize: T.small,
    fontWeight: T.weight.semi,
  },

  secondaryBtn: {
    backgroundColor: C.surface,
    borderWidth: 1.25,
    borderColor: C.blueBorder,
    borderRadius: R.md,
    padding: S.lg,
    alignItems: 'center',
  },
  secondaryBtnText: { color: C.ctaPrimary, fontSize: T.body, fontWeight: T.weight.bold },
  secondaryBtnSub: {
    color: C.text3,
    fontSize: T.small,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },

  laterLink: {
    color: C.text3, fontSize: T.small,
    textDecorationLine: 'underline',
    marginTop: S.lg, alignSelf: 'center',
  },
});
