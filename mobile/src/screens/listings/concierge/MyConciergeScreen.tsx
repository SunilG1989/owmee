/**
 * MyConciergeScreen — Phase 1 placeholder; Phase 4 implements the real
 * timeline view (master spec section 7).
 *
 * For Phase 1 we just need the route to exist so BookingConfirmedScreen's
 * "Track visit" CTA has a target. The placeholder copy reflects the
 * "matching specialist" state since that's the only thing currently
 * happening.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, Button } from '../../../components/ui';
import { C, R, S } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

export default function MyConciergeScreen({
  navigation,
}: RootScreen<'MyConcierge'>) {
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>My Concierge</Text>
      </View>

      <View style={s.body}>
        <Text style={s.emoji}>🚚</Text>
        <Text style={s.title}>Matching you with a Specialist</Text>
        <Text style={s.body2}>
          We'll send you a notification once an Owmee Specialist accepts
          your visit. Usually within a few hours.
        </Text>
        <Text style={s.body3}>
          The full timeline (live items, sales, payouts) lands here in
          the next update.
        </Text>

        <View style={{ height: S.xl }} />

        <Button
          label="Back to home"
          onPress={() =>
            navigation.reset({
              index: 0,
              routes: [{ name: 'MainTabs' as never }],
            })
          }
          variant="secondary"
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: C.text,
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
    gap: S.sm,
  },
  emoji: { fontSize: 56, marginBottom: S.sm },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
  },
  body2: {
    fontSize: 14,
    color: C.text2,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: S.sm,
  },
  body3: {
    fontSize: 12,
    color: C.text3,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: S.md,
  },
});
