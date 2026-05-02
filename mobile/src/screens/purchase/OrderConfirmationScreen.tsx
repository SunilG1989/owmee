/**
 * OrderConfirmationScreen — Shown after successful payment
 * Circle-inspired: order ID, item summary, timeline, guarantee
 */
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, T, S, R, formatPrice } from '../../utils/tokens';
import { Button } from '../../components/ui';

const TIMELINE = [
  { step: '1', label: 'Seller prepares item', desc: 'Seller will pack and hand over for pickup' },
  { step: '2', label: 'Item picked up', desc: 'Our logistics partner collects the item' },
  { step: '3', label: 'Quality check', desc: 'Item verified against listing description' },
  { step: '4', label: 'Delivered to you', desc: 'You receive and inspect the item' },
  { step: '5', label: 'Confirm receipt', desc: 'Money released to seller after your confirmation' },
];

export default function OrderConfirmationScreen({ navigation, route }: any) {
  const { transactionId, listing } = route.params || {};

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.successCircle}>
          <Text style={s.successEmoji}>✅</Text>
        </View>

        <Text style={s.title}>Order placed!</Text>
        <Text style={s.sub}>Your payment is held safely until you confirm receipt</Text>

        <View style={s.idCard}>
          <Text style={s.idLabel}>Order ID</Text>
          <Text style={s.idValue}>
            {transactionId ? transactionId.slice(0, 8).toUpperCase() : 'PENDING'}
          </Text>
        </View>

        {listing && (
          <View style={s.itemCard}>
            <View style={s.itemThumb}>
              <Text style={s.itemThumbEmoji}>📦</Text>
            </View>
            <View style={s.flex1}>
              <Text style={s.itemTitle}>{listing.title}</Text>
              <Text style={s.itemPrice}>{formatPrice(listing.price)}</Text>
            </View>
          </View>
        )}

        <View style={s.nextCard}>
          <Text style={s.nextTitle}>What happens next</Text>
          {TIMELINE.map((item, i) => (
            <View key={i} style={s.stepRow}>
              <View style={s.stepDot}>
                <Text style={s.stepNum}>{item.step}</Text>
              </View>
              {i < TIMELINE.length - 1 && <View style={s.stepLine} />}
              <View style={s.stepContent}>
                <Text style={s.stepLabel}>{item.label}</Text>
                <Text style={s.stepDesc}>{item.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={s.guarantee}>
          <Text style={s.guaranteeIcon}>🛡️</Text>
          <Text style={s.guaranteeText}>
            Protected by Owmee Guarantee — full refund if item doesn't match
          </Text>
        </View>

        <Button
          label="Continue shopping"
          variant="primary"
          size="lg"
          onPress={() => navigation.navigate('MainTabs')}
          fullWidth
          style={s.primaryBtn}
        />

        {transactionId && transactionId !== 'pending' && (
          <Button
            label="View order details →"
            variant="secondary"
            onPress={() => navigation.replace('TransactionDetail', { transactionId })}
            fullWidth
          />
        )}

        <View style={s.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  flex1: { flex: 1 },

  scroll: { paddingHorizontal: S.xl, paddingTop: S.xxxl, alignItems: 'center' },
  successCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: C.petrolLight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: S.xl,
  },
  successEmoji: { fontSize: T.size.display + 18 },                  // 48
  title: {
    fontSize: T.size.xl + 2,
    fontWeight: T.weight.heavy,
    color: C.ink,
    marginBottom: S.xs,
  },
  sub: { fontSize: T.size.base, color: C.text3, textAlign: 'center', lineHeight: 19, marginBottom: S.xl },

  idCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    width: '100%', backgroundColor: C.bone2, borderRadius: R.sm,
    paddingHorizontal: S.lg, paddingVertical: S.md,
    marginBottom: S.lg,
  },
  idLabel: { fontSize: T.size.sm, color: C.text3, fontWeight: T.weight.semi },
  idValue: { fontSize: T.size.sm + 1, fontWeight: T.weight.bold, color: C.ink, fontFamily: 'monospace', letterSpacing: 1 },

  itemCard: {
    flexDirection: 'row', alignItems: 'center', gap: S.md + 2,
    width: '100%', backgroundColor: C.surface, borderRadius: R.lg,
    padding: S.lg,
    borderWidth: 1, borderColor: C.border,
    marginBottom: S.xl,
  },
  itemThumb: {
    width: 56, height: 56, borderRadius: R.sm,
    backgroundColor: C.bone2,
    alignItems: 'center', justifyContent: 'center',
  },
  itemThumbEmoji: { fontSize: T.size.xxl + 4 },                     // 28
  itemTitle: { fontSize: T.size.sm + 1, fontWeight: T.weight.semi, color: C.text },
  itemPrice: { fontSize: T.size.lg + 1, fontWeight: T.weight.bold, color: C.petrol, marginTop: 2 },

  nextCard: {
    width: '100%', backgroundColor: C.surface, borderRadius: R.lg,
    padding: S.xl,
    borderWidth: 1, borderColor: C.border,
    marginBottom: S.lg,
  },
  nextTitle: { fontSize: T.size.md, fontWeight: T.weight.bold, color: C.ink, marginBottom: S.lg },
  stepRow: { flexDirection: 'row', position: 'relative', marginBottom: S.xs },
  stepDot: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.border,
    alignItems: 'center', justifyContent: 'center',
    zIndex: 1,
  },
  stepNum: { fontSize: T.size.xs, color: C.text4, fontWeight: T.weight.bold },
  stepLine: { position: 'absolute', left: 13, top: 28, width: 2, height: 28, backgroundColor: C.border },
  stepContent: { flex: 1, marginLeft: S.md, paddingBottom: S.lg + 2 },
  stepLabel: { fontSize: T.size.base, fontWeight: T.weight.semi, color: C.text },
  stepDesc: { fontSize: T.size.sm, color: C.text3, marginTop: 1 },

  guarantee: {
    flexDirection: 'row', alignItems: 'center', gap: S.sm + 2,
    width: '100%', backgroundColor: C.petrolLight, borderRadius: R.sm,
    paddingHorizontal: S.lg, paddingVertical: S.md,
    marginBottom: S.xl,
  },
  guaranteeIcon: { fontSize: T.size.lg - 1 },
  guaranteeText: { flex: 1, fontSize: T.size.sm, color: C.petrolText, fontWeight: T.weight.medium, lineHeight: 17 },

  primaryBtn: { marginBottom: S.sm },
  bottomSpacer: { height: 40 },
});
