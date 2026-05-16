import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton, Chip } from '../../components/ui';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, Shadow, formatPrice, timeAgo } from '../../utils/tokens';
import { Transactions, type Transaction } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { parseApiError } from '../../utils/errors';
import { afterInteractions } from '../../utils/schedule';

const STATUS_COLORS: Record<string, string> = {
  payment_pending: C.yellow,
  payment_captured: C.petrol,
  at_hub: C.petrol,
  delivery_in_progress: C.petrolMid,
  delivered: C.green,
  completed: C.petrol,
  auto_completed: C.petrol,
  cancelled: C.red,
  pickup_rejected: C.red,
  disputed: C.red,
};

export default function TransactionListScreen({ navigation }: any) {
  const { userId } = useAuthStore();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'buying'|'selling'|'completed'>('buying');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await Transactions.list();
      setTxns(res.data?.transactions || res.data || []);
    } catch (e) {
      setError(parseApiError(e, 'Could not load your orders.'));
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => afterInteractions(load), [load]));

  const renderItem = ({ item }: { item: Transaction }) => {
    const isBuyer = item.buyer_id === userId;
    const dotColor = STATUS_COLORS[item.status] || C.text4;
    return (
      <TouchableOpacity style={s.card} onPress={() => navigation.navigate('TransactionDetail', { transactionId: item.id })} activeOpacity={0.85}>
        <View style={s.iconWrap}>
          <Text style={s.iconEmoji}>🤝</Text>
        </View>
        <View style={s.info}>
          <Text style={s.title} numberOfLines={1}>{item.listing_title || 'Transaction'}</Text>
          <Text style={s.price}>{formatPrice(item.amount)}</Text>
          <View style={s.metaRow}>
            <View style={[s.dot, { backgroundColor: dotColor }]} />
            <Text style={s.status}>{item.status.replace(/_/g, ' ')}</Text>
            <Text style={s.role}>{isBuyer ? '· Buying' : '· Selling'}</Text>
            {item.created_at && <Text style={s.time}>· {timeAgo(item.created_at)}</Text>}
          </View>
        </View>
        <Text style={s.arrow}>›</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color={C.petrol} style={s.loading} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Transactions</Text>
        <View style={s.headerSpacer} />
      </View>
      <View style={s.tabRow}>
        {(['buying', 'selling', 'completed'] as const).map(tab => (
          <Chip
            key={tab}
            label={tab.charAt(0).toUpperCase() + tab.slice(1)}
            selected={activeTab === tab}
            variant="filter"
            onPress={() => setActiveTab(tab)}
            style={s.tabChip}
          />
        ))}
      </View>
      <FlatList
        data={txns.filter(t => activeTab==='buying' ? t.buyer_id===userId : activeTab==='selling' ? t.seller_id===userId : t.status==='completed')}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.petrol} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🤝</Text>
            <Text style={s.emptyTitle}>{error ? 'Could not load orders' : 'No orders yet'}</Text>
            <Text style={s.emptySub}>{error || 'Your buying and selling orders will appear here.'}</Text>
            {error ? (
              <TouchableOpacity style={s.retryBtn} onPress={load} activeOpacity={0.8}>
                <Text style={s.retryText}>Retry</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
        removeClippedSubviews maxToRenderPerBatch={8} windowSize={5}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  loading: { marginTop: S.xxxl + S.xxxl },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingVertical: S.sm + 2,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: T.size.lg - 1, fontWeight: T.weight.semi, color: C.text },
  headerSpacer: { width: 24 },

  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.sm,
    gap: S.sm,
  },
  tabChip: { flex: 1 },

  list: { padding: S.lg },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: R.lg,
    padding: S.md, marginBottom: S.sm + 2,
    borderWidth: 1, borderColor: C.border,
  },
  iconWrap: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.petrolLight,
    alignItems: 'center', justifyContent: 'center',
  },
  iconEmoji: { fontSize: T.size.xxl },
  info: { flex: 1, marginLeft: S.md },
  title: { fontSize: T.size.sm + 1, fontWeight: T.weight.semi, color: C.text, marginBottom: 2 },
  price: { fontSize: T.size.lg - 1, fontWeight: T.weight.bold, color: C.petrol, marginBottom: S.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs },
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: T.size.sm, color: C.text3, textTransform: 'capitalize' },
  role: { fontSize: T.size.sm, color: C.text3 },
  time: { fontSize: T.size.xs, color: C.text4 },
  arrow: { fontSize: T.size.xl, color: C.text4 },
  empty: { alignItems: 'center', paddingTop: S.xxxl + S.xxl },
  emptyEmoji: { fontSize: T.size.display + 18, marginBottom: S.lg },
  emptyTitle: { fontSize: T.size.lg + 1, fontWeight: T.weight.semi, color: C.text, marginBottom: S.xs },
  emptySub: { fontSize: T.size.base, color: C.text3 },
  retryBtn: {
    marginTop: S.lg,
    minWidth: 108,
    height: 40,
    borderRadius: R.pill,
    backgroundColor: C.petrol,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xl,
  },
  retryText: { color: C.white, fontSize: T.size.sm + 1, fontWeight: T.weight.semi },
});
