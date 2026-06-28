import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { BackButton, Button } from '../../components/ui';
import { DirectSell, type DirectAcquisitionBooking } from '../../services/api';
import type { RootScreen } from '../../navigation/types';
import { C, R, S, Shadow, T, formatPrice } from '../../utils/tokens';
import { parseApiError } from '../../utils/errors';
import { afterInteractions } from '../../utils/schedule';

function statusLabel(status: string) {
  return status.replace(/_/g, ' ');
}

function slotLabel(booking: DirectAcquisitionBooking) {
  try {
    const start = new Date(booking.slot_start);
    const end = new Date(booking.slot_end);
    return `${start.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return 'Pickup slot';
  }
}

function canCancel(status: string) {
  return ['pending_fe_assignment', 'assigned_to_fe', 'fe_en_route', 'fe_arrived'].includes(status);
}

function canRefreshCodes(status: string) {
  return ![
    'seller_final_acceptance',
    'payout_ready',
    'payout_completed',
    'booking_completed',
    'seller_cancelled_before_visit',
    'item_rejected_by_fe',
    'seller_rejected_revised_offer',
    'payout_failed',
    'fraud_review',
  ].includes(status);
}

export default function MyDirectPickupsScreen({
  navigation,
}: RootScreen<'MyDirectPickups'>) {
  const [bookings, setBookings] = useState<DirectAcquisitionBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await DirectSell.myBookings();
      setBookings(res.data?.bookings || []);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => afterInteractions(load), [load]));

  const replaceBooking = (next: DirectAcquisitionBooking) => {
    setBookings((rows) => rows.map((row) => (row.id === next.id ? next : row)));
  };

  const refreshCodes = async (booking: DirectAcquisitionBooking) => {
    setBusy(`codes-${booking.id}`);
    try {
      const res = await DirectSell.refreshVerificationCodes(booking.id);
      replaceBooking(res.data);
      Alert.alert('Codes refreshed', 'Share codes only after checking the Owmee FE at your door.');
    } catch (e) {
      Alert.alert('Could not refresh codes', parseApiError(e, 'Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const cancelBooking = async (booking: DirectAcquisitionBooking) => {
    Alert.alert('Cancel Direct pickup?', 'This can be done only before item QC starts.', [
      { text: 'Keep pickup', style: 'cancel' },
      {
        text: 'Cancel pickup',
        style: 'destructive',
        onPress: async () => {
          setBusy(`cancel-${booking.id}`);
          try {
            const res = await DirectSell.cancelBooking(booking.id, 'seller_cancelled_from_app');
            replaceBooking(res.data);
          } catch (e) {
            Alert.alert('Could not cancel', parseApiError(e, 'Please try again.'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>Direct pickups</Text>
        </View>
        <View style={s.center}>
          <ActivityIndicator color={C.petrol} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Direct pickups</Text>
      </View>

      {bookings.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyTitle}>No Direct pickups yet</Text>
          <Text style={s.emptyBody}>
            Direct pickup requests for toys and books will appear here.
          </Text>
          <View style={{ height: S.lg }} />
          <Button label="Start selling" onPress={() => navigation.navigate('SellModeFork')} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          {bookings.map((booking) => (
            <View key={booking.id} style={s.card}>
              <View style={s.cardHead}>
                <View style={s.flex}>
                  <Text style={s.status}>{statusLabel(booking.status)}</Text>
                  <Text style={s.code}>{booking.booking_code}</Text>
                </View>
                <View style={s.amountBox}>
                  <Text style={s.amountLabel}>Offer</Text>
                  <Text style={s.amount}>
                    {formatPrice(booking.final_total_payout_inr || booking.estimated_total_offer_inr)}
                  </Text>
                </View>
              </View>

              <Text style={s.meta}>{slotLabel(booking)}</Text>
              <Text style={s.meta}>{booking.pickup_locality} · {booking.pickup_pincode}</Text>
              {booking.fe_code ? <Text style={s.meta}>Assigned FE: {booking.fe_code}</Text> : null}

              {booking.seller_otp || booking.final_acceptance_otp ? (
                <View style={s.codeBox}>
                  {booking.seller_otp ? (
                    <View style={s.codeCell}>
                      <Text style={s.codeLabel}>Arrival code</Text>
                      <Text style={s.otp}>{booking.seller_otp}</Text>
                    </View>
                  ) : null}
                  {booking.final_acceptance_otp ? (
                    <View style={s.codeCell}>
                      <Text style={s.codeLabel}>Final payout code</Text>
                      <Text style={s.otp}>{booking.final_acceptance_otp}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={s.itemList}>
                {booking.items.map((item) => (
                  <View key={item.id} style={s.itemRow}>
                    <View style={s.flex}>
                      <Text style={s.itemTitle}>{item.item_title}</Text>
                      <Text style={s.itemMeta}>{item.category} · {statusLabel(item.item_status)}</Text>
                    </View>
                    <Text style={s.itemAmount}>{formatPrice(item.fe_final_offer_inr || item.owmee_suggested_offer_inr)}</Text>
                  </View>
                ))}
              </View>

              <View style={s.actions}>
                {canRefreshCodes(booking.status) ? (
                  <Button
                    label="Refresh codes"
                    variant="secondary"
                    size="sm"
                    loading={busy === `codes-${booking.id}`}
                    disabled={!!busy}
                    onPress={() => refreshCodes(booking)}
                  />
                ) : null}
                {canCancel(booking.status) ? (
                  <Button
                    label="Cancel"
                    variant="destructive"
                    size="sm"
                    loading={busy === `cancel-${booking.id}`}
                    disabled={!!busy}
                    onPress={() => cancelBooking(booking)}
                  />
                ) : null}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
  },
  headerTitle: { fontSize: T.h3, fontWeight: T.weight.bold, color: C.text },
  scroll: { padding: S.lg, paddingBottom: S.xxxl },
  emptyTitle: { fontSize: T.h3, color: C.text, fontWeight: T.weight.bold },
  emptyBody: { fontSize: T.body, color: C.text3, textAlign: 'center', marginTop: S.sm, lineHeight: 21 },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: S.md },
  status: { fontSize: T.h3, color: C.text, fontWeight: T.weight.bold, textTransform: 'capitalize' },
  code: { fontSize: T.small, color: C.text3, fontWeight: T.weight.semi, marginTop: 2 },
  amountBox: { alignItems: 'flex-end' },
  amountLabel: { fontSize: T.small, color: C.text3, fontWeight: T.weight.semi },
  amount: { fontSize: T.h3, color: C.petrolDeep, fontWeight: T.weight.heavy },
  meta: { color: C.text2, fontSize: T.body, marginTop: S.xs, lineHeight: 20 },
  codeBox: {
    flexDirection: 'row',
    gap: S.sm,
    marginTop: S.md,
    paddingTop: S.md,
    borderTopWidth: 1,
    borderTopColor: C.border2,
  },
  codeCell: {
    flex: 1,
    backgroundColor: C.petrolLight,
    borderRadius: R.md,
    padding: S.md,
  },
  codeLabel: { color: C.petrolDeep, fontSize: T.small, fontWeight: T.weight.semi },
  otp: { color: C.petrolDeep, fontSize: T.h3, fontWeight: T.weight.heavy, letterSpacing: 0, marginTop: 2 },
  itemList: { marginTop: S.md, gap: S.sm },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    padding: S.md,
    backgroundColor: C.white,
  },
  itemTitle: { color: C.text, fontSize: T.body, fontWeight: T.weight.semi },
  itemMeta: { color: C.text3, fontSize: T.small, marginTop: 2, textTransform: 'capitalize' },
  itemAmount: { color: C.text, fontSize: T.body, fontWeight: T.weight.bold },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: S.sm, marginTop: S.md },
});
