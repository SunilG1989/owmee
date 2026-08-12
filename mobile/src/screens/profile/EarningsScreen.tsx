import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { BackButton } from '../../components/ui';
import { Payouts, type MyPayoutsResponse } from '../../services/api';
import type { RootScreen } from '../../navigation/types';
import { C, R, S, Shadow, T, formatPrice } from '../../utils/tokens';
import { afterInteractions } from '../../utils/schedule';

const ENTRY_LABELS: Record<string, string> = {
  sale_credit: 'Sale settled',
  refund_clawback: 'Refund adjustment',
  adjustment: 'Adjustment',
  payout_debit: 'Payout released',
};

function entryLabel(type: string) {
  return ENTRY_LABELS[type] || type.replace(/_/g, ' ');
}

function dateLabel(iso: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function EarningsScreen({ navigation }: RootScreen<'Earnings'>) {
  const [data, setData] = useState<MyPayoutsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await Payouts.me();
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => afterInteractions(load), [load]));

  const available = Number(data?.available_balance || 0);
  const reserve = Number(data?.reserve_balance || 0);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Earnings & payouts</Text>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={C.petrol} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll}>
          <View style={s.balanceRow}>
            <View style={[s.balanceCard, s.balanceMain]}>
              <Text style={s.balanceLabel}>Ready for payout</Text>
              <Text style={s.balanceValue}>{formatPrice(available)}</Text>
              <Text style={s.balanceHint}>
                Released in the next payout run after order completion.
              </Text>
            </View>
            <View style={s.balanceCard}>
              <Text style={s.balanceLabel}>In progress</Text>
              <Text style={s.balanceValueMuted}>{formatPrice(reserve)}</Text>
              <Text style={s.balanceHint}>
                Items with Owmee — settles when the buyer window closes.
              </Text>
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Payout account</Text>
            {data?.payout_account ? (
              <View style={s.accountRow}>
                <Text style={s.accountValue}>{data.payout_account.masked_display}</Text>
                <Text style={data.payout_account.verified ? s.badgeOk : s.badgeWarn}>
                  {data.payout_account.verified ? 'Verified' : 'Pending verification'}
                </Text>
              </View>
            ) : (
              <Text style={s.emptyBody}>
                Add your UPI or bank account in the verification flow so Owmee can
                pay you.
              </Text>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Payouts</Text>
            {!data?.payouts?.length ? (
              <Text style={s.emptyBody}>No payouts yet.</Text>
            ) : (
              data.payouts.map(p => (
                <View key={p.id} style={s.lineRow}>
                  <View style={s.flex1}>
                    <Text style={s.lineTitle}>{formatPrice(p.amount)}</Text>
                    <Text style={s.lineMeta}>
                      {dateLabel(p.paid_at)}
                      {p.utr_reference ? ` · Ref ${p.utr_reference}` : ''}
                    </Text>
                  </View>
                  <Text style={p.status === 'recorded' ? s.badgeOk : s.badgeWarn}>
                    {p.status === 'recorded' ? 'Paid' : p.status}
                  </Text>
                </View>
              ))
            )}
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Statement</Text>
            {!data?.ledger?.length ? (
              <Text style={s.emptyBody}>
                Your sales settle here after each order completes.
              </Text>
            ) : (
              data.ledger.map((e, i) => {
                const amount = Number(e.amount);
                const negative = amount < 0;
                return (
                  <View key={`${e.entry_type}-${i}`} style={s.lineRow}>
                    <View style={s.flex1}>
                      <Text style={s.lineTitle}>{entryLabel(e.entry_type)}</Text>
                      <Text style={s.lineMeta}>{dateLabel(e.created_at)}</Text>
                    </View>
                    <Text style={negative ? s.amountNeg : s.amountPos}>
                      {negative ? '−' : '+'}
                      {formatPrice(Math.abs(amount))}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
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
  flex1: { flex: 1 },
  balanceRow: { flexDirection: 'row', gap: S.md, marginBottom: S.md },
  balanceCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    ...Shadow.glow,
  },
  balanceMain: { backgroundColor: C.petrolLight },
  balanceLabel: { fontSize: T.small, color: C.text3, fontWeight: T.weight.semi },
  balanceValue: {
    fontSize: T.h2,
    color: C.petrolDeep,
    fontWeight: T.weight.heavy,
    marginTop: S.xs,
  },
  balanceValueMuted: {
    fontSize: T.h2,
    color: C.text2,
    fontWeight: T.weight.heavy,
    marginTop: S.xs,
  },
  balanceHint: { fontSize: T.small, color: C.text3, marginTop: S.xs, lineHeight: 16 },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  cardTitle: {
    fontSize: T.body,
    color: C.text,
    fontWeight: T.weight.bold,
    marginBottom: S.sm,
  },
  accountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  accountValue: { fontSize: T.body, color: C.text, fontWeight: T.weight.semi },
  emptyBody: { fontSize: T.body, color: C.text3, lineHeight: 20 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    paddingVertical: S.sm,
    borderBottomWidth: 1,
    borderBottomColor: C.border2,
  },
  lineTitle: { fontSize: T.body, color: C.text, fontWeight: T.weight.semi },
  lineMeta: { fontSize: T.small, color: C.text3, marginTop: 2 },
  amountPos: { fontSize: T.body, color: C.petrolDeep, fontWeight: T.weight.bold },
  amountNeg: { fontSize: T.body, color: C.red, fontWeight: T.weight.bold },
  badgeOk: { fontSize: T.small, color: C.petrolDeep, fontWeight: T.weight.bold },
  badgeWarn: { fontSize: T.small, color: C.red, fontWeight: T.weight.bold },
});
