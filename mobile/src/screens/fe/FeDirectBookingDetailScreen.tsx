/**
 * Owmee Direct booking detail for Field Executives.
 *
 * This is intentionally separate from the legacy Concierge capture screen:
 * Direct acquisition is a controlled transaction with seller OTP, item QC,
 * seller final payout acceptance, Finance payout, and Warehouse/Admin gates.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera } from 'react-native-image-picker';

import {
  FE,
  type DirectAcquisitionBooking,
  type DirectAcquisitionItem,
  type DirectLocationPayload,
} from '../../services/api';
import { Button, IconButton, ScreenHeader } from '../../components/ui';
import type { RootScreen } from '../../navigation/types';
import { C, R, S, Shadow, T, formatPrice } from '../../utils/tokens';
import { parseApiError } from '../../utils/errors';
import {
  getBestCurrentLocationFix,
  requestFineLocationPermission,
} from '../../utils/locationGps';

function formatSlot(startIso: string, endIso: string): string {
  try {
    const start = new Date(startIso);
    const end = new Date(endIso);
    return `${start.toLocaleString('en-IN', {
      weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })} - ${end.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return `${startIso} - ${endIso}`;
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function isPayable(item: DirectAcquisitionItem): boolean {
  return item.item_status === 'qc_passed' || item.item_status === 'qc_revised';
}

function qcAnswersFor(item: DirectAcquisitionItem): Record<string, boolean> {
  const base = {
    matched_seller_photos: true,
    condition_confirmed: true,
    price_confirmed: true,
    custody_photo_captured: true,
  };
  if (item.category === 'toys') {
    return {
      ...base,
      parts_complete_or_disclosed: true,
      safety_issue_absent: true,
    };
  }
  if (item.category === 'books') {
    return {
      ...base,
      language_confirmed: true,
      pages_complete_or_disclosed: true,
    };
  }
  return base;
}

async function getDirectLocationPayload(): Promise<DirectLocationPayload> {
  const granted = await requestFineLocationPermission();
  if (!granted) {
    throw new Error('Location permission is required for Direct pickup custody steps.');
  }
  const fix = await getBestCurrentLocationFix();
  return {
    lat: fix.lat,
    lng: fix.lng,
    accuracy_meters: fix.accuracy,
    source: fix.source,
  };
}

async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const r = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Camera access',
        message: 'Owmee needs pickup photos before seller payout.',
        buttonPositive: 'OK',
        buttonNegative: 'Cancel',
      },
    );
    return r === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function uploadBytesViaPresigned(uploadUrl: string, localUri: string, contentType: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.timeout = 60000;
    // @ts-ignore React Native accepts file bodies in this shape.
    xhr.send({ uri: localUri, type: contentType, name: 'pickup.jpg' });
  });
}

export default function FeDirectBookingDetailScreen({
  route,
  navigation,
}: RootScreen<'FeDirectBookingDetail'>) {
  const { bookingId } = route.params;
  const [booking, setBooking] = useState<DirectAcquisitionBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [finalOtp, setFinalOtp] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await FE.directBooking(bookingId);
      setBooking(res.data);
    } catch (e) {
      setError(parseApiError(e, 'Could not load Direct booking.'));
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  const run = async (key: string, work: () => Promise<any>, success?: string) => {
    setBusy(key);
    try {
      await work();
      if (success) Alert.alert('Done', success);
      await load();
    } catch (e) {
      Alert.alert('Could not continue', parseApiError(e, 'Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const payableItems = useMemo(() => booking?.items.filter(isPayable) || [], [booking]);
  const pendingApprovals = useMemo(
    () => payableItems.filter((item) => item.approval_required && item.approval_status !== 'approved'),
    [payableItems],
  );
  const unresolvedItems = useMemo(
    () => booking?.items.filter((item) => ['pending_qc', 'approval_pending'].includes(item.item_status)) || [],
    [booking],
  );
  const missingPhotos = useMemo(
    () => payableItems.filter((item) => !item.pickup_photos || item.pickup_photos.length === 0),
    [payableItems],
  );
  const canRequestFinalAcceptance = !!booking
    && booking.status === 'pickup_qc_in_progress'
    && payableItems.length > 0
    && unresolvedItems.length === 0
    && pendingApprovals.length === 0
    && missingPhotos.length === 0
    && finalOtp.trim().length >= 4;

  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={['top']}>
        <View style={s.center}><ActivityIndicator color={C.petrol} /></View>
      </SafeAreaView>
    );
  }

  if (error || !booking) {
    return (
      <SafeAreaView style={s.root} edges={['top']}>
        <View style={s.center}>
          <Text style={s.error}>{error || 'Booking not found.'}</Text>
          <Button label="Back" onPress={() => navigation.goBack()} style={s.topGap} />
        </View>
      </SafeAreaView>
    );
  }

  const address = booking.pickup_address || {};
  const sellerVerified = ['seller_verified', 'pickup_qc_in_progress', 'seller_final_acceptance', 'payout_ready', 'payout_completed'].includes(booking.status);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <ScreenHeader
        title="Direct pickup"
        subtitle={booking.booking_code}
        onBack={() => navigation.goBack()}
        tone="canvas"
        right={<IconButton icon="refresh" onPress={load} a11y="Refresh booking" size="sm" variant="outlined" />}
      />

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scrollPad} showsVerticalScrollIndicator={false}>
          <View style={s.summaryCard}>
            <View style={s.rowBetween}>
              <View style={s.flex}>
                <Text style={s.statusEyebrow}>Status</Text>
                <Text style={s.statusText}>{statusLabel(booking.status)}</Text>
              </View>
              <View style={s.amountBox}>
                <Text style={s.amountLabel}>Offer</Text>
                <Text style={s.amount}>{formatPrice(booking.final_total_payout_inr || booking.estimated_total_offer_inr)}</Text>
              </View>
            </View>
            <Text style={s.meta}>{formatSlot(booking.slot_start, booking.slot_end)}</Text>
            <Text style={s.meta}>
              {[address.house, address.street, booking.pickup_locality, booking.pickup_pincode].filter(Boolean).join(', ')}
            </Text>
            <View style={s.manifestPill}>
              <Text style={s.manifestText}>{booking.item_count} item{booking.item_count === 1 ? '' : 's'} in manifest</Text>
            </View>
          </View>

          <Workflow booking={booking} />

          {booking.status === 'assigned_to_fe' ? (
            <Button
              label="Start route"
              onPress={() => run('start', async () => FE.startDirectBooking(booking.id, await getDirectLocationPayload()))}
              loading={busy === 'start'}
              disabled={!!busy}
              fullWidth
              style={s.actionGap}
            />
          ) : null}

          {booking.status === 'fe_en_route' ? (
            <Button
              label="Mark arrived"
              onPress={() => run('arrive', async () => FE.arriveDirectBooking(booking.id, await getDirectLocationPayload()))}
              loading={busy === 'arrive'}
              disabled={!!busy}
              fullWidth
              style={s.actionGap}
            />
          ) : null}

          {booking.status === 'fe_arrived' || booking.status === 'fe_en_route' ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Seller verification</Text>
              <Text style={s.bodyText}>Enter the OTP or booking code shown by the seller before QC.</Text>
              <TextInput
                value={otp}
                onChangeText={setOtp}
                placeholder="Seller OTP"
                keyboardType="number-pad"
                style={s.input}
                placeholderTextColor={C.text3}
              />
              <Button
                label="Verify seller"
                onPress={() => run('otp', () => FE.verifyDirectSellerOtp(booking.id, otp))}
                loading={busy === 'otp'}
                disabled={!!busy || otp.trim().length < 4}
                fullWidth
              />
            </View>
          ) : null}

          <Text style={s.sectionTitle}>Item QC</Text>
          {booking.items.map((item) => (
            <DirectItemCard
              key={item.id}
              booking={booking}
              item={item}
              sellerVerified={sellerVerified}
              busy={busy}
              run={run}
            />
          ))}

          <View style={s.card}>
            <Text style={s.cardTitle}>Seller final payout</Text>
            <Text style={s.bodyText}>
              Payable items: {payableItems.length}. Unresolved items: {unresolvedItems.length}. Pending approvals: {pendingApprovals.length}. Items missing pickup photos: {missingPhotos.length}.
            </Text>
            {booking.status === 'pickup_qc_in_progress' ? (
              <>
                <TextInput
                  value={finalOtp}
                  onChangeText={setFinalOtp}
                  placeholder="Seller final OTP"
                  keyboardType="number-pad"
                  style={s.input}
                  placeholderTextColor={C.text3}
                />
                <Button
                  label="Seller accepts final payout"
                  onPress={() => run(
                    'final',
                    async () => FE.directSellerFinalAcceptance(
                      booking.id,
                      true,
                      finalOtp,
                      await getDirectLocationPayload(),
                    ),
                  )}
                  disabled={!!busy || !canRequestFinalAcceptance}
                  loading={busy === 'final'}
                  fullWidth
                />
              </>
            ) : null}
            {booking.status === 'seller_final_acceptance' ? (
              <Button
                label="Send to Finance for payout"
                onPress={() => run('payout', () => FE.requestDirectPayout(booking.id))}
                disabled={!!busy}
                loading={busy === 'payout'}
                fullWidth
                style={s.topGap}
              />
            ) : null}
            {booking.status === 'payout_ready' ? (
              <Text style={s.bodyText}>Finance is reviewing this payout. Keep the item secured until warehouse receives it.</Text>
            ) : null}
            {booking.status === 'payout_completed' ? (
              <Text style={s.bodyText}>Payout is complete. Warehouse/Admin must scan and receive the item before it can move to listing approval.</Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Workflow({ booking }: { booking: DirectAcquisitionBooking }) {
  const steps = [
    { key: 'assigned', label: 'Assigned', done: !!booking.assigned_fe_id },
    { key: 'enroute', label: 'En route', done: ['fe_en_route', 'fe_arrived', 'seller_verified', 'pickup_qc_in_progress', 'seller_final_acceptance', 'payout_ready', 'payout_completed', 'booking_completed'].includes(booking.status) },
    { key: 'arrived', label: 'Arrived', done: ['fe_arrived', 'seller_verified', 'pickup_qc_in_progress', 'seller_final_acceptance', 'payout_ready', 'payout_completed', 'booking_completed'].includes(booking.status) },
    { key: 'verified', label: 'Seller verified', done: ['seller_verified', 'pickup_qc_in_progress', 'seller_final_acceptance', 'payout_ready', 'payout_completed', 'booking_completed'].includes(booking.status) },
    { key: 'qc', label: 'Item QC', done: booking.items.some(isPayable) },
    { key: 'final', label: 'Seller accepts payout', done: !!booking.final_total_payout_inr },
    { key: 'payout', label: 'Finance payout', done: ['payout_completed', 'booking_completed'].includes(booking.status) },
    { key: 'warehouse', label: 'Warehouse receive', done: booking.status === 'booking_completed' },
  ];
  return (
    <View style={s.workflow}>
      {steps.map((step, index) => (
        <View key={step.key} style={s.workflowItem}>
          <View style={[s.stepDot, step.done && s.stepDotDone]}>
            <Text style={[s.stepDotText, step.done && s.stepDotTextDone]}>{index + 1}</Text>
          </View>
          <Text style={[s.stepLabel, step.done && s.stepLabelDone]}>{step.label}</Text>
        </View>
      ))}
    </View>
  );
}

function DirectItemCard({
  booking,
  item,
  sellerVerified,
  busy,
  run,
}: {
  booking: DirectAcquisitionBooking;
  item: DirectAcquisitionItem;
  sellerVerified: boolean;
  busy: string | null;
  run: (key: string, work: () => Promise<any>, success?: string) => Promise<void>;
}) {
  const [revision, setRevision] = useState('');
  const [reason, setReason] = useState('');
  const itemBusy = busy?.endsWith(item.id);
  const hasPickupEvidence = item.pickup_photos.length >= Math.max(1, item.required_pickup_photos.length);
  const locked = !sellerVerified || ['rejected', 'warehouse_inbound', 'admin_approved'].includes(item.item_status);
  const needsApproval = item.approval_required && item.approval_status !== 'approved';

  const capturePickupPhoto = async () => {
    if (!sellerVerified) {
      Alert.alert('Verify seller first', 'Pickup photos are allowed only after seller OTP verification.');
      return;
    }
    const granted = await requestCameraPermission();
    if (!granted) {
      Alert.alert('Camera permission required', 'Grant camera permission to capture pickup evidence.');
      return;
    }
    await run(`photo-${item.id}`, async () => {
      const result = await new Promise<any>((resolve) => {
        launchCamera(
          { mediaType: 'photo', quality: 0.7, saveToPhotos: false, includeBase64: false },
          (r) => resolve(r),
        );
      });
      if (result?.didCancel) return;
      const localUri = result?.assets?.[0]?.uri;
      if (!localUri) throw new Error('No photo captured');
      const presign = await FE.requestDirectItemPhotoUpload(booking.id, item.id, 'image/jpeg');
      await uploadBytesViaPresigned(presign.data.upload_url, localUri, 'image/jpeg');
      await FE.addDirectItemPhotos(booking.id, item.id, [presign.data.r2_key]);
    });
  };

  return (
    <View style={s.card}>
      <View style={s.rowBetween}>
        <View style={s.flex}>
          <Text style={s.itemTitle}>{item.item_title}</Text>
          <Text style={s.meta}>{item.category} · {item.item_type}</Text>
        </View>
        <View style={s.itemAmountBox}>
          <Text style={s.amountLabel}>Payout</Text>
          <Text style={s.itemAmount}>{formatPrice(item.fe_final_offer_inr || item.owmee_suggested_offer_inr)}</Text>
        </View>
      </View>

      <View style={s.statusRow}>
        <Text style={s.statusChip}>{statusLabel(item.item_status)}</Text>
        {needsApproval ? <Text style={s.warningChip}>approval pending</Text> : null}
        {!hasPickupEvidence ? <Text style={s.warningChip}>photo needed</Text> : null}
      </View>

      {item.blocked_item_warnings.length > 0 ? (
        <Text style={s.warningText}>{item.blocked_item_warnings.join(', ')}</Text>
      ) : null}

      <Button
        label={`Capture pickup photo (${item.pickup_photos.length})`}
        variant="secondary"
        size="sm"
        onPress={capturePickupPhoto}
        disabled={!!busy || !sellerVerified}
        loading={busy === `photo-${item.id}`}
        fullWidth
        style={s.topGap}
      />

      <View style={s.itemActions}>
        <Button
          label="Accept QC"
          variant="primary"
          size="sm"
          onPress={() => run(
            `qc-${item.id}`,
            () => FE.directItemQc(booking.id, item.id, {
              qc_answers: qcAnswersFor(item),
              qc_notes: 'FE accepted item after physical QC.',
              pickup_photos: item.pickup_photos,
            }),
          )}
          disabled={!!busy || locked || !hasPickupEvidence}
          loading={busy === `qc-${item.id}`}
          style={s.flex}
        />
        <Button
          label="Reject"
          variant="destructive"
          size="sm"
          onPress={() => run(
            `reject-${item.id}`,
            () => FE.rejectDirectItem(booking.id, item.id, {
              reason_code: 'fe_qc_rejected',
              notes: 'Rejected during FE QC.',
              evidence_photos: item.pickup_photos,
            }),
          )}
          disabled={!!busy || locked || !hasPickupEvidence}
          loading={busy === `reject-${item.id}`}
          style={s.flex}
        />
      </View>

      <View style={s.revisionBox}>
        <Text style={s.revisionTitle}>Revise payout</Text>
        <View style={s.revisionRow}>
          <TextInput
            value={revision}
            onChangeText={setRevision}
            placeholder="Amount"
            keyboardType="number-pad"
            style={[s.input, s.revisionInput]}
            placeholderTextColor={C.text3}
          />
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Reason"
            style={[s.input, s.revisionReason]}
            placeholderTextColor={C.text3}
          />
        </View>
        <Button
          label="Submit revision"
          variant="secondary"
          size="sm"
          onPress={() => run(
            `revise-${item.id}`,
            () => FE.reviseDirectItemOffer(booking.id, item.id, {
              revised_offer_inr: Number(revision),
              reason_code: reason.trim() || 'condition_adjustment',
              evidence_photos: item.pickup_photos,
            }),
          )}
          disabled={!!busy || locked || !Number(revision) || !hasPickupEvidence}
          loading={itemBusy && busy?.startsWith('revise-')}
          fullWidth
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bone },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: S.xl },
  error: { color: C.red, fontSize: T.body, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    gap: S.sm,
  },
  headerText: { flex: 1 },
  h1: { fontSize: T.h3, fontWeight: T.weight.bold, color: C.text },
  subtitle: { fontSize: T.small, color: C.text3, marginTop: 2 },
  scrollPad: { padding: S.lg, paddingBottom: S.xxxl },
  summaryCard: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: S.md },
  statusEyebrow: { fontSize: T.small, color: C.text3, fontWeight: T.weight.semi, textTransform: 'uppercase' },
  statusText: { fontSize: T.h3, color: C.text, fontWeight: T.weight.bold, textTransform: 'capitalize', marginTop: 2 },
  amountBox: { alignItems: 'flex-end' },
  itemAmountBox: { alignItems: 'flex-end', minWidth: 94 },
  amountLabel: { fontSize: T.small, color: C.text3, fontWeight: T.weight.semi },
  amount: { fontSize: T.h2, color: C.petrolDeep, fontWeight: T.weight.heavy },
  itemAmount: { fontSize: T.h3, color: C.petrolDeep, fontWeight: T.weight.heavy },
  meta: { fontSize: T.body, color: C.text2, marginTop: S.xs, lineHeight: 20 },
  manifestPill: {
    alignSelf: 'flex-start',
    backgroundColor: C.petrolLight,
    paddingHorizontal: S.md,
    paddingVertical: 6,
    borderRadius: R.pill,
    marginTop: S.md,
  },
  manifestText: { color: C.petrolDeep, fontSize: T.small, fontWeight: T.weight.bold },
  workflow: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.md,
    marginBottom: S.md,
    ...Shadow.subtle,
  },
  workflowItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: C.border2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: S.sm,
  },
  stepDotDone: { backgroundColor: C.petrolDeep, borderColor: C.petrolDeep },
  stepDotText: { fontSize: T.small, color: C.text3, fontWeight: T.weight.bold },
  stepDotTextDone: { color: C.white },
  stepLabel: { fontSize: T.body, color: C.text2 },
  stepLabelDone: { color: C.text, fontWeight: T.weight.semi },
  card: {
    backgroundColor: C.surface,
    borderRadius: R.lg,
    padding: S.lg,
    marginBottom: S.md,
    ...Shadow.glow,
  },
  cardTitle: { fontSize: T.h3, color: C.text, fontWeight: T.weight.bold },
  bodyText: { fontSize: T.body, color: C.text2, lineHeight: 21, marginTop: S.xs },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    color: C.text,
    backgroundColor: C.white,
    marginVertical: S.md,
  },
  sectionTitle: { fontSize: T.h3, fontWeight: T.weight.bold, color: C.text, marginBottom: S.sm },
  itemTitle: { fontSize: T.h3, fontWeight: T.weight.bold, color: C.text, flex: 1 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: S.xs, marginTop: S.md },
  statusChip: {
    backgroundColor: C.petrolLight,
    color: C.petrolDeep,
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderRadius: R.pill,
    fontSize: T.small,
    fontWeight: T.weight.bold,
    textTransform: 'capitalize',
  },
  warningChip: {
    backgroundColor: C.redLight,
    color: C.red,
    paddingHorizontal: S.sm,
    paddingVertical: 4,
    borderRadius: R.pill,
    fontSize: T.small,
    fontWeight: T.weight.bold,
  },
  warningText: { color: C.red, fontSize: T.small, marginTop: S.sm },
  itemActions: { flexDirection: 'row', gap: S.sm, marginTop: S.md },
  revisionBox: {
    marginTop: S.md,
    borderTopWidth: 1,
    borderTopColor: C.border2,
    paddingTop: S.md,
  },
  revisionTitle: { color: C.text, fontSize: T.body, fontWeight: T.weight.semi },
  revisionRow: { flexDirection: 'row', gap: S.sm },
  revisionInput: { flex: 0.45 },
  revisionReason: { flex: 1 },
  actionGap: { marginBottom: S.md },
  topGap: { marginTop: S.md },
});
