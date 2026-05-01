/**
 * TransactionDetailScreen — Sprint 6c rewrite
 *
 * Replaces the old meetup-based UI. The new model is fully managed
 * logistics: buyer pays → FE picks up + inspects → item at Owmee hub
 * → admin routes (FE delivery or courier) → delivered → buyer
 * confirms receipt OR auto-completes after 48h.
 *
 * Key UI differences from the prior version:
 *   - 5-step timeline driven by /v1/transactions/{id}/tracking
 *   - When delivery_in_progress + FE delivery + buyer: show the
 *     6-digit handover ack code prominently. Sellers don't see it.
 *   - Courier mode: clickable tracking URL passed straight through
 *   - "Confirm receipt" button only after delivered
 *   - All "meet in a public place" / safety-tip copy removed
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, Linking, TextInput, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, formatPrice } from '../utils/tokens';
import type { RootScreen } from '../navigation/types';
import { Transactions, type TrackingResponse, type Transaction } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { parseApiError } from '../utils/errors';

export default function TransactionDetailScreen({ navigation, route }: RootScreen<'TransactionDetail'>) {
  const { transactionId } = route.params;
  const { userId } = useAuthStore();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [tracking, setTracking] = useState<TrackingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [showRate, setShowRate] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingNote, setRatingNote] = useState('');

  const reload = useCallback(async () => {
    try {
      const [tRes, tk] = await Promise.all([
        Transactions.get(transactionId),
        Transactions.tracking(transactionId),
      ]);
      setTxn(tRes.data);
      setTracking(tk.data);
    } catch {
      // Silent here so the screen still mounts; followup will surface real errors
    } finally {
      setLoading(false);
    }
  }, [transactionId]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  if (loading) {
    return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;
  }
  if (!txn || !tracking) {
    return (
      <SafeAreaView style={s.safe}>
        <Text style={{ textAlign: 'center', marginTop: 60, color: C.text3 }}>
          We couldn't load this transaction.
        </Text>
      </SafeAreaView>
    );
  }

  const isBuyer = txn.buyer_id === userId;
  const status = tracking.status;
  const isDelivered = status === 'delivered';
  const isCompleted = status === 'completed';
  const isDisputed = status === 'disputed';
  const isCancelled = status === 'cancelled' || status === 'pickup_rejected';

  const showAckCode = isBuyer && tracking.ack_code && status === 'delivery_in_progress' && tracking.delivery_mode === 'fe';

  const doAction = async (action: () => Promise<unknown>, successMsg: string) => {
    setActing(true);
    try {
      await action();
      Alert.alert('Done', successMsg);
      await reload();
    } catch (e) {
      Alert.alert('Error', parseApiError(e, 'Action failed'));
    } finally {
      setActing(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>Order tracking</Text>
        </View>

        <View style={[s.banner, isCompleted && s.bannerOK, isDisputed && s.bannerWarn, isCancelled && s.bannerErr]}>
          <Text style={s.bannerText}>{labelForStatus(status, isBuyer)}</Text>
        </View>

        {showAckCode && (
          <View style={s.ackBox}>
            <Text style={s.ackLabel}>Your handover code</Text>
            <Text style={s.ackCode}>{tracking.ack_code}</Text>
            <Text style={s.ackHint}>Read this to the Owmee FE when they hand over your item. Don't share it earlier.</Text>
          </View>
        )}

        {tracking.delivery_mode === 'courier' && tracking.courier_tracking_url && (
          <TouchableOpacity
            style={s.courierBox}
            onPress={() => Linking.openURL(tracking.courier_tracking_url!).catch(() => {})}
          >
            <Text style={s.courierText}>Track via {tracking.courier_name || 'courier'} →</Text>
          </TouchableOpacity>
        )}

        <View style={s.timeline}>
          {tracking.timeline.map((step, i) => (
            <View key={step.step} style={s.tlRow}>
              <View style={s.tlGutter}>
                <View style={[s.tlDot, step.done && s.tlDotDone]}>
                  {step.done && <Text style={s.tlTick}>✓</Text>}
                </View>
                {i < tracking.timeline.length - 1 && (
                  <View style={[s.tlBar, step.done && s.tlBarDone]} />
                )}
              </View>
              <View style={s.tlBody}>
                <Text style={[s.tlLabel, step.done && s.tlLabelDone]}>{step.label}</Text>
                {step.at && (
                  <Text style={s.tlAt}>{new Date(step.at).toLocaleString('en-IN', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}</Text>
                )}
              </View>
            </View>
          ))}
        </View>

        <View style={s.priceBox}>
          <Row label="Item price" value={formatPrice(Number(txn.gross_amount) - Number((txn as any).delivery_fee || 0))} />
          {Number((txn as any).delivery_fee || 0) > 0 && (
            <Row label="Delivery fee" value={formatPrice(Number((txn as any).delivery_fee))} />
          )}
          <Row label="You paid" value={formatPrice(Number(txn.gross_amount))} bold />
        </View>

        {isDelivered && isBuyer && (
          <View style={s.actions}>
            <TouchableOpacity
              style={[s.btnPrimary, acting && s.btnDisabled]}
              disabled={acting}
              onPress={() => doAction(
                () => Transactions.confirmDeal(transactionId),
                'Receipt confirmed. Thanks!',
              )}
            >
              <Text style={s.btnPrimaryText}>Confirm receipt</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnSecondary} onPress={() => Alert.alert(
              'Open a dispute?',
              'Use this only if the item is not what was listed. We\'ll review and refund if applicable.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Email support', onPress: () => Linking.openURL('mailto:support@owmee.in?subject=Dispute%20-%20order%20' + transactionId) },
              ],
            )}>
              <Text style={s.btnSecondaryText}>Something's wrong</Text>
            </TouchableOpacity>
          </View>
        )}

        {isCompleted && !isDisputed && (
          <View style={s.actions}>
            <TouchableOpacity style={s.btnPrimary} onPress={() => setShowRate(true)}>
              <Text style={s.btnPrimaryText}>Rate this transaction</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <Modal visible={showRate} animationType="slide" transparent onRequestClose={() => setShowRate(false)}>
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>How did this go?</Text>
            <View style={s.starsRow}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setRating(n)}>
                  <Text style={[s.star, n <= rating && s.starOn]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={s.input}
              placeholder="Add a note (optional)"
              placeholderTextColor={C.text4}
              value={ratingNote}
              onChangeText={setRatingNote}
              multiline
            />
            <TouchableOpacity
              style={[s.btnPrimary, rating === 0 && s.btnDisabled]}
              disabled={rating === 0 || acting}
              onPress={() => {
                setShowRate(false);
                doAction(
                  () => Transactions.rate(transactionId, rating, true, ratingNote || undefined),
                  'Thanks for rating!',
                );
              }}
            >
              <Text style={s.btnPrimaryText}>Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={s.priceRow}>
      <Text style={[s.priceLabel, bold && { fontWeight: '700', color: C.text }]}>{label}</Text>
      <Text style={[s.priceValue, bold && { fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

function labelForStatus(status: string, isBuyer: boolean): string {
  switch (status) {
    case 'payment_pending': return 'Waiting for payment to clear.';
    case 'payment_captured': return isBuyer
      ? 'Payment received. An Owmee FE will pick up and inspect the item soon.'
      : 'Buyer paid. An Owmee FE will collect the item shortly.';
    case 'at_hub': return 'Item is at the Owmee hub. Out for delivery soon.';
    case 'delivery_in_progress': return isBuyer ? 'On the way to you.' : 'On the way to the buyer.';
    case 'delivered': return isBuyer ? 'Delivered. Confirm receipt to release payout.' : 'Delivered to buyer. Awaiting confirmation.';
    case 'completed': return 'Transaction complete. Thanks!';
    case 'disputed': return 'A dispute was raised. Our team will review.';
    case 'pickup_rejected': return 'Pickup rejected — item didn\'t match listing. Refund processing.';
    case 'cancelled': return 'This transaction was cancelled.';
    default: return status;
  }
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  header: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { fontSize: 14, color: C.text3 },
  title: { fontSize: 18, fontWeight: '700', color: C.text },

  banner: { marginHorizontal: 16, padding: 16, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  bannerOK: { backgroundColor: '#dcfce7' },
  bannerWarn: { backgroundColor: '#fef3c7' },
  bannerErr: { backgroundColor: '#fee2e2' },
  bannerText: { fontSize: 14, color: C.text, lineHeight: 20 },

  ackBox: { margin: 16, padding: 20, borderRadius: 12, backgroundColor: '#fef3c7', borderWidth: 2, borderColor: C.honey, alignItems: 'center' },
  ackLabel: { fontSize: 12, color: C.text3, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  ackCode: { fontSize: 36, fontWeight: '800', color: C.text, letterSpacing: 8 },
  ackHint: { fontSize: 12, color: C.text3, marginTop: 8, textAlign: 'center', lineHeight: 18 },

  courierBox: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: C.honey },
  courierText: { fontSize: 14, color: C.honey, fontWeight: '600', textAlign: 'center' },

  timeline: { paddingHorizontal: 24, paddingVertical: 16 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start' },
  tlGutter: { width: 18, alignItems: 'center' },
  tlDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.text4, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  tlDotDone: { backgroundColor: C.honey, borderColor: C.honey },
  tlTick: { fontSize: 11, color: '#fff', fontWeight: '700' },
  tlBar: { flex: 1, width: 2, backgroundColor: C.text4, marginTop: 2 },
  tlBarDone: { backgroundColor: C.honey },
  tlBody: { flex: 1, marginLeft: 12, paddingBottom: 20 },
  tlLabel: { fontSize: 14, color: C.text3 },
  tlLabelDone: { color: C.text, fontWeight: '600' },
  tlAt: { fontSize: 11, color: C.text4, marginTop: 2 },

  priceBox: { margin: 16, padding: 16, backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  priceLabel: { fontSize: 13, color: C.text3 },
  priceValue: { fontSize: 13, color: C.text },

  actions: { paddingHorizontal: 16, gap: 12 },
  btnPrimary: { backgroundColor: C.honey, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnSecondary: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnSecondaryText: { color: C.text3, fontSize: 14 },
  btnDisabled: { opacity: 0.5 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: C.cream, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
  star: { fontSize: 36, color: C.text4 },
  starOn: { color: C.honey },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, marginBottom: 16, color: C.text, minHeight: 80, textAlignVertical: 'top' },
});
