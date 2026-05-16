/**
 * FeOpsScreen — Sprint 6c FE post-purchase tasks.
 *
 * Two tabs: collections + deliveries. Each item gets a one-tap detail
 * sheet where the FE captures photos + (for delivery) asks the buyer
 * for the 6-digit delivery code. Photos use the existing
 * fe-visits image-request/confirm endpoints because they're already
 * scoped to FE auth and write to the right R2 prefix; we don't need
 * a separate transaction-image upload pipeline yet.
 *
 * Where the existing FeHomeScreen handles pre-listing visits, this
 * screen owns the after-payment flow: FE collection → at hub, then later
 * FE delivery → delivered.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, RefreshControl,
  StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera } from 'react-native-image-picker';

import { FE, type FePickup } from '../../services/api';
import { Button, Chip, IconButton } from '../../components/ui';
import { C, R, S, T } from '../../utils/tokens';
import type { RootScreen } from '../../navigation/types';

type Tab = 'pickups' | 'deliveries' | 'returns';

export default function FeOpsScreen({ navigation }: RootScreen<'FeOps'>) {
  const [tab, setTab] = useState<Tab>('pickups');
  const [pickups, setPickups] = useState<FePickup[]>([]);
  const [deliveries, setDeliveries] = useState<FePickup[]>([]);
  const [returns, setReturns] = useState<FePickup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState<{ kind: Tab; item: FePickup } | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, d, r] = await Promise.all([
        FE.myPickups(), FE.myDeliveries(), FE.myReturnPickups(),
      ]);
      setPickups(p.data.pickups);
      setDeliveries(d.data.deliveries);
      setReturns(r.data.return_pickups);
    } catch {
      // Surface on next iteration; keep silent so the screen still mounts
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => { reload(); }, [reload]);

  const list = tab === 'pickups' ? pickups : tab === 'deliveries' ? deliveries : returns;
  const empty = tab === 'pickups'
    ? 'No collections assigned to you right now.'
    : tab === 'deliveries'
      ? 'No deliveries assigned to you right now.'
      : 'No return collections assigned to you right now.';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <IconButton icon="←" onPress={() => navigation.goBack()} a11y="Back" size="sm" />
        <Text style={s.title}>My ops</Text>
      </View>

      <View style={s.tabs}>
        <Chip
          label={`Collections (${pickups.length})`}
          selected={tab === 'pickups'}
          variant="filter"
          onPress={() => setTab('pickups')}
        />
        <Chip
          label={`Deliveries (${deliveries.length})`}
          selected={tab === 'deliveries'}
          variant="filter"
          onPress={() => setTab('deliveries')}
        />
        <Chip
          label={`Returns (${returns.length})`}
          selected={tab === 'returns'}
          variant="filter"
          onPress={() => setTab('returns')}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={C.petrol} style={s.loading} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={i => i.transaction_id}
          contentContainerStyle={s.listPadding}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} tintColor={C.petrol} />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.emptyText}>{empty}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={s.card} onPress={() => setActive({ kind: tab, item })}>
              <Text style={s.cardTitle} numberOfLines={1}>{item.listing_title || 'Item'}</Text>
              <Text style={s.cardMeta}>₹{item.gross_amount}</Text>
              {tab === 'deliveries' && item.delivery_mode === 'courier' && (
                <Text style={s.cardWarn}>Courier delivery — admin handles this</Text>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      {active && active.kind === 'pickups' && (
        <PickupSheet item={active.item} onClose={() => setActive(null)} onDone={() => { setActive(null); reload(); }} />
      )}
      {active && active.kind === 'deliveries' && (
        <DeliverySheet item={active.item} onClose={() => setActive(null)} onDone={() => { setActive(null); reload(); }} />
      )}
      {active && active.kind === 'returns' && (
        <ReturnPickupSheet item={active.item} onClose={() => setActive(null)} onDone={() => { setActive(null); reload(); }} />
      )}
    </SafeAreaView>
  );
}

// ── Return collection detail + complete ──────────────────────────────────────
// Simpler than the original collection: no inspection (item is being returned,
// inspection already happened during the original logistics step), no buyer ack code (the
// buyer is just handing the item back). FE confirms collection → refund auto-fires.

function ReturnPickupSheet({ item, onClose, onDone }: { item: FePickup; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await FE.completeReturnPickup(item.transaction_id);
      onDone();
    } catch (e: any) {
      Alert.alert('Could not complete', String(e?.response?.data?.detail?.error || 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.sheetBg}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>{item.listing_title || 'Return collection'}</Text>
          <Text style={s.sheetSub}>₹{item.gross_amount} · returning to Owmee</Text>

          <Text style={s.rowLabel}>Confirm collection from buyer</Text>
          <Text style={s.hint}>
            Confirm only after you have the item in hand. The buyer's refund fires automatically.
          </Text>

          <View style={s.sheetActions}>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={onClose}
              style={s.actionGhost}
            />
            <Button
              label="Item collected → refund buyer"
              variant="primary"
              loading={busy}
              disabled={busy}
              onPress={submit}
              style={s.actionPrimary}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Collection detail + complete ─────────────────────────────────────────────

function PickupSheet({ item, onClose, onDone }: { item: FePickup; onClose: () => void; onDone: () => void }) {
  const [passed, setPassed] = useState(true);
  const [notes, setNotes] = useState('');
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const addPhoto = async () => {
    try {
      // Reuse the fe-visits image upload pipeline. We treat each collection as
      // a virtual "visit" only for image storage — backend doesn't care.
      const result = await launchCamera({ mediaType: 'photo', quality: 0.8, saveToPhotos: false });
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      const sortOrder = photoKeys.length;
      const reqRes = await FE.requestVisitImage(item.transaction_id, 'image/jpeg', sortOrder);
      const { upload_url, r2_key } = reqRes.data;
      const blob = await (await fetch(uri)).blob();
      await fetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      await FE.confirmVisitImage(item.transaction_id, r2_key, sortOrder);
      setPhotoKeys(prev => [...prev, r2_key]);
    } catch (e) {
      Alert.alert('Photo upload failed', 'Try again. Make sure you\'re online.');
    }
  };

  const submit = async () => {
    if (passed && photoKeys.length < 1) {
      Alert.alert('Photos required', 'Take at least one inspection photo before marking pass.');
      return;
    }
    setBusy(true);
    try {
      await FE.completePickup(item.transaction_id, {
        inspection_passed: passed,
        inspection_notes: notes,
        inspection_photo_keys: photoKeys,
      });
      onDone();
    } catch (e: any) {
      Alert.alert('Could not complete', String(e?.response?.data?.detail?.error || 'Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.sheetBg}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>{item.listing_title || 'Collection'}</Text>
          <Text style={s.sheetSub}>₹{item.gross_amount}</Text>

          <View style={s.row}>
            <Text style={s.rowLabel}>Inspection passed</Text>
            <Switch value={passed} onValueChange={setPassed} thumbColor={C.petrol} />
          </View>

          <Text style={s.rowLabel}>Notes</Text>
          <TextInput
            style={s.input}
            value={notes}
            onChangeText={setNotes}
            placeholder={passed ? 'Item matches listing, condition matches' : 'Why collection is being rejected'}
            placeholderTextColor={C.text4}
            multiline
          />

          <Text style={s.rowLabel}>Inspection photos ({photoKeys.length})</Text>
          <Button
            label="+ Add photo"
            variant="secondary"
            onPress={addPhoto}
          />

          <View style={s.sheetActions}>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={onClose}
              style={s.actionGhost}
            />
            <Button
              label={passed ? 'Mark passed → at hub' : 'Reject collection'}
              variant="primary"
              loading={busy}
              disabled={busy}
              onPress={submit}
              style={s.actionPrimary}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Delivery detail + complete ───────────────────────────────────────────────

function DeliverySheet({ item, onClose, onDone }: { item: FePickup; onClose: () => void; onDone: () => void }) {
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [ackCode, setAckCode] = useState('');
  const [busy, setBusy] = useState(false);

  const addPhoto = async () => {
    try {
      const result = await launchCamera({ mediaType: 'photo', quality: 0.8, saveToPhotos: false });
      const uri = result.assets?.[0]?.uri;
      if (!uri) return;
      const reqRes = await FE.requestVisitImage(item.transaction_id, 'image/jpeg', 0);
      const { upload_url, r2_key } = reqRes.data;
      const blob = await (await fetch(uri)).blob();
      await fetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      await FE.confirmVisitImage(item.transaction_id, r2_key, 0);
      setPhotoKey(r2_key);
    } catch {
      Alert.alert('Photo upload failed', 'Try again.');
    }
  };

  const submit = async () => {
    if (!photoKey) {
      Alert.alert('Delivery photo required', 'Take a photo of the item being delivered.');
      return;
    }
    if (ackCode.length < 6) {
      Alert.alert('Ack code', 'Ask the buyer for their 6-digit delivery code.');
      return;
    }
    setBusy(true);
    try {
      await FE.completeDelivery(item.transaction_id, { handover_photo_key: photoKey, ack_code: ackCode });
      onDone();
    } catch (e: any) {
      const code = String(e?.response?.data?.detail?.error || '');
      if (code === 'ACK_CODE_MISMATCH') {
        Alert.alert('Wrong code', 'The buyer\'s code doesn\'t match. Ask them to read it again from their Owmee app.');
      } else {
        Alert.alert('Could not complete', code || 'Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.sheetBg}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>{item.listing_title || 'Delivery'}</Text>
          <Text style={s.sheetSub}>₹{item.gross_amount}</Text>

          {/* Recipient details — surface buyer name/phone + order notes so
             the FE agent knows whose name is on the package and any
             gate/parking instructions before they ring the bell. */}
          {(item.buyer_name || item.buyer_phone || item.order_notes) ? (
            <View style={s.recipientCard}>
              {item.buyer_name ? (
                <Text style={s.recipientName}>📦 Hand to: {item.buyer_name}</Text>
              ) : null}
              {item.buyer_phone ? (
                <Text style={s.recipientPhone}>📞 +91 {item.buyer_phone}</Text>
              ) : null}
              {item.order_notes ? (
                <Text style={s.recipientNotes}>📝 {item.order_notes}</Text>
              ) : null}
            </View>
          ) : null}

          <Text style={s.rowLabel}>Delivery photo</Text>
          <Button
            label={photoKey ? '✓ Photo captured' : '+ Take delivery photo'}
            variant="secondary"
            onPress={addPhoto}
          />

          <Text style={[s.rowLabel, s.spacedRow]}>
            Buyer's 6-digit code
          </Text>
          <Text style={s.hint}>
            Ask the buyer to open their Owmee app and read out the code on the order screen.
          </Text>
          <TextInput
            style={[s.input, s.codeInput]}
            value={ackCode}
            onChangeText={(t) => setAckCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="••••••"
            placeholderTextColor={C.text4}
          />

          <View style={s.sheetActions}>
            <Button
              label="Cancel"
              variant="ghost"
              onPress={onClose}
              style={s.actionGhost}
            />
            <Button
              label="Complete delivery"
              variant="primary"
              loading={busy}
              disabled={busy}
              onPress={submit}
              style={s.actionPrimary}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  loading: { marginTop: S.xxxl + S.xxxl },
  header: {
    paddingHorizontal: S.lg, paddingVertical: S.md,
    flexDirection: 'row', alignItems: 'center', gap: S.md,
  },
  title: { fontSize: T.size.lg + 1, fontWeight: T.weight.bold, color: C.text },

  tabs: { flexDirection: 'row', paddingHorizontal: S.lg, gap: S.sm, marginBottom: S.sm },

  listPadding: { padding: S.lg },
  card: {
    backgroundColor: C.surface, borderRadius: R.sm,
    padding: S.lg, marginBottom: S.sm + 2,
    borderWidth: 1, borderColor: C.border,
  },
  cardTitle: { fontSize: T.size.md, fontWeight: T.weight.semi, color: C.text },
  cardMeta: { fontSize: T.size.base, color: C.text3, marginTop: S.xs },
  cardWarn: { fontSize: T.size.sm, color: C.petrol, marginTop: S.xs + 2, fontStyle: 'italic' },

  empty: { padding: S.xxxl + S.xxl, alignItems: 'center' },
  emptyText: { color: C.text4, fontSize: T.size.sm + 1 },

  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.bone,
    borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg,
    padding: S.xxl, paddingBottom: S.xxxl + S.xs,
  },
  sheetTitle: { fontSize: T.size.lg + 1, fontWeight: T.weight.bold, color: C.text },
  sheetSub: { fontSize: T.size.sm + 1, color: C.text3, marginBottom: S.lg },

  recipientCard: {
    backgroundColor: C.petrolLight,
    padding: S.md,
    borderRadius: R.md,
    marginBottom: S.lg,
    gap: 4,
  },
  recipientName: { fontSize: T.size.md, fontWeight: T.weight.bold, color: C.petrolDeep },
  recipientPhone: { fontSize: T.size.base, color: C.petrolDeep, fontWeight: T.weight.semi },
  recipientNotes: { fontSize: T.size.sm + 1, color: C.text2, marginTop: 4, fontStyle: 'italic' },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: S.md },
  rowLabel: { fontSize: T.size.base, fontWeight: T.weight.semi, color: C.text2, marginTop: S.sm, marginBottom: S.xs },
  spacedRow: { marginTop: S.lg },
  hint: { fontSize: T.size.sm, color: C.text4, marginBottom: S.sm },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: R.xs + 2,
    padding: S.md, color: C.text, minHeight: 44,
  },
  codeInput: {
    fontSize: T.size.xxl,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: T.weight.bold,
  },

  sheetActions: { flexDirection: 'row', gap: S.md, marginTop: S.xl },
  actionGhost: { flex: 1 },
  actionPrimary: { flex: 2 },
});
