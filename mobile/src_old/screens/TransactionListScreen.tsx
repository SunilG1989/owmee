/**
 * TransactionListScreen
 * All transactions (buyer + seller) with status, amount, and quick actions.
 * India UX: "Deals" not "Transactions" — friendlier language.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, Radius, Typography } from '../utils/tokens';
import { Transactions } from '../services/api';
import type { Transaction } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { AppStackParams } from '../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<AppStackParams>;

const STATUS_COLORS: Record<string, string> = {
  payment_captured:  Colors.warm,
  shipment_created:  Colors.teal,
  in_transit:        Colors.teal,
  delivered:         Colors.warm,
  buyer_accepted:    Colors.teal,
  completed:         Colors.teal,
  auto_completed:    Colors.teal,
  disputed:          '#FF4757',
  cancelled:         Colors.text3,
  refunded:          Colors.text3,
  cancelled_at_meetup: Colors.text3,
};

const STATUS_LABELS: Record<string, string> = {
  payment_captured:  'Payment held',
  shipment_created:  'Pickup scheduled',
  in_transit:        'In transit',
  delivered:         'Delivered',
  awaiting_confirmation: 'At meetup',
  buyer_accepted:    'Accepted',
  completed:         'Completed',
  auto_completed:    'Completed',
  disputed:          'Disputed',
  cancelled:         'Cancelled',
  refunded:          'Refunded',
  cancelled_at_meetup: 'Cancelled',
};

function fmt(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function TransactionRow({ txn, userId, onPress }: {
  txn: Transaction; userId: string | null; onPress: () => void;
}) {
  const isBuyer = txn.buyer_id === userId;
  const role = isBuyer ? 'Buying' : 'Selling';
  const color = STATUS_COLORS[txn.status] || Colors.text3;
  const label = STATUS_LABELS[txn.status] || txn.status;
  const isShipped = txn.transaction_type === 'shipped';

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <View style={[styles.roleTag, isBuyer ? styles.roleTagBuyer : styles.roleTagSeller]}>
          <Text style={[styles.roleText, isBuyer ? styles.roleTextBuyer : styles.roleTextSeller]}>
            {role}
          </Text>
        </View>
        <Text style={styles.amount}>₹{Number(txn.amount || txn.gross_amount || 0).toLocaleString('en-IN')}</Text>
        <Text style={styles.date}>{fmt(txn.created_at)}{isShipped ? ' · Shipped' : ''}</Text>
      </View>
      <View style={styles.rowRight}>
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <Text style={[styles.statusLabel, { color }]}>{label}</Text>
        <Text style={styles.arrow}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function TransactionListScreen() {
  const navigation = useNavigation<Nav>();
  const { userId } = useAuthStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await Transactions.list();
      setTransactions(res.data.transactions || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goToTransaction = (txn: Transaction) => {
    if (txn.transaction_type === 'shipped') {
      navigation.navigate('ShippedTransaction', { transactionId: txn.id });
    } else {
      navigation.navigate('TransactionDetail', { transactionId: txn.id });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Deals</Text>
        <Text style={styles.count}>{transactions.length}</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={Colors.teal} style={{ marginTop: 60 }} />
      ) : transactions.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🤝</Text>
          <Text style={styles.emptyTitle}>No deals yet</Text>
          <Text style={styles.emptySub}>Your completed and active transactions will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={transactions}
          keyExtractor={t => t.id}
          renderItem={({ item }) => (
            <TransactionRow
              txn={item}
              userId={userId}
              onPress={() => goToTransaction(item)}
            />
          )}
          contentContainerStyle={{ paddingVertical: Spacing.sm }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  title: { fontSize: 20, fontWeight: '600', color: Colors.text, flex: 1 },
  count: {
    fontSize: 12, fontWeight: '500', color: Colors.text3,
    backgroundColor: Colors.border2, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10,
  },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 0.5, borderBottomColor: Colors.border2,
  },
  rowLeft: { flex: 1, gap: 3 },
  roleTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 4, marginBottom: 2,
  },
  roleTagBuyer: { backgroundColor: '#EEF7FF' },
  roleTagSeller: { backgroundColor: '#F0FAF5' },
  roleText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  roleTextBuyer: { color: '#3B82F6' },
  roleTextSeller: { color: Colors.teal },
  amount: { fontSize: 17, fontWeight: '600', color: Colors.text, letterSpacing: -0.3 },
  date: { fontSize: 11, color: Colors.text4 },

  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusLabel: { fontSize: 12, fontWeight: '500' },
  arrow: { fontSize: 20, color: Colors.text4, marginLeft: 4 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '500', color: Colors.text, marginBottom: 8 },
  emptySub: { fontSize: 14, color: Colors.text3, textAlign: 'center', lineHeight: 20 },
});
