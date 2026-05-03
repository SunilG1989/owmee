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
import { BackButton, Button } from '../components/ui';
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
  // null until the buyer answers — submit is gated until they pick yes/no.
  // Was previously hardcoded to true at submit time which made dispute analytics
  // impossible: every rating implied "matched listing" regardless of stars.
  const [matchedListing, setMatchedListing] = useState<boolean | null>(null);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState<string>('item_not_as_described');
  const [disputeDesc, setDisputeDesc] = useState('');
  const [showReturn, setShowReturn] = useState(false);
  const [returnReason, setReturnReason] = useState<string>('item_not_as_described');
  const [returnDesc, setReturnDesc] = useState('');
  // Buyer must visually inspect at the door before reading the handover code
  // (P0.5). The code release becomes a digital "I have inspected and accept"
  // checkpoint we can later reference if a dispute is raised.
  const [conditionConfirmed, setConditionConfirmed] = useState(false);

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
    return <SafeAreaView style={s.safe}><ActivityIndicator color={C.petrol} style={{ marginTop: 60 }} /></SafeAreaView>;
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
            {!conditionConfirmed ? (
              <>
                <Text style={s.ackLabel}>Inspect before you accept</Text>
                <Text style={s.ackInspectCopy}>
                  Open the package, check the item against the listing photos and condition.
                  If it matches, confirm below to reveal your handover code. If not, raise a dispute now —
                  100% refund if it's not as promised.
                </Text>
                <TouchableOpacity
                  style={s.ackConfirmBtn}
                  onPress={() => setConditionConfirmed(true)}
                  activeOpacity={0.8}
                >
                  <View style={s.ackCheckBox}>
                    <Text style={s.ackCheckTick}>✓</Text>
                  </View>
                  <Text style={s.ackConfirmLabel}>Item matches the listing — show my code</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.ackLabel}>Your handover code</Text>
                <Text style={s.ackCode}>{tracking.ack_code}</Text>
                <Text style={s.ackHint}>Read this to the Owmee FE to complete the handover.</Text>
              </>
            )}
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
            <Button
              label="Confirm receipt"
              variant="primary"
              size="lg"
              loading={acting}
              disabled={acting}
              onPress={() => doAction(
                () => Transactions.confirmDeal(transactionId),
                'Receipt confirmed. Thanks!',
              )}
              fullWidth
            />
            <Button
              label="Something's wrong"
              variant="secondary"
              size="lg"
              onPress={() => setShowDispute(true)}
              fullWidth
            />
          </View>
        )}

        {isCompleted && !isDisputed && (
          <View style={s.actions}>
            <Button
              label="Rate this transaction"
              variant="primary"
              size="lg"
              onPress={() => setShowRate(true)}
              fullWidth
            />
          </View>
        )}

        {/* Return — only buyer, only inside 7-day window, only if no
            return already in flight. Eligibility computed server-side. */}
        {isBuyer && tracking.return_eligible && (
          <View style={s.actions}>
            <Button
              label="Return this item"
              variant="secondary"
              size="lg"
              onPress={() => setShowReturn(true)}
              fullWidth
            />
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
            <Text style={[s.rowLabel, s.rowLabelSpaced]}>Tell us more</Text>
            <TextInput
              style={[s.input, s.inputTaller]}
              placeholder="What happened? Be specific — this is the only context our reviewers have."
              placeholderTextColor={C.text4}
              value={disputeDesc}
              onChangeText={setDisputeDesc}
              multiline
              maxLength={1000}
            />
            <View style={s.modalActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setShowDispute(false)}
                style={s.modalCancel}
              />
              <Button
                label="Open dispute"
                variant="primary"
                disabled={disputeDesc.length < 10 || acting}
                loading={acting}
                onPress={async () => {
                  setShowDispute(false);
                  setActing(true);
                  try {
                    await Disputes.raise(transactionId, disputeReason, disputeDesc);
                    Alert.alert('Dispute opened', 'Our team will review within 48 hours and contact you. The seller payout is on hold until then.');
                    await reload();
                  } catch (e: any) {
                    if (e?.response?.status === 403) {
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
                style={s.modalSubmit}
              />
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
            <Text style={[s.rowLabel, s.rowLabelSpaced]}>Tell us more</Text>
            <TextInput
              style={[s.input, s.inputTaller]}
              placeholder="What's wrong with it? Be specific."
              placeholderTextColor={C.text4}
              value={returnDesc}
              onChangeText={setReturnDesc}
              multiline
              maxLength={1000}
            />
            <View style={s.modalActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setShowReturn(false)}
                style={s.modalCancel}
              />
              <Button
                label="Request return"
                variant="primary"
                disabled={returnDesc.length < 10 || acting}
                loading={acting}
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
                style={s.modalSubmit}
              />
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

            <Text style={s.matchedQuestion}>Did the item match the listing?</Text>
            <View style={s.matchedRow}>
              <TouchableOpacity
                style={[s.matchedBtn, matchedListing === true && s.matchedBtnYes]}
                onPress={() => setMatchedListing(true)}
              >
                <Text style={[s.matchedBtnLabel, matchedListing === true && s.matchedBtnLabelOn]}>
                  ✓ Yes, it matched
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.matchedBtn, matchedListing === false && s.matchedBtnNo]}
                onPress={() => setMatchedListing(false)}
              >
                <Text style={[s.matchedBtnLabel, matchedListing === false && s.matchedBtnLabelOn]}>
                  ✗ No, it didn't
                </Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={s.input}
              placeholder={
                matchedListing === false
                  ? 'Tell us what was different (helps disputes)'
                  : 'Add a note (optional)'
              }
              placeholderTextColor={C.text4}
              value={ratingNote}
              onChangeText={setRatingNote}
              multiline
            />
            <Button
              label="Submit"
              variant="primary"
              size="lg"
              disabled={rating === 0 || matchedListing === null || acting}
              loading={acting}
              onPress={() => {
                setShowRate(false);
                doAction(
                  () => Transactions.rate(
                    transactionId,
                    rating,
                    matchedListing === true,
                    ratingNote || undefined,
                  ),
                  'Thanks for rating!',
                );
              }}
              fullWidth
            />
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
  safe: { flex: 1, backgroundColor: C.bone },
  header: {
    paddingHorizontal: S.lg, paddingVertical: S.md,
    flexDirection: 'row', alignItems: 'center', gap: S.md,
  },
  back: { fontSize: T.size.sm + 1, color: C.text3 },
  title: { fontSize: T.size.lg + 1, fontWeight: T.weight.bold, color: C.text },

  banner: {
    marginHorizontal: S.lg, padding: S.lg,
    borderRadius: R.sm,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  bannerOK: { backgroundColor: C.greenLight, borderColor: C.green },
  bannerWarn: { backgroundColor: C.yellowLight, borderColor: C.yellow },
  bannerErr: { backgroundColor: C.redLight, borderColor: C.red },
  bannerText: { fontSize: T.size.sm + 1, color: C.text, lineHeight: 20 },

  ackBox: {
    margin: S.lg, padding: S.xl,
    borderRadius: R.md,
    backgroundColor: C.petrolLight,
    borderWidth: 2, borderColor: C.petrol,
    alignItems: 'center',
  },
  ackLabel: {
    fontSize: T.size.sm, color: C.petrolText,
    marginBottom: S.xs + 2,
    textTransform: 'uppercase', letterSpacing: 1,
    fontWeight: T.weight.semi,
  },
  ackCode: { fontSize: T.size.display + 6, fontWeight: T.weight.heavy, color: C.petrolText, letterSpacing: 8 },
  ackHint: { fontSize: T.size.sm, color: C.petrolDeep, marginTop: S.sm, textAlign: 'center', lineHeight: 18 },
  ackInspectCopy: {
    fontSize: T.size.base,
    color: C.petrolDeep,
    textAlign: 'center',
    lineHeight: T.size.base + 6,
    marginBottom: S.lg,
  },
  ackConfirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderRadius: R.md,
    borderWidth: 1.5,
    borderColor: C.petrol,
    gap: S.md,
  },
  ackCheckBox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    backgroundColor: C.petrol,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ackCheckTick: {
    color: C.surface,
    fontSize: T.size.base,
    fontWeight: T.weight.heavy,
    lineHeight: 18,
  },
  ackConfirmLabel: {
    fontSize: T.size.base,
    fontWeight: T.weight.semi,
    color: C.petrolDeep,
  },

  courierBox: {
    marginHorizontal: S.lg, marginBottom: S.md,
    padding: S.md, borderRadius: R.sm,
    borderWidth: 1, borderColor: C.petrol,
    backgroundColor: C.petrolLight,
  },
  courierText: { fontSize: T.size.sm + 1, color: C.petrolDeep, fontWeight: T.weight.semi, textAlign: 'center' },

  timeline: { paddingHorizontal: S.xxl, paddingVertical: S.lg },
  tlRow: { flexDirection: 'row', alignItems: 'flex-start' },
  tlGutter: { width: 18, alignItems: 'center' },
  tlDot: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: C.text4,
    backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  tlDotDone: { backgroundColor: C.petrol, borderColor: C.petrol },
  tlTick: { fontSize: T.size.sm, color: C.white, fontWeight: T.weight.bold },
  tlBar: { flex: 1, width: 2, backgroundColor: C.text4, marginTop: 2 },
  tlBarDone: { backgroundColor: C.petrol },
  tlBody: { flex: 1, marginLeft: S.md, paddingBottom: S.xl },
  tlLabel: { fontSize: T.size.sm + 1, color: C.text3 },
  tlLabelDone: { color: C.text, fontWeight: T.weight.semi },
  tlAt: { fontSize: T.size.sm, color: C.text4, marginTop: 2 },

  priceBox: {
    margin: S.lg, padding: S.lg,
    backgroundColor: C.surface, borderRadius: R.sm,
    borderWidth: 1, borderColor: C.border,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: S.xs + 2 },
  priceLabel: { fontSize: T.size.base, color: C.text3 },
  priceValue: { fontSize: T.size.base, color: C.text },

  actions: { paddingHorizontal: S.lg, gap: S.md, marginTop: S.md },

  rowLabelSpaced: { marginTop: S.md },
  inputTaller: { minHeight: 100 },
  modalActions: { flexDirection: 'row', gap: S.md, marginTop: S.sm },
  modalCancel: { flex: 1 },
  modalSubmit: { flex: 2 },

  refundBox: {
    margin: S.lg, padding: S.lg,
    borderRadius: R.sm,
    backgroundColor: C.yellowLight,
    borderWidth: 1, borderColor: C.yellow,
  },
  refundOK: { backgroundColor: C.greenLight, borderColor: C.green },
  refundErr: { backgroundColor: C.redLight, borderColor: C.red },
  refundLabel: { fontSize: T.size.base, fontWeight: T.weight.bold, color: C.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  refundAmount: { fontSize: T.size.xl, fontWeight: T.weight.heavy, color: C.text, marginVertical: S.xs },
  refundHint: { fontSize: T.size.sm, color: C.text3, lineHeight: 18 },
  refundReason: { fontSize: T.size.sm, color: C.text4, marginTop: S.xs + 2, fontStyle: 'italic' },

  rowLabel: { fontSize: T.size.base, fontWeight: T.weight.semi, color: C.text2, marginTop: S.sm, marginBottom: S.xs + 2 },
  disputeHint: { fontSize: T.size.base, color: C.text3, marginBottom: S.lg, lineHeight: 18 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: S.sm + 2, gap: S.sm + 2 },
  reasonRowOn: {},
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.text4 },
  radioOn: { borderColor: C.petrol, backgroundColor: C.petrol },
  reasonLabel: { fontSize: T.size.sm + 1, color: C.text },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: C.bone, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, padding: S.xxl },
  modalTitle: { fontSize: T.size.lg + 1, fontWeight: T.weight.bold, color: C.text, marginBottom: S.lg },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: S.sm, marginBottom: S.lg },
  star: { fontSize: T.size.display + 6, color: C.text4 },
  starOn: { color: C.petrol },
  matchedQuestion: {
    fontSize: T.size.md,
    fontWeight: T.weight.semi,
    color: C.text,
    marginBottom: S.sm,
  },
  matchedRow: {
    flexDirection: 'row',
    gap: S.sm,
    marginBottom: S.lg,
  },
  matchedBtn: {
    flex: 1,
    paddingVertical: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
  },
  matchedBtnYes: {
    borderColor: C.petrol,
    backgroundColor: C.petrolLight,
  },
  matchedBtnNo: {
    borderColor: C.red,
    backgroundColor: C.redLight,
  },
  matchedBtnLabel: {
    fontSize: T.size.base,
    fontWeight: T.weight.semi,
    color: C.text2,
  },
  matchedBtnLabelOn: {
    color: C.text,
  },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: R.xs + 2,
    padding: S.md, marginBottom: S.lg,
    color: C.text, minHeight: 80, textAlignVertical: 'top',
  },
});
