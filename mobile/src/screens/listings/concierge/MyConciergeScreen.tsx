/**
 * MyConciergeScreen — Concierge master spec section 7.2
 *
 * The seller's home base after the visit. Each visit becomes a card
 * containing the items it produced; each item shows its current status
 * (Live / Sold / Pending logistics) and tappable navigation to the right
 * detail screen (ListingDetail or TransactionDetail).
 *
 * Pending earnings = sum of (transaction.gross_amount -
 * transaction.tds_withheld) across completed sales the seller hasn't
 * been paid out for yet. We compute this client-side because at pilot
 * scale a single composite endpoint isn't worth the round-trip savings.
 *
 * Data sources (existing endpoints):
 *   GET /v1/fe-visits/me        — seller's visits
 *   GET /v1/listings/me/listings — seller's listings (filter clientside)
 *   GET /v1/transactions         — seller's transactions
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import {
  FEVisits,
  Listings,
  Transactions,
  type FEVisit,
  type Transaction,
} from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import { C, R, S, T, Shadow, formatPrice } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';
import { afterInteractions } from '../../../utils/schedule';

interface MyListing {
  id: string;
  title: string;
  price: string | number;
  status: string;
  thumbnail_url?: string | null;
  created_via_fe_visit_id?: string | null;
}

interface VisitGroup {
  visit: FEVisit;
  listings: MyListing[];
  /** Active sales (paid, not yet completed) */
  activeSales: Transaction[];
  /** Completed sales (settled or pending payout) */
  completedSales: Transaction[];
  pendingEarnings: number;
}

export default function MyConciergeScreen({
  navigation,
}: RootScreen<'MyConcierge'>) {
  const [visits, setVisits] = useState<FEVisit[]>([]);
  const [listings, setListings] = useState<MyListing[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [vR, lR, tR] = await Promise.all([
        FEVisits.mine(),
        Listings.myListings(),
        Transactions.list().catch(() => ({ data: [] as Transaction[] })),
      ]);
      setVisits(vR.data);
      setListings((lR.data?.listings as MyListing[]) || []);
      setTransactions(
        Array.isArray(tR.data) ? (tR.data as Transaction[]) : (tR.data as any)?.transactions || [],
      );
    } catch {
      setVisits([]);
      setListings([]);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => afterInteractions(load), [load]),
  );

  const groups: VisitGroup[] = useMemo(() => {
    return visits.map((visit) => {
      const visitListings = listings.filter(
        (l) => l.created_via_fe_visit_id === visit.id,
      );
      const listingIds = new Set(visitListings.map((l) => l.id));

      const sales = transactions.filter((t) => listingIds.has((t as any).listing_id));
      const activeSales = sales.filter(
        (t) => !['completed', 'cancelled', 'refunded'].includes(t.status),
      );
      const completedSales = sales.filter((t) => t.status === 'completed');

      // Pending = sales with payout_eligible status or earlier
      const pendingEarnings = sales
        .filter((t) => !['completed', 'cancelled', 'refunded'].includes(t.status))
        .reduce((sum, t) => {
          const gross = Number((t as any).gross_amount || 0);
          const tds = Number((t as any).tds_withheld || 0);
          const delivery = Number((t as any).delivery_fee || 0);
          return sum + Math.max(0, gross - tds - delivery);
        }, 0);

      return {
        visit,
        listings: visitListings,
        activeSales,
        completedSales,
        pendingEarnings,
      };
    });
  }, [visits, listings, transactions]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>My Concierge</Text>
        </View>
        <View style={s.center}>
          <ActivityIndicator color={C.petrol} />
        </View>
      </SafeAreaView>
    );
  }

  if (visits.length === 0) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        <View style={s.headerRow}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={s.headerTitle}>My Concierge</Text>
        </View>
        <View style={s.center}>
          <Text style={s.emoji}>📦</Text>
          <Text style={s.emptyTitle}>No visits yet</Text>
          <Text style={s.emptyBody}>
            Book a free Owmee Specialist visit and we'll come to your home.
          </Text>
          <View style={{ height: S.xl }} />
          <Button
            label="Book a visit"
            onPress={() => navigation.navigate('SellModeFork')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>My Concierge</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: S.lg }}>
        {groups.map((g) => (
          <VisitCard
            key={g.visit.id}
            group={g}
            navigation={navigation}
            transactions={transactions}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function VisitCard({
  group,
  navigation,
  transactions,
}: {
  group: VisitGroup;
  navigation: any;
  transactions: Transaction[];
}) {
  const { visit, listings, pendingEarnings } = group;

  const dayLabel = (() => {
    const iso = visit.scheduled_slot_start || visit.requested_slot_start;
    if (!iso) return 'Visit';
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
  })();

  return (
    <View style={s.card}>
      <TouchableOpacity
        onPress={() => navigation.navigate('VisitDetail', { visit_id: visit.id })}
        activeOpacity={0.85}
      >
        <View style={s.cardHead}>
          <Text style={s.dayLabel}>🚚 {dayLabel}</Text>
          <Text style={s.itemsCount}>
            {listings.length} {listings.length === 1 ? 'item' : 'items'}
          </Text>
        </View>
      </TouchableOpacity>

      {listings.length === 0 ? (
        <Text style={s.noItems}>
          {visit.status === 'completed'
            ? 'No items listed from this visit.'
            : 'Items from this visit will appear here once your specialist lists them.'}
        </Text>
      ) : (
        listings.map((l) => {
          const sale = transactions.find(
            (t) => (t as any).listing_id === l.id,
          );
          return (
            <ItemRow
              key={l.id}
              listing={l}
              transaction={sale}
              onPress={() => {
                if (sale) {
                  navigation.navigate('TransactionDetail', {
                    transactionId: sale.id,
                  });
                } else {
                  navigation.navigate('ListingDetail', { listingId: l.id, initialListing: l });
                }
              }}
            />
          );
        })
      )}

      {pendingEarnings > 0 ? (
        <View style={s.earningsRow}>
          <Text style={s.earningsLabel}>Pending earnings</Text>
          <Text style={s.earningsAmount}>{formatPrice(pendingEarnings)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ItemRow({
  listing,
  transaction,
  onPress,
}: {
  listing: MyListing;
  transaction?: Transaction;
  onPress: () => void;
}) {
  let statusLine: string;
  let statusColor: string;
  if (transaction?.status === 'completed') {
    statusLine = `✓ SOLD — ${formatPrice(Number((transaction as any).gross_amount || listing.price))}`;
    statusColor = C.petrol;
  } else if (transaction) {
    statusLine = `In progress · ${transaction.status.replace(/_/g, ' ')}`;
    statusColor = C.petrolDeep;
  } else if (listing.status === 'sold') {
    statusLine = '✓ SOLD';
    statusColor = C.petrol;
  } else if (listing.status === 'reserved') {
    statusLine = 'Reserved';
    statusColor = C.petrolDeep;
  } else if (listing.status === 'active' || listing.status === 'live') {
    statusLine = 'Live';
    statusColor = C.text2;
  } else {
    statusLine = listing.status;
    statusColor = C.text3;
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={s.itemRow}>
      <View style={s.itemFlex}>
        <Text style={s.itemTitle} numberOfLines={2}>
          {listing.title}
        </Text>
        <Text style={[s.itemStatus, { color: statusColor }]}>{statusLine}</Text>
      </View>
      <Text style={s.itemPrice}>{formatPrice(Number(listing.price))}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
  },
  headerTitle: {
    fontSize: T.size.lg + 1,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
  },
  emoji: { fontSize: T.size.display + 26, marginBottom: S.md },     // 56
  emptyTitle: {
    fontSize: T.size.lg + 1,
    fontWeight: T.weight.bold,
    color: C.text,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: T.size.sm + 1,
    color: C.text2,
    textAlign: 'center',
    marginTop: S.sm,
    lineHeight: 20,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: S.md,
  },
  dayLabel: {
    fontSize: T.size.lg - 1,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  itemsCount: {
    fontSize: T.size.sm,
    color: C.text3,
    fontWeight: T.weight.medium,
  },
  noItems: {
    fontSize: T.size.base,
    color: C.text3,
    fontStyle: 'italic',
    paddingVertical: S.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.sm,
    borderTopWidth: 1,
    borderTopColor: C.border,
    gap: S.md,
  },
  itemFlex: { flex: 1 },
  itemTitle: {
    fontSize: T.size.sm + 1,
    color: C.text,
    fontWeight: T.weight.semi,
  },
  itemStatus: {
    fontSize: T.size.sm,
    fontWeight: T.weight.medium,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: T.size.sm + 1,
    color: C.text,
    fontWeight: T.weight.bold,
  },
  earningsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: S.md,
    paddingTop: S.sm,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  earningsLabel: {
    fontSize: T.size.base,
    color: C.text2,
    fontWeight: T.weight.medium,
  },
  earningsAmount: {
    fontSize: T.size.lg - 1,
    color: C.petrolDeep,
    fontWeight: T.weight.bold,
  },
});
