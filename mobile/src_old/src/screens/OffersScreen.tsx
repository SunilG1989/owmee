/**
 * OffersScreen
 *
 * India UX:
 * - Offer note visible ("I can pick up today")
 * - Tiered expiry shown with countdown
 * - Accept / Counter / Reject one-tap from list
 * - Seller ghosting protection: shows deadline for seller to respond
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Alert, ActivityIndicator, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, Radius, Typography } from '../utils/tokens';
import { Offers } from '../services/api';
import type { Offer } from '../services/api';

type Tab = 'received' | 'sent';

function timeLeft(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

function statusColor(status: string) {
  switch (status) {
    case 'pending': return Colors.warning;
    case 'countered': return Colors.teal;
    case 'accepted': return Colors.success;
    case 'rejected': return Colors.error;
    case 'expired': return Colors.text4;
    default: return Colors.text3;
  }
}

export default function OffersScreen({ navigation }: any) {
  const [tab, setTab] = useState<Tab>('received');
  const [offers, setOffers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = tab === 'received'
        ? await Offers.received()
        : await Offers.sent();
      setOffers(res.data.offers || []);
    } catch { setOffers([]); }
    finally { setLoading(false); }
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAccept = async (offer: any) => {
    Alert.alert(
      'Accept offer',
      `Accept ₹${Number(offer.offered_price).toLocaleString('en-IN')} from buyer?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Accept', style: 'default',
          onPress: async () => {
            try {
              const res = await Offers.accept(offer.id);
              const payLink = res.data?.payment_link;
              load();
              if (payLink) {
                // Open Razorpay payment link for buyer
                setTimeout(() => {
                  Alert.alert(
                    'Payment link sent',
                    'The buyer will receive a payment link. Deal is active once payment is confirmed.',
                    [{ text: 'OK' }],
                  );
                }, 500);
              }
            } catch (e: any) {
              Alert.alert('Error', e.response?.data?.detail?.message || 'Could not accept offer');
            }
          },
        },
      ]
    );
  };

  const handleReject = async (offer: any) => {
    try {
      await Offers.reject(offer.id);
      load();
    } catch { /* ignore */ }
  };

  const renderOffer = ({ item }: { item: any }) => {
    const isReceived = tab === 'received';
    const isPending = item.status === 'pending' || item.status === 'countered';

    return (
      <TouchableOpacity
        style={s.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('ListingDetail', { listingId: item.listing_id })}
      >
        {/* Status badge */}
        <View style={s.cardTop}>
          <View style={[s.statusBadge, { backgroundColor: statusColor(item.status) + '22' }]}>
            <Text style={[s.statusText, { color: statusColor(item.status) }]}>
              {item.status.replace('_', ' ')}
            </Text>
          </View>
          {item.expires_at && isPending && (
            <Text style={s.expiry}>{timeLeft(item.expires_at)}</Text>
          )}
        </View>

        {/* Price */}
        <Text style={s.price}>
          ₹{Number(item.offered_price).toLocaleString('en-IN')}
        </Text>
        {item.counter_price && (
          <Text style={s.counterPrice}>
            Counter: ₹{Number(item.counter_price).toLocaleString('en-IN')}
          </Text>
        )}

        {/* Offer note — India UX */}
        {item.offer_note && (
          <View style={s.noteRow}>
            <Text style={s.noteIcon}>💬</Text>
            <Text style={s.noteText} numberOfLines={2}>{item.offer_note}</Text>
          </View>
        )}

        {/* Actions for received pending offers */}
        {isReceived && isPending && (
          <View style={s.actions}>
            <TouchableOpacity
              style={s.rejectBtn}
              onPress={() => handleReject(item)}
            >
              <Text style={s.rejectText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.counterBtn}
              onPress={() => navigation.navigate('ListingDetail', { listingId: item.listing_id })}
            >
              <Text style={s.counterText}>Counter</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.acceptBtn}
              onPress={() => handleAccept(item)}
            >
              <Text style={s.acceptText}>Accept</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Offers</Text>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {(['received', 'sent'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[s.tab, tab === t && s.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'received' ? 'Received' : 'Sent'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.teal} style={{ marginTop: 32 }} />
      ) : offers.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyEmoji}>{tab === 'received' ? '📬' : '📤'}</Text>
          <Text style={s.emptyText}>
            {tab === 'received'
              ? 'No offers received yet.\nWhen buyers make an offer, it will appear here.'
              : 'You haven\'t made any offers yet.\nBrowse listings and make your first offer.'}
          </Text>
          {tab === 'sent' && (
            <TouchableOpacity
              style={s.browseBtn}
              onPress={() => navigation.navigate('Home', undefined)}
            >
              <Text style={s.browseBtnText}>Browse listings →</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={offers}
          keyExtractor={(item) => item.id}
          renderItem={renderOffer}
          contentContainerStyle={s.list}
          onRefresh={load}
          refreshing={loading}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: { padding: Spacing.lg, paddingBottom: Spacing.sm },
  title: { fontSize: Typography.size.xl, fontWeight: '500', color: Colors.text },
  tabs: { flexDirection: 'row', paddingHorizontal: Spacing.lg, marginBottom: Spacing.md },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 1.5, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: Colors.teal },
  tabText: { fontSize: Typography.size.md, color: Colors.text3, fontWeight: '500' },
  tabTextActive: { color: Colors.teal },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 0.5, borderColor: Colors.border,
    padding: Spacing.lg,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full },
  statusText: { fontSize: Typography.size.xs, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  expiry: { fontSize: Typography.size.sm, color: Colors.text3 },
  price: { fontSize: Typography.size.xxl, fontWeight: '500', color: Colors.text, letterSpacing: -0.5 },
  counterPrice: { fontSize: Typography.size.base, color: Colors.teal, marginTop: 2 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: Spacing.sm, backgroundColor: Colors.border2, borderRadius: Radius.sm, padding: 10 },
  noteIcon: { fontSize: 12 },
  noteText: { flex: 1, fontSize: Typography.size.sm, color: Colors.text2, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  rejectBtn: { flex: 1, padding: 10, borderRadius: Radius.md, borderWidth: 0.5, borderColor: Colors.border, alignItems: 'center' },
  rejectText: { fontSize: Typography.size.base, color: Colors.text2, fontWeight: '500' },
  counterBtn: { flex: 1, padding: 10, borderRadius: Radius.md, borderWidth: 0.5, borderColor: Colors.teal, alignItems: 'center' },
  counterText: { fontSize: Typography.size.base, color: Colors.teal, fontWeight: '500' },
  acceptBtn: { flex: 2, padding: 10, borderRadius: Radius.md, backgroundColor: Colors.teal, alignItems: 'center' },
  acceptText: { fontSize: Typography.size.base, color: Colors.white, fontWeight: '500' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyEmoji: { fontSize: 40, marginBottom: 16 },
  emptyText: { fontSize: Typography.size.md, color: Colors.text3, textAlign: 'center', lineHeight: 22 },
  browseBtn: { marginTop: 20, backgroundColor: Colors.teal, borderRadius: Radius.md, paddingHorizontal: 24, paddingVertical: 12 },
  browseBtnText: { color: Colors.white, fontWeight: '500', fontSize: Typography.size.md },
});
