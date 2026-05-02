/**
 * BookingConfirmedScreen — Concierge master spec section 4.4
 *
 * The success state immediately after booking. Two CTAs:
 *   - Add to calendar — uses react-native-add-calendar-event if available;
 *     falls back gracefully if the dep isn't installed yet (no crash).
 *   - Track visit — Phase 4 wires this to MyConciergeScreen. For Phase 1,
 *     we navigate to the placeholder MyConcierge route.
 *
 * The "matching specialist" message is the trust signal — it bridges the
 * silence between booking and Phase 2's N2 push ("Vikram is your Owmee
 * Specialist").
 */
import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../../components/ui';
import { CONCIERGE_STRINGS } from '../../../utils/conciergeStrings';
import { C, R, S, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

const STR = CONCIERGE_STRINGS.bookingConfirmed;

export default function BookingConfirmedScreen({
  navigation,
  route,
}: RootScreen<'ConciergeBookingConfirmed'>) {
  const visit = route.params?.visit;

  const slotLabel = formatSlotLabel(
    visit?.requested_slot_start,
    visit?.requested_slot_end,
  );
  const addressLine = formatAddressLine(visit?.address);

  const onAddToCalendar = () => {
    // react-native-add-calendar-event isn't installed in this repo. Metro
    // can't statically resolve `require('react-native-add-calendar-event')`
    // at bundle time, which shifted the dep map and broke every other
    // require in this module — that's the root cause of the
    // "Cannot read property 'cream' of undefined" boot crash this screen
    // surfaced. Re-enable the calendar pipe by adding the dep + replacing
    // this stub with the real call (master spec section 4.4 calendar CTA).
    Alert.alert(
      'Calendar',
      'Calendar add-on lands in the next pass. The visit details are saved in My Concierge.',
    );
  };

  const onTrackVisit = () => {
    navigation.replace('MyConcierge');
  };

  const onBackHome = () => {
    navigation.reset({
      index: 0,
      routes: [{ name: 'MainTabs' as never }],
    });
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.body}>
        <Text style={s.tick}>✓</Text>
        <Text style={s.title}>{STR.title}</Text>

        {slotLabel ? <Text style={s.slot}>{slotLabel}</Text> : null}
        {addressLine ? <Text style={s.address}>{addressLine}</Text> : null}

        <View style={s.matchingCard}>
          <Text style={s.matchingMessage}>{STR.matchingMessage}</Text>
        </View>

        <View style={s.gap} />

        <Button
          label={STR.addToCalendar}
          onPress={onAddToCalendar}
          variant="secondary"
          fullWidth
          style={s.cta}
        />
        <Button
          label={STR.trackVisit}
          onPress={onTrackVisit}
          variant="ghost"
          fullWidth
          style={s.cta}
        />
      </View>

      <View style={s.footer}>
        <Button
          label={STR.backHome}
          variant="ghost"
          size="sm"
          onPress={onBackHome}
        />
      </View>
    </SafeAreaView>
  );
}

function formatSlotLabel(startIso?: string, endIso?: string): string {
  if (!startIso || !endIso) return '';
  const start = new Date(startIso);
  const end = new Date(endIso);
  const now = new Date();
  const diffDays = Math.floor(
    (start.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );
  let dayLabel: string;
  if (
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth() &&
    start.getDate() === now.getDate()
  ) {
    dayLabel = 'Today';
  } else if (diffDays === 0 || diffDays === 1) {
    dayLabel = 'Tomorrow';
  } else {
    dayLabel = start.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
  }
  const sH = start.getHours();
  const eH = end.getHours();
  const fmt = (h: number) =>
    h === 12 ? '12' : h > 12 ? String(h - 12) : String(h);
  const ampm = (h: number) => (h < 12 ? 'am' : 'pm');
  const samePeriod = (sH < 12) === (eH < 12);
  const time = samePeriod
    ? `${fmt(sH)}-${fmt(eH)}${ampm(eH)}`
    : `${fmt(sH)}${ampm(sH)}-${fmt(eH)}${ampm(eH)}`;
  return `${dayLabel}, ${time}`;
}

function formatAddressLine(address?: any): string {
  if (!address) return '';
  const parts = [
    address.flat_house_number,
    address.building_name,
    address.locality,
    address.city,
  ].filter(Boolean);
  return parts.join(', ');
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
  },
  tick: {
    fontSize: T.size.display + 26,
    color: C.petrol,
    marginBottom: S.md,
  },
  title: {
    fontSize: T.size.xxl,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.lg,
    textAlign: 'center',
  },
  slot: {
    fontSize: T.size.lg + 1,
    fontWeight: T.weight.semi,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.xs + 2,
  },
  address: {
    fontSize: T.size.sm + 1,
    color: C.text2,
    textAlign: 'center',
    marginBottom: S.lg,
  },
  matchingCard: {
    backgroundColor: C.petrolLight,
    borderRadius: R.lg,
    padding: S.lg,
    marginTop: S.md,
    width: '100%',
  },
  matchingMessage: {
    fontSize: T.size.sm + 1,
    color: C.petrolText,
    lineHeight: 20,
    textAlign: 'center',
  },
  gap: { height: S.xl },
  cta: { marginBottom: S.sm },
  footer: {
    paddingHorizontal: S.xl,
    paddingBottom: S.md,
    alignItems: 'center',
  },
});
