/**
 * OrderConfirmationScreen — Shown after successful payment
 * Circle-inspired: order ID, item summary, timeline, guarantee
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R, Shadow, formatPrice } from '../../utils/tokens';

export default function OrderConfirmationScreen({ navigation, route }: any) {
  const { transactionId, listing, total } = route.params || {};

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Success animation placeholder */}
        <View style={s.successCircle}>
          <Text style={{ fontSize: 48 }}>✅</Text>
        </View>

        <Text style={s.title}>Order placed!</Text>
        <Text style={s.sub}>Your payment is held safely until you confirm receipt</Text>

        {/* Order ID */}
        <View style={s.idCard}>
          <Text style={s.idLabel}>Order ID</Text>
          <Text style={s.idValue}>{transactionId ? transactionId.slice(0, 8).toUpperCase() : 'PENDING'}</Text>
        </View>

        {/* Item summary */}
        {listing && (
          <View style={s.itemCard}>
            <View style={s.itemThumb}><Text style={{ fontSize: 28 }}>📦</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.itemTitle}>{listing.title}</Text>
              <Text style={s.itemPrice}>{formatPrice(listing.price)}</Text>
            </View>
          </View>
        )}

        {/* What happens next */}
        <View style={s.nextCard}>
          <Text style={s.nextTitle}>What happens next</Text>
          {[
            { step: '1', label: 'Seller prepares item', desc: 'Seller will pack and hand over for pickup', done: false },
            { step: '2', label: 'Item picked up', desc: 'Our logistics partner collects the item', done: false },
            { step: '3', label: 'Quality check', desc: 'Item verified against listing description', done: false },
            { step: '4', label: 'Delivered to you', desc: 'You receive and inspect the item', done: false },
            { step: '5', label: 'Confirm receipt', desc: 'Money released to seller after your confirmation', done: false },
          ].map((item, i) => (
            <View key={i} style={s.stepRow}>
              <View style={[s.stepDot, item.done && { backgroundColor: C.forest }]}>
                <Text style={{ fontSize: 10, color: item.done ? '#fff' : C.text4, fontWeight: '700' }}>{item.step}</Text>
              </View>
              {i < 4 && <View style={s.stepLine} />}
              <View style={s.stepContent}>
                <Text style={s.stepLabel}>{item.label}</Text>
                <Text style={s.stepDesc}>{item.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Guarantee */}
        <View style={s.guarantee}>
          <Text style={{ fontSize: 16 }}>🛡️</Text>
          <Text style={s.guaranteeText}>Protected by Owmee Guarantee — full refund if item doesn't match</Text>
        </View>

        {/* Actions */}
        <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.navigate('MainTabs')}>
          <Text style={s.primaryBtnText}>Continue shopping</Text>
        </TouchableOpacity>

        {transactionId && transactionId !== 'pending' && (
          <TouchableOpacity style={s.secondaryBtn} onPress={() => navigation.replace('TransactionDetail', { transactionId })}>
            <Text style={s.secondaryBtnText}>View order details →</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  scroll: { paddingHorizontal: S.xl, paddingTop: 40, alignItems: 'center' },
  successCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: C.forestLight, alignItems: 'center', justifyContent: 'center', marginBottom: S.xl },
  title: { fontSize: T.size.xl + 2, fontWeight: '800', color: C.ink, marginBottom: S.xs },
  sub: { fontSize: T.size.base, color: C.text3, textAlign: 'center', lineHeight: 19, marginBottom: S.xl },
  idCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', backgroundColor: C.sand, borderRadius: R.sm, paddingHorizontal: 16, paddingVertical: 12, marginBottom: S.lg },
  idLabel: { fontSize: 12, color: C.text3, fontWeight: '600' },
  idValue: { fontSize: 14, fontWeight: '700', color: C.ink, fontFamily: 'monospace', letterSpacing: 1 },
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 14, width: '100%', backgroundColor: C.surface, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: S.xl },
  itemThumb: { width: 56, height: 56, borderRadius: R.sm, backgroundColor: C.sand, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 14, fontWeight: '600', color: C.text },
  itemPrice: { fontSize: 18, fontWeight: '700', color: C.honey, marginTop: 2 },
  nextCard: { width: '100%', backgroundColor: C.surface, borderRadius: R.lg, padding: 20, borderWidth: 1, borderColor: C.border, marginBottom: S.lg },
  nextTitle: { fontSize: 15, fontWeight: '700', color: C.ink, marginBottom: S.lg },
  stepRow: { flexDirection: 'row', position: 'relative', marginBottom: 4 },
  stepDot: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  stepLine: { position: 'absolute', left: 13, top: 28, width: 2, height: 28, backgroundColor: C.border },
  stepContent: { flex: 1, marginLeft: 12, paddingBottom: 18 },
  stepLabel: { fontSize: 13, fontWeight: '600', color: C.text },
  stepDesc: { fontSize: 11, color: C.text3, marginTop: 1 },
  guarantee: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', backgroundColor: C.forestLight, borderRadius: R.sm, paddingHorizontal: 16, paddingVertical: 12, marginBottom: S.xl },
  guaranteeText: { flex: 1, fontSize: 12, color: C.forestText, fontWeight: '500', lineHeight: 17 },
  primaryBtn: { width: '100%', backgroundColor: C.honey, borderRadius: R.sm, paddingVertical: 16, alignItems: 'center', marginBottom: S.sm },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  secondaryBtn: { width: '100%', borderRadius: R.sm, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: C.honey },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: C.honey },
});
