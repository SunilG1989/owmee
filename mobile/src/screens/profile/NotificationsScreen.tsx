import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, timeAgo } from '../../utils/tokens';
import { Notifications } from '../../services/api';

interface NotifItem {
  id: string; type: string; title: string; body: string;
  entity_type?: string; entity_id?: string;
  is_read: boolean; created_at: string;
}

const ICON_MAP: Record<string, string> = {
  offer_received: '💰', offer_accepted: '✅', offer_rejected: '❌', offer_countered: '🔄',
  transaction_created: '🤝', payment_confirmed: '💳', deal_completed: '🎉',
  kyc_verified: '🛡️', listing_published: '📦',
};

export default function NotificationsScreen({ navigation }: any) {
  const [items, setItems] = useState<NotifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await Notifications.list();
      setItems(res.data?.notifications || []);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, []));

  const handleTap = async (item: NotifItem) => {
    // Mark as read
    if (!item.is_read) {
      try { await Notifications.markRead(item.id); } catch {}
      setItems(prev => prev.map(n => n.id === item.id ? { ...n, is_read: true } : n));
    }
    // Navigate based on entity type
    if (item.entity_type === 'listing' && item.entity_id) {
      navigation.navigate('ListingDetail', { listingId: item.entity_id });
    } else if (item.entity_type === 'transaction' && item.entity_id) {
      navigation.navigate('TransactionDetail', { transactionId: item.entity_id });
    }
  };

  const renderItem = ({ item }: { item: NotifItem }) => (
    <TouchableOpacity style={[s.card, !item.is_read && s.unread]} onPress={() => handleTap(item)} activeOpacity={0.85}>
      <View style={s.iconWrap}><Text style={{ fontSize: 20 }}>{ICON_MAP[item.type] || '🔔'}</Text></View>
      <View style={s.content}>
        <Text style={[s.title, !item.is_read && { fontWeight: '700' }]}>{item.title}</Text>
        <Text style={s.body} numberOfLines={2}>{item.body}</Text>
        <Text style={s.time}>{timeAgo(item.created_at)}</Text>
      </View>
      {!item.is_read && <View style={s.unreadDot} />}
    </TouchableOpacity>
  );

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={{ fontSize: 20, color: C.text2 }}>←</Text></TouchableOpacity>
        <Text style={s.headerTitle}>Notifications</Text>
        <View style={{ width: 24 }} />
      </View>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.honey} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>🔔</Text>
            <Text style={s.emptyTitle}>No notifications</Text>
            <Text style={s.emptySub}>You'll see offers, updates, and alerts here</Text>
          </View>
        }
        removeClippedSubviews maxToRenderPerBatch={10} windowSize={7}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  headerTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  list: { padding: 16 },
  card: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, marginBottom: 8, backgroundColor: C.surface, borderRadius: R.lg, borderWidth: 0.5, borderColor: C.border },
  unread: { backgroundColor: C.honeyLight, borderColor: C.honey },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.sand, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  content: { flex: 1 },
  title: { fontSize: 14, fontWeight: '500', color: C.text, marginBottom: 2 },
  body: { fontSize: 12, color: C.text3, lineHeight: 17, marginBottom: 4 },
  time: { fontSize: 10, color: C.text4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.honey, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: C.text, marginBottom: 4 },
  emptySub: { fontSize: 13, color: C.text3, textAlign: 'center' },
});
