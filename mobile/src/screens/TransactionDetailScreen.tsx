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
import { Transactions, Disputes, Returns, type TrackingResponse, type Transaction } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { BackButton } from '../components/ui';
import { parseApiError } from '../utils/errors';

const DISPUTE_REASONS: { key: string; label: string }[] = [
  { key: 'item_not_received', label: 'I never received the item' },
  { key: 'item_not_as_described', label: "Item doesn't match the listing" },
  { key: 'payment_issue', label: 'Payment problem' },
  { key: 'other', label: 'Something else' },
];

const RETURN_REASONS: { key: string; label: string }[] = [
  { key: 'item_not_as_described', label: "Item doesn't match the listing" },
  { key: 'damaged_in_transit', label: 'Item arrived damaged' },
  { key: 'wrong_item', label: 'I received the wrong item' },
  { key: 'other', label: 'Something else' },
];

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
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState<string>('item_not_as_described');
  const [disputeDesc, setDisputeDesc] = useState('');
  const [showReturn, setShowReturn] = useState(false);
  const [returnReason, setReturnReason] = useState<string>('item_not_as_described');
  const [returnDesc, setReturnDesc] = useState('');

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
          <BackButton onPress={() => navigation.goBack()} />
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

        {tracking.refund_status && tracking.refund_status !== 'none' && (
          <View style={[s.refundBox,
            tracking.refund_status === 'completed' && s.refundOK,
            tracking.refund_status === 'failed' && s.refundErr,
          ]}>
            <Text style={s.refundLabel}>
              {tracking.refund_status === 'completed' ? 'Refunded' :
               tracking.refund_status === 'failed' ? 'Refund failed' :
               'Refund in progress'}
            </Text>
            {tracking.refund_amount && (
              <Text style={s.refundAmount}>{formatPrice(Number(tracking.refund_amount))}</Text>
            )}
            {tracking.refund_status === 'completed' ? (
              <Text style={s.refundHint}>The amount has been credited to your original payment method. Bank settlement can take 5-7 working days.</Text>
            ) : tracking.refund_status === 'failed' ? (
              <Text style={s.refundHint}>Owmee ops will retry shortly. Contact support@owmee.in if it stays unresolved for 24 hours.</Text>
            ) : (
              <Text style={s.refundHint}>Your refund is being processed. We'll notify you when it lands.</Text>
            )}
            {tracking.refund_reason && (
              <Text style={s.refundReason}>Reason: {tracking.refund_reason}</Text>
            )}
          </View>
        )}

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
            <TouchableOpacity style={s.btnSecondary} onPress={() => setShowDispute(true)}>
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

        {/* Return — only buyer, only inside 7-day window, only if no
            return already in flight. Eligibility computed server-side. */}
        {isBuyer && tracking.return_eligible && (
          <View style={s.actions}>
            <TouchableOpacity style={s.btnSecondary} onPress={() => setShowReturn(true)}>
              <Text style={s.btnSecondaryText}>Return this item</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Return-status box (visible while a return is in flight or
            after rejection so the buyer can see why). */}
        {tracking.return_status && tracking.return_status !== 'none' && (
          <View style={[s.refundBox,
            tracking.return_status === 'completed' && s.refundOK,
            tracking.return_status === 'rejected' && s.refundErr,
          ]}>
            <Text style={s.refundLabel}>Return — {tracking.return_status.replace(/_/g, ' ')}</Text>
            {tracking.return_status === 'requested' && (
              <Text style={s.refundHint}>We're reviewing your request. You'll get a decision within 24 hours.</Text>
            )}
            {tracking.return_status === 'approved' && (
              <Text style={s.refundHint}>Approved. Owmee FE will pick the item up from you soon.</Text>
            )}
            {tracking.return_status === 'pickup_scheduled' && (
              <Text style={s.refundHint}>FE assigned. They'll contact you shortly.</Text>
            )}
            {tracking.return_status === 'picked_up' && (
              <Text style={s.refundHint}>Item collected. Refund processing.</Text>
            )}
            {tracking.return_status === 'completed' && (
              <Text style={s.refundHint}>Return complete. Refund initiated to your original payment method.</Text>
            )}
            {tracking.return_status === 'rejected' && tracking.return_decision_note && (
              <Text style={s.refundReason}>{tracking.return_decision_note}</Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Dispute modal — KYC-gated server-side; on 403 we route the
          buyer to the KycRequiredForAction screen so they understand
          why the action is blocked before they fill out the form. */}
      <Modal visible={showDispute} animationType="slide" transparent onRequestClose={() => setShowDispute(false)}>
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Open a dispute</Text>
            <Text style={s.disputeHint}>
              Use this only if something is genuinely wrong. We review every dispute against the FE inspection report and listing snapshot.
            </Text>
            <Text style={s.rowLabel}>What went wrong?</Text>
            {DISPUTE_REASONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[s.reasonRow, disputeReason === opt.key && s.reasonRowOn]}
                onPress={() => setDisputeReason(opt.key)}
              >
                <View style={[s.radio, disputeReason === opt.key && s.radioOn]} />
                <Text style={s.reasonLabel}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <Text style={[s.rowLabel, { marginTop: 12 }]}>Tell us more</Text>
            <TextInput
              style={[s.input, { minHeight: 100 }]}
              placeholder="What happened? Be specific — this is the only context our reviewers have."
              placeholderTextColor={C.text4}
              value={disputeDesc}
              onChangeText={setDisputeDesc}
              multiline
              maxLength={1000}
            />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={() => setShowDispute(false)}>
                <Text style={s.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnPrimary, { flex: 2 }, (disputeDesc.length < 10 || acting) && s.btnDisabled]}
                disabled={disputeDesc.length < 10 || acting}
                onPress={async () => {
                  setShowDispute(false);
                  setActing(true);
                  try {
                    await Disputes.raise(transactionId, disputeReason, disputeDesc);
                    Alert.alert('Dispute opened', 'Our team will review within 48 hours and contact you. The seller payout is on hold until then.');
                    await reload();
                  } catch (e: any) {
                    if (e?.response?.status === 403) {
                      // KYC not done — point them at the KYC-for-action screen.
                      (navigation as any).navigate('KycRequiredForAction', {
                        actionLabel: 'open this dispute', returnTo: 'TransactionDetail',
                      });
                    } else {
                      Alert.alert('Could not open dispute', parseApiError(e, 'Try again.'));
                    }
                  } finally {
                    setActing(false);
                  }
                }}
              >
                <Text style={s.btnPrimaryText}>Open dispute</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showReturn} animationType="slide" transparent onRequestClose={() => setShowReturn(false)}>
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Return this item</Text>
            <Text style={s.disputeHint}>
              Owmee FE will pick the item up from you and refund your original payment.
              You have 7 days from delivery to request a return.
            </Text>
            <Text style={s.rowLabel}>Why are you returning?</Text>
            {RETURN_REASONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[s.reasonRow, returnReason === opt.key && s.reasonRowOn]}
                onPress={() => setReturnReason(opt.key)}
              >
                <View style={[s.radio, returnReason === opt.key && s.radioOn]} />
                <Text style={s.reasonLabel}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
            <Text style={[s.rowLabel, { marginTop: 12 }]}>Tell us more</Text>
            <TextInput
              style={[s.input, { minHeight: 100 }]}
              placeholder="What's wrong with it? Be specific."
              placeholderTextColor={C.text4}
              value={returnDesc}
              onChangeText={setReturnDesc}
              multiline
              maxLength={1000}
            />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={() => setShowReturn(false)}>
                <Text style={s.btnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnPrimary, { flex: 2 }, (returnDesc.length < 10 || acting) && s.btnDisabled]}
                disabled={returnDesc.length < 10 || acting}
                onPress={async () => {
                  setShowReturn(false);
                  setActing(true);
                  try {
                    await Returns.request(transactionId, returnReason, returnDesc);
                    Alert.alert('Return requested', 'We\'ll review and decide within 24 hours.');
                    await reload();
                  } catch (e: any) {
                    if (e?.response?.status === 403) {
                      (navigation as any).navigate('KycRequiredForAction', {
                        actionLabel: 'request a return', returnTo: 'TransactionDetail',
                      });
                    } else {
                      Alert.alert('Could not request return', parseApiError(e, 'Try again.'));
                    }
                  } finally {
                    setActing(false);
                  }
                }}
              >
                <Text style={s.btnPrimaryText}>Request return</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  bannerOK: { backgroundColor: C.greenLight, borderColor: C.green },
  bannerWarn: { backgroundColor: C.yellowLight, borderColor: C.yellow },
  bannerErr: { backgroundColor: C.redLight, borderColor: C.red },
  bannerText: { fontSize: 14, color: C.text, lineHeight: 20 },

  ackBox: { margin: 16, padding: 20, borderRadius: 12, backgroundColor: C.honeyLight, borderWidth: 2, borderColor: C.honey, alignItems: 'center' },
  ackLabel: { fontSize: 12, color: C.honeyText, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '600' },
  ackCode: { fontSize: 36, fontWeight: '800', color: C.honeyText, letterSpacing: 8 },
  ackHint: { fontSize: 12, color: C.honeyDeep, marginTop: 8, textAlign: 'center', lineHeight: 18 },

  courierBox: { marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.honey, backgroundColor: C.honeyLight },
  courierText: { fontSize: 14, color: C.honeyDeep, fontWeight: '600', textAlign: 'center' },

  timeline: { paddingHorizontal: 24, paddingVertical: 16 },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start' },
  tlGutter: { width: 18, alignItems: 'center' },
  // Timeline dot uses surface (white) when inactive so it stands out against
  // the cream canvas; honey when active. Color is the same regardless of theme.
  tlDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.text4, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  tlDotDone: { backgroundColor: C.honey, borderColor: C.honey },
  tlTick: { fontSize: 11, color: C.white, fontWeight: '700' },
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
  btnPrimaryText: { color: C.white, fontSize: 15, fontWeight: '700' },
  btnSecondary: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 14, alignItems: 'center', backgroundColor: C.surface },
  btnSecondaryText: { color: C.text2, fontSize: 14, fontWeight: '500' },
  btnDisabled: { opacity: 0.5 },

  // Refund box: amber while in-flight (matches "in progress" semantic in
  // the rest of the app), green on completion, red on failure. Uses the
  // v4 palette tokens — earlier these were Tailwind-default hex literals
  // that didn't match the warm-trust aesthetic.
  refundBox: { margin: 16, padding: 16, borderRadius: 10, backgroundColor: C.yellowLight, borderWidth: 1, borderColor: C.yellow },
  refundOK: { backgroundColor: C.greenLight, borderColor: C.green },
  refundErr: { backgroundColor: C.redLight, borderColor: C.red },
  refundLabel: { fontSize: 13, fontWeight: '700', color: C.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  refundAmount: { fontSize: 20, fontWeight: '800', color: C.text, marginVertical: 4 },
  refundHint: { fontSize: 12, color: C.text3, lineHeight: 18 },
  refundReason: { fontSize: 11, color: C.text4, marginTop: 6, fontStyle: 'italic' },

  // rowLabel is the label-above-input style used inside the Dispute /
  // Return modals. Matches sheetTitle's weight but smaller, so a label
  // and the input it precedes feel like one component.
  rowLabel: { fontSize: 13, fontWeight: '600', color: C.text2, marginTop: 8, marginBottom: 6 },
  disputeHint: { fontSize: 13, color: C.text3, marginBottom: 16, lineHeight: 18 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  reasonRowOn: {},
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.text4 },
  radioOn: { borderColor: C.honey, backgroundColor: C.honey },
  reasonLabel: { fontSize: 14, color: C.text },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: C.cream, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 16 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 },
  star: { fontSize: 36, color: C.text4 },
  starOn: { color: C.honey },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, marginBottom: 16, color: C.text, minHeight: 80, textAlignVertical: 'top' },
});
