import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, formatPrice, timeAgo } from '../utils/tokens';
import type { RootScreen } from '../navigation/types';
import { Transactions, Disputes, type Transaction } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { parseApiError } from '../utils/errors';

const STEPS = ['Reserved', 'Meetup scheduled', 'Payment confirmed', 'Completed'];
const SAFE_TIPS = [
  '📍 Meet in a busy public place — café, mall, metro station',
  '☀️ Go during daytime if possible',
  '🔍 Test the item thoroughly before confirming',
  '🔒 Do not share OTPs or UPI PINs with anyone',
  '📱 Keep the conversation inside the app',
];

export default function TransactionDetailScreen({ navigation, route }: RootScreen<'TransactionDetail'>) {
  const { transactionId } = route.params;
  const { userId } = useAuthStore();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [rating, setRating] = useState(0);
  const [ratingNote, setRatingNote] = useState('');
  const [showRate, setShowRate] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  const reload = useCallback(async () => {
    try { const r = await Transactions.get(transactionId); setTxn(r.data); }
    catch {} finally { setLoading(false); }
  }, [transactionId]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;
  if (!txn) return <SafeAreaView style={s.safe}><Text style={{ textAlign: 'center', marginTop: 60, color: C.text3 }}>Not found</Text></SafeAreaView>;

  const isBuyer = txn.buyer_id === userId;
  const isSeller = txn.seller_id === userId;
  const status = txn.status;
  const stepIdx = status === 'reserved' ? 0 : status === 'meetup_scheduled' ? 1 : status === 'payment_confirmed' ? 2 : status === 'completed' ? 3 : status === 'cancelled' ? -1 : 1;

  const canConfirmMeetup = status === 'reserved' && isBuyer;
  const canConfirmDeal = status === 'meetup_scheduled' || status === 'payment_confirmed';
  const canCancelAtMeetup = (status === 'meetup_scheduled' || status === 'payment_confirmed') && isBuyer;
  const canDispute = status === 'completed' && isBuyer;
  const canRate = status === 'completed';
  const isCancelled = status === 'cancelled';
  const isDisputed = status === 'disputed';

  const doAction = async (action: () => Promise<any>, successMsg: string) => {
    setActing(true);
    try {
      await action();
      Alert.alert('Done', successMsg);
      await reload();
    } catch (e: any) {
      Alert.alert('Error', parseApiError(e, 'Action failed'));
    } finally { setActing(false); }
  };

  const nextStepMessage = () => {
    if (isCancelled) return 'This transaction was cancelled.';
    if (isDisputed) return 'A dispute has been raised. Our team will review and respond.';
    switch (status) {
      case 'reserved': return isBuyer
        ? 'Confirm a meetup time and place. You have 48 hours before the reservation expires.'
        : 'Waiting for the buyer to confirm meetup. You\'ll be notified.';
      case 'meetup_scheduled': return isBuyer
        ? 'Meet the seller, inspect the item carefully. If it matches the listing, confirm the deal.'
        : 'Meet the buyer at the agreed time. They\'ll confirm once they\'ve inspected the item.';
      case 'payment_confirmed': return 'Payment confirmed. Both parties should confirm the exchange is complete.';
      case 'completed': return 'Transaction complete! Please rate your experience.';
      default: return '';
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.top}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontSize: 20, color: C.text2 }}>←</Text>
        </TouchableOpacity>
        <Text style={s.topT}>Transaction</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>{txn.listing_title || 'Deal'}</Text>
        <Text style={s.price}>{formatPrice(txn.amount)}</Text>
        <View style={s.roleRow}>
          <View style={[s.roleBadge, isBuyer ? { backgroundColor: C.honeyLight } : { backgroundColor: C.forestLight }]}>
            <Text style={[s.roleText, isBuyer ? { color: C.honeyDeep } : { color: C.forest }]}>
              {isBuyer ? '🛒 Buyer' : '📦 Seller'}
            </Text>
          </View>
          {txn.created_at && <Text style={s.timeText}>{timeAgo(txn.created_at)}</Text>}
        </View>

        {/* Status banner for cancelled/disputed */}
        {isCancelled && (
          <View style={[s.statusBanner, { backgroundColor: C.redLight, borderColor: C.red }]}>
            <Text style={{ fontSize: 16 }}>❌</Text>
            <Text style={[s.statusBannerText, { color: C.red }]}>Transaction cancelled</Text>
          </View>
        )}
        {isDisputed && (
          <View style={[s.statusBanner, { backgroundColor: C.yellowLight, borderColor: C.yellow }]}>
            <Text style={{ fontSize: 16 }}>⚠️</Text>
            <Text style={[s.statusBannerText, { color: C.yellow }]}>Dispute in progress</Text>
          </View>
        )}

        {/* Timeline */}
        <View style={s.timeline}>
          {STEPS.map((l, i) => (
            <View key={i} style={s.step}>
              <View style={s.stepL}>
                <View style={[s.stepDot, i <= stepIdx && { backgroundColor: C.forest }, isCancelled && { backgroundColor: C.red }]}>
                  {i <= stepIdx && !isCancelled && <Text style={{ fontSize: 10, color: '#fff' }}>✓</Text>}
                  {isCancelled && i === 0 && <Text style={{ fontSize: 10, color: '#fff' }}>✕</Text>}
                </View>
                {i < STEPS.length - 1 && <View style={[s.stepLine, i < stepIdx && { backgroundColor: C.forest }]} />}
              </View>
              <Text style={[s.stepLabel, i <= stepIdx && { color: C.forest, fontWeight: '600' }]}>{l}</Text>
            </View>
          ))}
        </View>

        {/* What happens next */}
        <View style={s.nextCard}>
          <Text style={s.nextT}>What happens next</Text>
          <Text style={s.nextD}>{nextStepMessage()}</Text>
        </View>

        {/* Payment info */}
        {(txn as any).payment_link && (
          <View style={s.infoCard}>
            <Text style={s.infoLabel}>Payment</Text>
            <Text style={s.infoValue}>
              {(txn as any).payment_link_status === 'paid' ? '✅ Paid via UPI' : '⏳ Payment pending'}
            </Text>
          </View>
        )}

        {/* Meetup details */}
        {(txn as any).meetup_time && (
          <View style={s.infoCard}>
            <Text style={s.infoLabel}>Meetup</Text>
            <Text style={s.infoValue}>{(txn as any).meetup_time}</Text>
            {(txn as any).meetup_location && <Text style={s.infoSub}>📍 {(txn as any).meetup_location}</Text>}
          </View>
        )}

        {/* Safe meetup tips — show during active transaction */}
        {!isCancelled && !isDisputed && status !== 'completed' && (
          <View style={s.tipsCard}>
            <Text style={s.tipsTitle}>🛡️ Safe meetup tips</Text>
            {SAFE_TIPS.map((tip, i) => (
              <Text key={i} style={s.tipText}>{tip}</Text>
            ))}
          </View>
        )}

        {/* ── ACTION BUTTONS ── */}

        {/* P0: Confirm meetup (buyer, reserved) */}
        {canConfirmMeetup && (
          <TouchableOpacity style={s.primaryBtn} disabled={acting}
            onPress={() => doAction(() => Transactions.confirmMeetup(transactionId), 'Meetup confirmed! Meet the seller to inspect the item.')}>
            <Text style={s.primaryBtnText}>{acting ? 'Confirming...' : 'Confirm meetup →'}</Text>
          </TouchableOpacity>
        )}

        {/* P0: Confirm deal (buyer or seller, after meetup) */}
        {canConfirmDeal && (
          <TouchableOpacity style={s.primaryBtn} disabled={acting}
            onPress={() => Alert.alert(
              'Confirm deal',
              'Are you sure the item matches the listing and you want to complete this transaction?',
              [
                { text: 'Not yet', style: 'cancel' },
                { text: 'Yes, confirm', onPress: () => doAction(() => Transactions.confirmDeal(transactionId), 'Deal confirmed!') },
              ]
            )}>
            <Text style={s.primaryBtnText}>✅ Item verified — confirm deal</Text>
          </TouchableOpacity>
        )}

        {/* P0: Cancel at meetup (buyer) */}
        {canCancelAtMeetup && (
          <TouchableOpacity style={s.dangerBtn} onPress={() => setShowCancel(true)}>
            <Text style={s.dangerBtnText}>❌ Item doesn't match — cancel</Text>
          </TouchableOpacity>
        )}

        {/* P1: Dispute (buyer, after completion) */}
        {canDispute && (
          <TouchableOpacity style={s.outlineBtn} onPress={() => setShowDispute(true)}>
            <Text style={s.outlineBtnText}>⚠️ Raise a dispute</Text>
          </TouchableOpacity>
        )}

        {/* Rate (after completion) */}
        {canRate && !showRate && (
          <TouchableOpacity style={[s.primaryBtn, { backgroundColor: C.ink }]} onPress={() => setShowRate(true)}>
            <Text style={s.primaryBtnText}>⭐ Rate this deal</Text>
          </TouchableOpacity>
        )}

        {showRate && (
          <View style={s.rateCard}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: C.text, marginBottom: 8 }}>How was your experience?</Text>
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: 12 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setRating(n)}>
                  <Text style={{ fontSize: 32, color: n <= rating ? C.honey : C.border }}>{n <= rating ? '★' : '☆'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={s.textInput} placeholder="Comments (optional)" placeholderTextColor={C.text4}
              value={ratingNote} onChangeText={setRatingNote} multiline />
            <TouchableOpacity style={[s.primaryBtn, { marginTop: 12 }]} disabled={rating === 0 || acting}
              onPress={() => doAction(
                () => Transactions.rate(transactionId, rating, true, ratingNote || undefined),
                'Thank you for your feedback!'
              ).then(() => setShowRate(false))}>
              <Text style={s.primaryBtnText}>{acting ? 'Submitting...' : 'Submit rating'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Cancel at meetup modal */}
      <Modal visible={showCancel} transparent animationType="slide">
        <View style={s.modalBg}><View style={s.modal}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: C.text }}>Cancel at meetup</Text>
          <Text style={{ fontSize: 13, color: C.text3, marginTop: 4, lineHeight: 18 }}>
            Tell us what happened. The seller will be notified and your reservation will be released.
          </Text>
          <TextInput style={[s.textInput, { marginTop: 16, minHeight: 80 }]}
            placeholder="e.g. Item condition doesn't match listing, wrong item, seller didn't show up..."
            placeholderTextColor={C.text4} value={cancelReason} onChangeText={setCancelReason} multiline textAlignVertical="top" autoFocus />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <TouchableOpacity style={s.modalCancelBtn} onPress={() => setShowCancel(false)}>
              <Text style={{ fontSize: 14, color: C.text3 }}>Go back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.dangerBtn, { flex: 2 }]} disabled={!cancelReason.trim() || acting}
              onPress={() => {
                setShowCancel(false);
                doAction(
                  () => Transactions.cancelAtMeetup(transactionId, cancelReason),
                  'Transaction cancelled. Your refund will be processed.'
                );
              }}>
              <Text style={s.dangerBtnText}>{acting ? 'Cancelling...' : 'Cancel transaction'}</Text>
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* Dispute modal */}
      <Modal visible={showDispute} transparent animationType="slide">
        <View style={s.modalBg}><View style={s.modal}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: C.text }}>Raise a dispute</Text>
          <Text style={{ fontSize: 13, color: C.text3, marginTop: 4, lineHeight: 18 }}>
            Describe the issue. Our team will review within 48 hours. Evidence from chat and listing will be preserved.
          </Text>
          <TextInput style={[s.textInput, { marginTop: 16, minHeight: 80 }]}
            placeholder="e.g. Item materially different from listing, missing accessories, damaged..."
            placeholderTextColor={C.text4} value={disputeReason} onChangeText={setDisputeReason} multiline textAlignVertical="top" autoFocus />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <TouchableOpacity style={s.modalCancelBtn} onPress={() => setShowDispute(false)}>
              <Text style={{ fontSize: 14, color: C.text3 }}>Go back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primaryBtn, { flex: 2, backgroundColor: C.red }]} disabled={!disputeReason.trim() || acting}
              onPress={() => {
                setShowDispute(false);
                doAction(
                  () => Disputes.raise(transactionId, 'item_mismatch', disputeReason),
                  'Dispute raised. Our team will review within 48 hours.'
                );
              }}>
              <Text style={s.primaryBtnText}>{acting ? 'Submitting...' : 'Submit dispute'}</Text>
            </TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border },
  topT: { fontSize: 16, fontWeight: '600', color: C.text },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 20 },
  title: { fontSize: 18, fontWeight: '700', color: C.text },
  price: { fontSize: 24, fontWeight: '800', color: C.honey, marginTop: 4 },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 20 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 12, fontWeight: '700' },
  timeText: { fontSize: 11, color: C.text4 },
  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: R.sm, borderWidth: 1, marginBottom: 16 },
  statusBannerText: { fontSize: 14, fontWeight: '600' },
  timeline: { marginBottom: 20 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepL: { alignItems: 'center' },
  stepDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.border, alignItems: 'center', justifyContent: 'center' },
  stepLine: { width: 2, height: 24, backgroundColor: C.border },
  stepLabel: { fontSize: 13, color: C.text3, paddingTop: 6 },
  nextCard: { backgroundColor: C.surface, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.border, marginBottom: 12 },
  nextT: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 4 },
  nextD: { fontSize: 13, color: C.text3, lineHeight: 19 },
  infoCard: { backgroundColor: C.surface, borderRadius: R.sm, padding: 14, borderWidth: 0.5, borderColor: C.border, marginBottom: 10 },
  infoLabel: { fontSize: 10, fontWeight: '700', color: C.text4, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: 14, fontWeight: '600', color: C.text, marginTop: 4 },
  infoSub: { fontSize: 12, color: C.text3, marginTop: 2 },
  tipsCard: { backgroundColor: C.forestLight, borderRadius: R.lg, padding: 16, marginBottom: 16 },
  tipsTitle: { fontSize: 14, fontWeight: '700', color: C.forest, marginBottom: 10 },
  tipText: { fontSize: 12, color: C.forestText, lineHeight: 20, marginBottom: 2 },
  primaryBtn: { backgroundColor: C.honey, borderRadius: R.sm, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  primaryBtnText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  dangerBtn: { backgroundColor: C.redLight, borderRadius: R.sm, paddingVertical: 14, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: C.red },
  dangerBtnText: { fontSize: 14, color: C.red, fontWeight: '600' },
  outlineBtn: { borderRadius: R.sm, paddingVertical: 14, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: C.honey },
  outlineBtnText: { fontSize: 14, color: C.honey, fontWeight: '600' },
  rateCard: { backgroundColor: C.surface, borderRadius: R.lg, padding: 16, borderWidth: 1, borderColor: C.border, marginTop: 12 },
  textInput: { borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.text, backgroundColor: C.cream },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: S.xl, paddingBottom: 40 },
  modalCancelBtn: { flex: 1, borderRadius: R.sm, paddingVertical: 12, alignItems: 'center', borderWidth: 0.5, borderColor: C.border },
});
