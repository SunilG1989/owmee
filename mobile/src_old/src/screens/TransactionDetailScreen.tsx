/**
 * TransactionDetailScreen
 *
 * India UX (from review):
 * - "What happens next" timeline — biggest confusion point for Indian buyers
 * - Meetup confirm / cancel at meetup with 30-min window
 * - Seller ghosting deadline visible
 * - Protected transaction promise visible throughout
 * - Rating opens 2h after deal — not immediately
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, Radius, Typography } from '../utils/tokens';
import { Transactions } from '../services/api';
import type { Transaction } from '../services/api';
import { useAuthStore } from '../store/authStore';

// ── Timeline steps ─────────────────────────────────────────────────────────────

const STEPS_BUYER = [
  { key: 'paid', label: 'Payment confirmed', desc: 'Your payment is safe with us.' },
  { key: 'meetup_set', label: 'Meetup arranged', desc: 'Seller will contact you to set a time and place.' },
  { key: 'met', label: 'Meet & inspect', desc: 'Meet in a safe public place. Inspect before confirming.' },
  { key: 'confirmed', label: 'Deal complete', desc: 'Confirm in app. Rate your experience.' },
];

const STEPS_SELLER = [
  { key: 'paid', label: 'Buyer has paid', desc: 'Payment is held securely.' },
  { key: 'meetup_set', label: 'Confirm meetup time', desc: 'Respond within 24 hours or deal may be cancelled.' },
  { key: 'met', label: 'Hand over item', desc: 'Meet buyer, hand over the item.' },
  { key: 'confirmed', label: 'Payout initiated', desc: 'Payment released to your account within 2 days.' },
];

function getStepIndex(status: string): number {
  if (['payment_captured', 'awaiting_confirmation'].includes(status)) return 0;
  if (status === 'meetup_pending') return 1;
  if (status === 'awaiting_confirmation') return 2;
  if (['completed', 'auto_completed'].includes(status)) return 3;
  return 0;
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ' at ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function timeUntil(iso?: string): string | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m remaining`;
  return `${m} min remaining`;
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function TransactionDetailScreen({ route, navigation }: any) {
  const { transactionId } = route.params;
  const { userId } = useAuthStore();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showRateModal, setShowRateModal] = useState(false);
  const [rating, setRating] = useState(5);
  const [ratingNote, setRatingNote] = useState('');
  const [itemAsDescribed, setItemAsDescribed] = useState<'yes' | 'mostly' | 'no'>('yes');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await Transactions.get(transactionId);
      setTxn(res.data);
    } catch { /* show error */ }
    finally { setLoading(false); }
  }, [transactionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color={Colors.teal} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!txn) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
        </View>
        <View style={s.empty}>
          <Text style={s.emptyText}>Transaction not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isBuyer = txn.buyer_id === userId;
  const steps = isBuyer ? STEPS_BUYER : STEPS_SELLER;
  const stepIndex = getStepIndex(txn.status);
  const isActive = !['completed', 'auto_completed', 'cancelled', 'refunded', 'disputed'].includes(txn.status);
  const isDisputed = txn.status === 'disputed';

  // Can confirm meetup? (seller only, after payment)
  const canConfirmMeetup = !isBuyer &&
    ['payment_captured', 'awaiting_confirmation'].includes(txn.status) &&
    !txn.agreed_meetup_at;

  // Can cancel at meetup? (buyer only, within 30-min window after agreed time)
  const canCancelAtMeetup = isBuyer &&
    txn.agreed_meetup_at &&
    txn.meetup_deadline &&
    new Date() <= new Date(txn.meetup_deadline) &&
    isActive;

  // Can confirm deal? (buyer only, active)
  const canConfirmDeal = isBuyer &&
    ['awaiting_confirmation', 'payment_captured'].includes(txn.status);

  // Can rate? (active complete)
  const canRate = ['completed', 'auto_completed'].includes(txn.status);

  // Ghosting deadline for buyer
  const ghostingDeadline = !isBuyer ? null : txn.seller_response_deadline;

  const handleConfirmMeetup = () => {
    // Alert.prompt is iOS-only; use a simple 24h-from-now confirmation on Android
    Alert.alert(
      'Confirm meetup',
      'This will schedule the meetup for tomorrow. You can message the buyer via chat to coordinate the exact time and place.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm meetup',
          onPress: async () => {
            try {
              const meetup_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
              await Transactions.confirmMeetup(transactionId, meetup_at);
              load();
            } catch (e: any) {
              Alert.alert('Error', e.response?.data?.detail?.message || 'Could not confirm meetup');
            }
          },
        },
      ]
    );
  };

  const handleCancelAtMeetup = async () => {
    if (!cancelReason.trim()) {
      Alert.alert('Please explain', 'Tell us what happened — this helps us improve.');
      return;
    }
    setSubmitting(true);
    try {
      await Transactions.cancelAtMeetup(transactionId, cancelReason);
      setShowCancelModal(false);
      Alert.alert(
        'Deal cancelled',
        'Your refund has been initiated. It will reach your account within 3–5 business days.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (e: any) {
      Alert.alert('Error', e.response?.data?.detail?.message || 'Could not cancel deal');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDeal = () => {
    Alert.alert(
      'Confirm deal',
      'Confirming means you received the item as described. This releases payment to the seller.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm deal', style: 'default',
          onPress: async () => {
            try {
              await Transactions.confirm(transactionId);
              load();
              Alert.alert('Deal complete! 🎉', 'Rate your experience in 2 hours when prompted.');
            } catch (e: any) {
              Alert.alert('Error', e.response?.data?.detail?.message || 'Could not confirm deal');
            }
          },
        },
      ]
    );
  };

  const handleRate = async () => {
    setSubmitting(true);
    try {
      await Transactions.rate(transactionId, rating, itemAsDescribed, ratingNote || undefined);
      setShowRateModal(false);
      Alert.alert('Thank you!', 'Your rating has been submitted.');
      load();
    } catch (e: any) {
      const msg = e.response?.data?.detail?.message || 'Could not submit rating';
      Alert.alert('Cannot rate yet', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Transaction</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Amount card */}
        <View style={s.amountCard}>
          <Text style={s.amountLabel}>{isBuyer ? 'You paid' : 'You receive'}</Text>
          <Text style={s.amount}>
            ₹{parseFloat(txn.gross_amount || '0').toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </Text>
          <View style={[s.statusPill, isDisputed && s.statusPillDispute]}>
            <Text style={[s.statusText, isDisputed && s.statusTextDispute]}>
              {txn.status.replace(/_/g, ' ')}
            </Text>
          </View>
        </View>

        {/* Protected transaction bar */}
        {isActive && (
          <View style={s.trustBar}>
            <Text style={s.trustIcon}>🔒</Text>
            <Text style={s.trustText}>
              <Text style={s.trustBold}>Protected transaction</Text>
              {'\n'}Your money is safe. Pay only after you verify the item in person.
            </Text>
          </View>
        )}

        {/* Seller ghosting warning */}
        {isBuyer && ghostingDeadline && isActive && (
          <View style={s.warningBar}>
            <Text style={s.warningIcon}>⏰</Text>
            <Text style={s.warningText}>
              Seller must confirm meetup by {formatDate(ghostingDeadline)}.
              {'\n'}
              <Text style={s.warningBold}>{timeUntil(ghostingDeadline)}</Text>
              {' — if they don\'t respond, your payment will be refunded.'}
            </Text>
          </View>
        )}

        {/* What happens next — timeline */}
        <View style={s.timelineCard}>
          <Text style={s.timelineTitle}>What happens next</Text>
          {steps.map((step, i) => {
            const isDone = i < stepIndex;
            const isCurrent = i === stepIndex;
            const isPending = i > stepIndex;
            return (
              <View key={step.key} style={s.timelineRow}>
                <View style={s.timelineLeft}>
                  <View style={[
                    s.timelineDot,
                    isDone && s.timelineDotDone,
                    isCurrent && s.timelineDotCurrent,
                  ]}>
                    {isDone
                      ? <Text style={s.timelineDotCheck}>✓</Text>
                      : <Text style={[s.timelineDotNum, isPending && { color: Colors.text4 }]}>
                          {i + 1}
                        </Text>
                    }
                  </View>
                  {i < steps.length - 1 && (
                    <View style={[s.timelineLine, isDone && s.timelineLineDone]} />
                  )}
                </View>
                <View style={s.timelineContent}>
                  <Text style={[
                    s.timelineStepLabel,
                    isDone && s.timelineStepDone,
                    isCurrent && s.timelineStepCurrent,
                    isPending && s.timelineStepPending,
                  ]}>
                    {step.label}
                  </Text>
                  {isCurrent && (
                    <Text style={s.timelineStepDesc}>{step.desc}</Text>
                  )}
                  {isCurrent && i === 1 && txn.agreed_meetup_at && (
                    <Text style={s.timelineMeetup}>
                      Meetup: {formatDate(txn.agreed_meetup_at)}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Transaction details */}
        <View style={s.detailsCard}>
          <Text style={s.detailsTitle}>Details</Text>
          <View style={s.detailRow}>
            <Text style={s.detailKey}>Transaction ID</Text>
            <Text style={s.detailVal} numberOfLines={1}>{txn.id.slice(0, 12)}…</Text>
          </View>
          <View style={s.detailRow}>
            <Text style={s.detailKey}>Payment method</Text>
            <Text style={s.detailVal}>{txn.payment_method === 'cash' ? 'Cash at meetup' : 'UPI'}</Text>
          </View>
          <View style={s.detailRow}>
            <Text style={s.detailKey}>Date</Text>
            <Text style={s.detailVal}>{formatDate(txn.created_at)}</Text>
          </View>
          {txn.agreed_meetup_at && (
            <View style={s.detailRow}>
              <Text style={s.detailKey}>Meetup agreed</Text>
              <Text style={s.detailVal}>{formatDate(txn.agreed_meetup_at)}</Text>
            </View>
          )}
        </View>

        {/* Safe meetup tips */}
        {isActive && (
          <View style={s.tipsCard}>
            <Text style={s.tipsTitle}>💡 Safe meetup tips</Text>
            {[
              'Meet in a busy public place — café, mall, metro station',
              'Go during daytime if possible',
              'Test the item before confirming the deal',
              'Do not share OTPs or UPI PINs with anyone',
            ].map((tip, i) => (
              <View key={i} style={s.tipRow}>
                <Text style={s.tipDot}>•</Text>
                <Text style={s.tipText}>{tip}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Action buttons */}
      {(canConfirmMeetup || canCancelAtMeetup || canConfirmDeal || canRate) && (
        <View style={s.actions}>
          {canCancelAtMeetup && (
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => setShowCancelModal(true)}
            >
              <Text style={s.cancelBtnText}>Item doesn't match</Text>
            </TouchableOpacity>
          )}
          {canConfirmMeetup && (
            <TouchableOpacity style={s.primaryBtn} onPress={handleConfirmMeetup}>
              <Text style={s.primaryBtnText}>Confirm meetup time →</Text>
            </TouchableOpacity>
          )}
          {canConfirmDeal && (
            <TouchableOpacity style={s.primaryBtn} onPress={handleConfirmDeal}>
              <Text style={s.primaryBtnText}>Item verified — confirm deal →</Text>
            </TouchableOpacity>
          )}
          {canRate && (
            <TouchableOpacity style={s.rateBtn} onPress={() => setShowRateModal(true)}>
              <Text style={s.rateBtnText}>⭐ Rate your experience</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Cancel at meetup modal */}
      <Modal visible={showCancelModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Cancel at meetup</Text>
            <Text style={s.modalSub}>
              Tell us what happened. Your refund will be initiated immediately.
            </Text>
            <TextInput
              style={s.modalInput}
              placeholder="e.g. Item was damaged and not as described"
              placeholderTextColor={Colors.text4}
              multiline
              numberOfLines={3}
              value={cancelReason}
              onChangeText={setCancelReason}
            />
            <View style={s.modalActions}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setShowCancelModal(false)}
              >
                <Text style={s.modalCancelText}>Go back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalConfirmBtn, submitting && { opacity: 0.6 }]}
                onPress={handleCancelAtMeetup}
                disabled={submitting}
              >
                <Text style={s.modalConfirmText}>
                  {submitting ? 'Processing…' : 'Cancel & get refund'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rate modal */}
      <Modal visible={showRateModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Rate your experience</Text>

            {/* Stars */}
            <View style={s.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setRating(star)}>
                  <Text style={[s.star, star <= rating && s.starActive]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Item as described */}
            <Text style={s.rateLabel}>Was the item as described?</Text>
            <View style={s.iadRow}>
              {(['yes', 'mostly', 'no'] as const).map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[s.iadBtn, itemAsDescribed === opt && s.iadBtnActive]}
                  onPress={() => setItemAsDescribed(opt)}
                >
                  <Text style={[s.iadText, itemAsDescribed === opt && s.iadTextActive]}>
                    {opt === 'yes' ? '👍 Yes' : opt === 'mostly' ? '🤷 Mostly' : '👎 No'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={s.modalInput}
              placeholder="Add a note (optional)"
              placeholderTextColor={Colors.text4}
              value={ratingNote}
              onChangeText={setRatingNote}
            />

            <Text style={s.rateNote}>
              Ratings are revealed only after the other person also rates, or after 7 days.
            </Text>

            <View style={s.modalActions}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setShowRateModal(false)}
              >
                <Text style={s.modalCancelText}>Later</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalConfirmBtn, submitting && { opacity: 0.6 }]}
                onPress={handleRate}
                disabled={submitting}
              >
                <Text style={s.modalConfirmText}>{submitting ? 'Saving…' : 'Submit'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  back: { fontSize: 18, color: Colors.text3 },
  headerTitle: { fontSize: Typography.size.md, fontWeight: '500', color: Colors.text },

  amountCard: {
    margin: Spacing.lg, backgroundColor: Colors.surface,
    borderRadius: Radius.lg, borderWidth: 0.5, borderColor: Colors.border,
    padding: Spacing.xl, alignItems: 'center',
  },
  amountLabel: { fontSize: Typography.size.sm, color: Colors.text3, marginBottom: 4 },
  amount: { fontSize: 32, fontWeight: '300', color: Colors.text, letterSpacing: -1, marginBottom: 12 },
  statusPill: {
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: Radius.full,
    backgroundColor: Colors.tealLight,
  },
  statusPillDispute: { backgroundColor: Colors.errorLight },
  statusText: { fontSize: Typography.size.sm, color: Colors.teal, fontWeight: '500', textTransform: 'uppercase' },
  statusTextDispute: { color: Colors.error },

  trustBar: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
    backgroundColor: Colors.tealLight, borderRadius: Radius.md,
    padding: Spacing.md, flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
  },
  trustIcon: { fontSize: 16 },
  trustText: { flex: 1, fontSize: Typography.size.sm, color: Colors.tealText, lineHeight: 18 },
  trustBold: { fontWeight: '500' },

  warningBar: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
    backgroundColor: Colors.warningLight, borderRadius: Radius.md,
    padding: Spacing.md, flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    borderWidth: 0.5, borderColor: 'rgba(180,83,9,0.2)',
  },
  warningIcon: { fontSize: 16 },
  warningText: { flex: 1, fontSize: Typography.size.sm, color: Colors.warning, lineHeight: 18 },
  warningBold: { fontWeight: '600' },

  timelineCard: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 0.5, borderColor: Colors.border, padding: Spacing.lg,
  },
  timelineTitle: { fontSize: Typography.size.md, fontWeight: '500', color: Colors.text, marginBottom: Spacing.md },
  timelineRow: { flexDirection: 'row', gap: Spacing.md, minHeight: 44 },
  timelineLeft: { alignItems: 'center', width: 28 },
  timelineDot: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  timelineDotDone: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  timelineDotCurrent: { borderColor: Colors.teal, borderWidth: 2 },
  timelineDotCheck: { color: Colors.white, fontSize: 13, fontWeight: '600' },
  timelineDotNum: { fontSize: 11, fontWeight: '500', color: Colors.teal },
  timelineLine: { flex: 1, width: 1.5, backgroundColor: Colors.border, marginVertical: 2 },
  timelineLineDone: { backgroundColor: Colors.teal },
  timelineContent: { flex: 1, paddingBottom: Spacing.md },
  timelineStepLabel: { fontSize: Typography.size.base, fontWeight: '500', color: Colors.text2, paddingTop: 5 },
  timelineStepDone: { color: Colors.teal },
  timelineStepCurrent: { color: Colors.text },
  timelineStepPending: { color: Colors.text4, fontWeight: '400' },
  timelineStepDesc: { fontSize: Typography.size.sm, color: Colors.text3, marginTop: 3, lineHeight: 17 },
  timelineMeetup: { fontSize: Typography.size.sm, color: Colors.teal, marginTop: 4, fontWeight: '500' },

  detailsCard: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 0.5, borderColor: Colors.border, padding: Spacing.lg,
  },
  detailsTitle: { fontSize: Typography.size.md, fontWeight: '500', color: Colors.text, marginBottom: Spacing.md },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.border2,
  },
  detailKey: { fontSize: Typography.size.sm, color: Colors.text3 },
  detailVal: { fontSize: Typography.size.sm, color: Colors.text, fontWeight: '500', flex: 1, textAlign: 'right' },

  tipsCard: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
    backgroundColor: Colors.tealLight, borderRadius: Radius.lg, padding: Spacing.lg,
  },
  tipsTitle: { fontSize: Typography.size.base, fontWeight: '500', color: Colors.tealText, marginBottom: Spacing.sm },
  tipRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: 5 },
  tipDot: { color: Colors.teal, fontSize: Typography.size.base },
  tipText: { flex: 1, fontSize: Typography.size.sm, color: Colors.tealText, lineHeight: 18 },

  actions: {
    paddingHorizontal: Spacing.lg, paddingBottom: 32, paddingTop: Spacing.md,
    borderTopWidth: 0.5, borderTopColor: Colors.border,
    backgroundColor: Colors.surface, gap: Spacing.sm,
  },
  cancelBtn: {
    padding: 13, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.error,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: Typography.size.base, color: Colors.error, fontWeight: '500' },
  primaryBtn: { padding: 14, borderRadius: Radius.md, backgroundColor: Colors.teal, alignItems: 'center' },
  primaryBtnText: { fontSize: Typography.size.md, color: Colors.white, fontWeight: '500' },
  rateBtn: {
    padding: 13, borderRadius: Radius.md, borderWidth: 0.5, borderColor: Colors.border,
    alignItems: 'center', backgroundColor: Colors.surface,
  },
  rateBtnText: { fontSize: Typography.size.base, color: Colors.text, fontWeight: '500' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: Typography.size.md, color: Colors.text3 },

  // Modals
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: Colors.surface, borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl, padding: Spacing.xl, paddingBottom: 40,
  },
  modalTitle: { fontSize: Typography.size.lg, fontWeight: '500', color: Colors.text, marginBottom: Spacing.sm },
  modalSub: { fontSize: Typography.size.base, color: Colors.text3, marginBottom: Spacing.md, lineHeight: 20 },
  modalInput: {
    backgroundColor: '#F5F5F3', borderRadius: Radius.md,
    padding: Spacing.md, fontSize: Typography.size.base, color: Colors.text,
    minHeight: 80, textAlignVertical: 'top', marginBottom: Spacing.md,
    borderWidth: 0.5, borderColor: Colors.border,
  },
  modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  modalCancelBtn: {
    flex: 1, padding: 13, borderRadius: Radius.md,
    borderWidth: 0.5, borderColor: Colors.border, alignItems: 'center',
  },
  modalCancelText: { fontSize: Typography.size.base, color: Colors.text2, fontWeight: '500' },
  modalConfirmBtn: { flex: 2, padding: 13, borderRadius: Radius.md, backgroundColor: Colors.teal, alignItems: 'center' },
  modalConfirmText: { fontSize: Typography.size.base, color: Colors.white, fontWeight: '500' },

  // Rating modal
  stars: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginBottom: Spacing.md },
  star: { fontSize: 32, color: Colors.border },
  starActive: { color: '#F59E0B' },
  rateLabel: { fontSize: Typography.size.base, fontWeight: '500', color: Colors.text, marginBottom: Spacing.sm },
  iadRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  iadBtn: {
    flex: 1, padding: 10, borderRadius: Radius.md,
    borderWidth: 0.5, borderColor: Colors.border, alignItems: 'center',
  },
  iadBtnActive: { backgroundColor: Colors.tealLight, borderColor: Colors.teal },
  iadText: { fontSize: Typography.size.sm, color: Colors.text2 },
  iadTextActive: { color: Colors.teal, fontWeight: '500' },
  rateNote: { fontSize: Typography.size.sm, color: Colors.text4, textAlign: 'center', marginBottom: Spacing.md, lineHeight: 17 },
});
