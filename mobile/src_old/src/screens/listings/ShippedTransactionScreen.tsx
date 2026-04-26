/**
 * ShippedTransactionScreen
 *
 * Phase 2 — managed shipped flow for portable categories.
 *
 * State machine displayed:
 *   payment_captured → shipment_created → in_transit
 *     → delivered → buyer_accepted | disputed
 *
 * India UX:
 * - "Your money is safe" reassurance at every step
 * - 48h dispute window countdown visible
 * - TDS breakdown shown to seller on payout
 * - Razorpay payment link opens in browser for initial payment
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, Linking, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Spacing, Radius, Typography } from '../../utils/tokens';
import { Transactions } from '../../services/api';
import type { Transaction } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import axios from 'axios';

import { API_BASE_URL as BASE_URL } from '../../config';

// ── Shipped status steps ────────────────────────────────────────────────────

const SHIPPED_STEPS = [
  { key: 'payment_captured', label: 'Payment confirmed', icon: '✓' },
  { key: 'shipment_created', label: 'Pickup scheduled', icon: '📦' },
  { key: 'picked_up',        label: 'Item picked up',   icon: '🚚' },
  { key: 'in_transit',       label: 'In transit',       icon: '→' },
  { key: 'delivered',        label: 'Delivered',        icon: '🏠' },
  { key: 'buyer_accepted',   label: 'Deal complete',    icon: '✓' },
];

const STATUS_STEP_MAP: Record<string, number> = {
  payment_captured: 0,
  shipment_created: 1,
  picked_up: 2,
  in_transit: 3,
  delivered: 4,
  buyer_accepted: 5,
  disputed: 4,
};

function stepIndex(status: string): number {
  return STATUS_STEP_MAP[status] ?? 0;
}

function timeLeft(iso?: string): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Window closed';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m remaining`;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ShippedTransactionScreen({ route, navigation }: any) {
  const { transactionId } = route.params;
  const { userId, accessToken } = useAuthStore();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [shipment, setShipment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showInitiateModal, setShowInitiateModal] = useState(false);
  const [pickupAddress, setPickupAddress] = useState('');
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const load = useCallback(async () => {
    try {
      const [txnRes, shipRes] = await Promise.allSettled([
        Transactions.get(transactionId),
        axios.get(`${BASE_URL}/v1/transactions/${transactionId}/shipment`, { headers: authHeader }),
      ]);
      if (txnRes.status === 'fulfilled') setTxn(txnRes.value.data);
      if (shipRes.status === 'fulfilled') setShipment(shipRes.value.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [transactionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={Colors.teal} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (!txn) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>Transaction not found</Text>
      </SafeAreaView>
    );
  }

  const isBuyer = txn.buyer_id === userId;
  const isSeller = txn.seller_id === userId;
  const currentStep = stepIndex(txn.status);
  const isTerminal = ['buyer_accepted', 'disputed', 'refunded', 'cancelled'].includes(txn.status);

  // ── Seller: initiate shipment ─────────────────────────────────────────────

  const handleInitiateShipment = async () => {
    if (!pickupAddress.trim()) {
      Alert.alert('Address required', 'Enter the pickup address for the logistics partner.');
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(
        `${BASE_URL}/v1/transactions/${transactionId}/ship`,
        { pickup_address: pickupAddress, logistics_provider: 'shiprocket' },
        { headers: authHeader },
      );
      setShowInitiateModal(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail?.message || 'Could not initiate shipment');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Buyer: accept delivery ────────────────────────────────────────────────

  const handleAcceptDelivery = () => {
    Alert.alert(
      'Confirm delivery',
      'Have you received the item in the condition described?',
      [
        { text: 'Raise dispute', style: 'destructive', onPress: () => setShowDisputeModal(true) },
        {
          text: 'Accept delivery',
          onPress: async () => {
            setSubmitting(true);
            try {
              const res = await axios.post(
                `${BASE_URL}/v1/transactions/${transactionId}/accept-delivery`,
                { accepted: true },
                { headers: authHeader },
              );
              const payout = res.data.payout_breakdown;
              if (payout) {
                Alert.alert(
                  'Delivery accepted!',
                  `Payout to seller:\n₹${Number(payout.gross_amount).toLocaleString('en-IN')} gross\n` +
                  `- ₹${Number(payout.platform_fee).toLocaleString('en-IN')} platform fee\n` +
                  `- ₹${Number(payout.tds_withheld).toLocaleString('en-IN')} TDS\n` +
                  `= ₹${Number(payout.net_payout).toLocaleString('en-IN')} net payout`,
                );
              }
              load();
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.detail?.message || 'Could not accept delivery');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  };

  const handleSubmitDispute = async () => {
    if (disputeReason.trim().length < 10) {
      Alert.alert('More detail needed', 'Describe the issue in at least 10 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(
        `${BASE_URL}/v1/transactions/${transactionId}/accept-delivery`,
        { accepted: false, reason: disputeReason },
        { headers: authHeader },
      );
      setShowDisputeModal(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail?.message || 'Could not raise dispute');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shipped transaction</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Trust banner */}
        <View style={styles.trustBanner}>
          <Text style={styles.trustIcon}>🔒</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.trustTitle}>Protected transaction</Text>
            <Text style={styles.trustSub}>
              {isBuyer
                ? 'Your payment is held safely. Released only when you confirm delivery.'
                : 'Payout released after buyer confirms receipt. TDS deducted per Section 194-O.'}
            </Text>
          </View>
        </View>

        {/* Status timeline */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Shipment status</Text>
          {SHIPPED_STEPS.map((step, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            const isDisputed = txn.status === 'disputed' && i === 4;
            return (
              <View key={step.key} style={styles.stepRow}>
                <View style={styles.stepLeft}>
                  <View style={[
                    styles.stepDot,
                    done && styles.stepDotDone,
                    active && styles.stepDotActive,
                    isDisputed && styles.stepDotDisputed,
                  ]}>
                    <Text style={[styles.stepDotText, (done || active) && styles.stepDotTextActive]}>
                      {done ? '✓' : isDisputed ? '!' : step.icon}
                    </Text>
                  </View>
                  {i < SHIPPED_STEPS.length - 1 && (
                    <View style={[styles.stepLine, done && styles.stepLineDone]} />
                  )}
                </View>
                <View style={styles.stepContent}>
                  <Text style={[styles.stepLabel, (done || active) && styles.stepLabelActive]}>
                    {isDisputed ? 'Disputed' : step.label}
                  </Text>
                  {active && txn.buyer_acceptance_deadline && i === 4 && (
                    <Text style={styles.stepTimer}>
                      ⏱ {timeLeft(txn.buyer_acceptance_deadline)}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Shipment details */}
        {shipment && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Shipment details</Text>
            {shipment.logistics_provider && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Carrier</Text>
                <Text style={styles.detailValue}>{shipment.logistics_provider}</Text>
              </View>
            )}
            {shipment.tracking_id && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Tracking ID</Text>
                <Text style={[styles.detailValue, styles.mono]}>{shipment.tracking_id}</Text>
              </View>
            )}
            {shipment.pickup_address && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Pickup address</Text>
                <Text style={styles.detailValue}>{shipment.pickup_address}</Text>
              </View>
            )}
          </View>
        )}

        {/* Payout breakdown for seller */}
        {isSeller && txn.net_payout && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Payout breakdown</Text>
            <View style={styles.payoutRow}>
              <Text style={styles.payoutLabel}>Gross amount</Text>
              <Text style={styles.payoutValue}>₹{Number(txn.gross_amount).toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.payoutRow}>
              <Text style={styles.payoutLabel}>Platform fee (2%)</Text>
              <Text style={styles.payoutDeduct}>- ₹{Number(txn.platform_fee).toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.payoutRow}>
              <Text style={styles.payoutLabel}>GST on fee (18%)</Text>
              <Text style={styles.payoutDeduct}>- ₹{Number(txn.gst_on_fee).toLocaleString('en-IN')}</Text>
            </View>
            <View style={styles.payoutRow}>
              <Text style={styles.payoutLabel}>TDS 194-O (1%)</Text>
              <Text style={styles.payoutDeduct}>- ₹{Number(txn.tds_withheld).toLocaleString('en-IN')}</Text>
            </View>
            <View style={[styles.payoutRow, styles.payoutTotal]}>
              <Text style={styles.payoutTotalLabel}>Net payout</Text>
              <Text style={styles.payoutTotalValue}>₹{Number(txn.net_payout).toLocaleString('en-IN')}</Text>
            </View>
            <Text style={styles.tdsNote}>
              TDS certificate (Form 16A) will be available in your dashboard.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* CTAs */}
      {!isTerminal && (
        <View style={styles.footer}>
          {isSeller && txn.status === 'payment_captured' && (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setShowInitiateModal(true)}
            >
              <Text style={styles.primaryBtnText}>Schedule pickup →</Text>
            </TouchableOpacity>
          )}
          {isBuyer && txn.status === 'delivered' && (
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleAcceptDelivery}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.primaryBtnText}>Confirm delivery →</Text>
              }
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Initiate shipment modal */}
      <Modal visible={showInitiateModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Schedule pickup</Text>
            <Text style={styles.modalSub}>
              The logistics partner will collect the item from this address.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Full pickup address"
              placeholderTextColor={Colors.text4}
              value={pickupAddress}
              onChangeText={setPickupAddress}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setShowInitiateModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, submitting && styles.btnDisabled]}
                onPress={handleInitiateShipment}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.modalConfirmText}>Confirm</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Dispute modal */}
      <Modal visible={showDisputeModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Raise a dispute</Text>
            <Text style={styles.modalSub}>
              Describe the issue. Our team will review within 48 hours.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Item is damaged / not as described"
              placeholderTextColor={Colors.text4}
              value={disputeReason}
              onChangeText={setDisputeReason}
              multiline
              numberOfLines={4}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setShowDisputeModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmRed, submitting && styles.btnDisabled]}
                onPress={handleSubmitDispute}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={styles.modalConfirmText}>Raise dispute</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 28, color: Colors.text, lineHeight: 32 },
  headerTitle: { fontSize: 15, fontWeight: '600', color: Colors.text },
  errorText: { fontSize: 14, color: Colors.text3, textAlign: 'center', marginTop: 60 },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.md },

  trustBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md,
    backgroundColor: '#E8F8F3', borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 0.5, borderColor: Colors.teal + '40',
  },
  trustIcon: { fontSize: 20, marginTop: 1 },
  trustTitle: { fontSize: 13, fontWeight: '600', color: Colors.teal, marginBottom: 2 },
  trustSub: { fontSize: 12, color: Colors.text2, lineHeight: 17 },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.lg, borderWidth: 0.5, borderColor: Colors.border,
  },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: Spacing.md },

  stepRow: { flexDirection: 'row', gap: Spacing.md, minHeight: 44 },
  stepLeft: { alignItems: 'center', width: 24 },
  stepDot: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.border2, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  stepDotActive: { backgroundColor: Colors.tealLight, borderColor: Colors.teal },
  stepDotDisputed: { backgroundColor: '#FFF0EE', borderColor: Colors.error },
  stepDotText: { fontSize: 10, color: Colors.text4 },
  stepDotTextActive: { color: Colors.teal },
  stepLine: { width: 2, flex: 1, backgroundColor: Colors.border, marginTop: 2 },
  stepLineDone: { backgroundColor: Colors.teal },
  stepContent: { flex: 1, paddingBottom: Spacing.md },
  stepLabel: { fontSize: 13, color: Colors.text3, paddingTop: 3 },
  stepLabelActive: { color: Colors.text, fontWeight: '500' },
  stepTimer: { fontSize: 11, color: Colors.warm, marginTop: 2, fontWeight: '500' },

  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: Spacing.xs, borderTopWidth: 0.5, borderTopColor: Colors.border2,
  },
  detailLabel: { fontSize: 12, color: Colors.text3 },
  detailValue: { fontSize: 12, color: Colors.text, maxWidth: '60%', textAlign: 'right' },
  mono: { fontFamily: 'Courier', letterSpacing: 0.5 },

  payoutRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  payoutLabel: { fontSize: 13, color: Colors.text2 },
  payoutValue: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  payoutDeduct: { fontSize: 13, color: Colors.error },
  payoutTotal: {
    borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.xs, paddingTop: Spacing.sm,
  },
  payoutTotalLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  payoutTotalValue: { fontSize: 16, fontWeight: '700', color: Colors.teal },
  tdsNote: { fontSize: 11, color: Colors.text4, marginTop: Spacing.sm, lineHeight: 15 },

  footer: { padding: Spacing.lg, borderTopWidth: 0.5, borderTopColor: Colors.border },
  primaryBtn: {
    backgroundColor: Colors.teal, borderRadius: Radius.md,
    padding: Spacing.md, alignItems: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '500', color: Colors.white },

  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: Colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.xl, paddingBottom: 32, gap: Spacing.md,
  },
  modalTitle: { fontSize: 17, fontWeight: '600', color: Colors.text },
  modalSub: { fontSize: 13, color: Colors.text3, lineHeight: 18, marginTop: -4 },
  modalInput: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 0.5, borderColor: Colors.border,
    padding: Spacing.md, fontSize: 14, color: Colors.text,
    minHeight: 80, textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: Spacing.sm },
  modalCancel: {
    flex: 1, padding: 13, borderRadius: Radius.md,
    borderWidth: 0.5, borderColor: Colors.border, alignItems: 'center',
  },
  modalCancelText: { fontSize: 14, color: Colors.text2, fontWeight: '500' },
  modalConfirm: {
    flex: 2, padding: 13, borderRadius: Radius.md,
    backgroundColor: Colors.teal, alignItems: 'center',
  },
  modalConfirmRed: {
    flex: 2, padding: 13, borderRadius: Radius.md,
    backgroundColor: Colors.error, alignItems: 'center',
  },
  modalConfirmText: { fontSize: 14, color: Colors.white, fontWeight: '500' },
  btnDisabled: { opacity: 0.5 },
});
