import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, Shadow, formatPrice, timeAgo } from '../../utils/tokens';
import { Transactions, type Transaction } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

const STATUS_COLORS: Record<string, string> = {
  reserved: C.honey, meetup_scheduled: C.honey, payment_confirmed: C.forest,
  completed: C.forest, cancelled: C.red, disputed: C.red,
};

export default function TransactionListScreen({ navigation }: any) {
  const { userId } = useAuthStore();
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'buying'|'selling'|'completed'>('buying');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await Transactions.list();
      setTxns(res.data?.transactions || res.data || []);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, []));

  const renderItem = ({ item }: { item: Transaction }) => {
    const isBuyer = item.buyer_id === userId;
    const dotColor = STATUS_COLORS[item.status] || C.text4;
    return (
      <TouchableOpacity style={s.card} onPress={() => navigation.navigate('TransactionDetail', { transactionId: item.id })} activeOpacity={0.85}>
        <View style={s.iconWrap}><Text style={{ fontSize: 24 }}>🤝</Text></View>
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

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={{ fontSize: 20, color: C.text2 }}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Transactions</Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={{flexDirection:'row',marginBottom:12,gap:8}}>
          {(['buying','selling','completed'] as const).map(tab => (
            <TouchableOpacity key={tab} style={{flex:1,paddingVertical:10,borderRadius:R.sm,backgroundColor:activeTab===tab?C.honey:C.surface,borderWidth:activeTab===tab?0:0.5,borderColor:C.border,alignItems:'center'}} onPress={()=>setActiveTab(tab)}>
              <Text style={{fontSize:12,fontWeight:'600',color:activeTab===tab?'#fff':C.text3,textTransform:'capitalize'}}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <FlatList
        data={txns.filter(t => activeTab==='buying' ? t.buyer_id===userId : activeTab==='selling' ? t.seller_id===userId : t.status==='completed')}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.honey} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>🤝</Text>
            <Text style={s.emptyTitle}>No transactions yet</Text>
            <Text style={s.emptySub}>Your deals will appear here</Text>
          </View>
        }
        removeClippedSubviews maxToRenderPerBatch={8} windowSize={5}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  list: { padding: 16 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: R.lg, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  iconWrap: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.honeyLight, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, marginLeft: 12 },
  title: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 2 },
  price: { fontSize: 16, fontWeight: '700', color: C.honey, marginBottom: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  status: { fontSize: 11, color: C.text3, textTransform: 'capitalize' },
  role: { fontSize: 11, color: C.text3 },
  time: { fontSize: 10, color: C.text4 },
  arrow: { fontSize: 20, color: C.text4 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text, marginBottom: 4 },
  emptySub: { fontSize: 13, color: C.text3 },
});
