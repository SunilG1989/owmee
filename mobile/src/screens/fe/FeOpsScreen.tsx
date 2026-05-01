/**
 * FeOpsScreen — Sprint 6c FE post-purchase tasks.
 *
 * Two tabs: pickups + deliveries. Each item gets a one-tap detail
 * sheet where the FE captures photos + (for delivery) asks the buyer
 * for the 6-digit handover code. Photos use the existing
 * fe-visits image-request/confirm endpoints because they're already
 * scoped to FE auth and write to the right R2 prefix; we don't need
 * a separate transaction-image upload pipeline yet.
 *
 * Where the existing FeHomeScreen handles pre-listing visits, this
 * screen owns the after-payment flow: FE pickup → at hub, then later
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
    ? 'No pickups assigned to you right now.'
    : tab === 'deliveries'
      ? 'No deliveries assigned to you right now.'
      : 'No return pickups assigned to you right now.';

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={s.back}>←</Text>
        </TouchableOpacity>
        <Text style={s.title}>My ops</Text>
      </View>

      <View style={s.tabs}>
        <TouchableOpacity
          style={[s.tab, tab === 'pickups' && s.tabOn]}
          onPress={() => setTab('pickups')}
        >
          <Text style={[s.tabText, tab === 'pickups' && s.tabTextOn]}>
            Pickups ({pickups.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, tab === 'deliveries' && s.tabOn]}
          onPress={() => setTab('deliveries')}
        >
          <Text style={[s.tabText, tab === 'deliveries' && s.tabTextOn]}>
            Deliveries ({deliveries.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, tab === 'returns' && s.tabOn]}
          onPress={() => setTab('returns')}
        >
          <Text style={[s.tabText, tab === 'returns' && s.tabTextOn]}>
            Returns ({returns.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={C.honey} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={i => i.transaction_id}
          contentContainerStyle={{ padding: 16 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} tintColor={C.honey} />
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

// ── Return pickup detail + complete ──────────────────────────────────────────
// Simpler than the original pickup: no inspection (item is being returned,
// inspection already happened at original pickup), no buyer ack code (the
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
          <Text style={s.sheetTitle}>{item.listing_title || 'Return pickup'}</Text>
          <Text style={s.sheetSub}>₹{item.gross_amount} · returning to Owmee</Text>

          <Text style={s.rowLabel}>Confirm collection from buyer</Text>
          <Text style={s.hint}>
            Confirm only after you have the item in hand. The buyer's refund fires automatically.
          </Text>

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
            <TouchableOpacity style={[s.btnGhost, { flex: 1 }]} onPress={onClose}>
              <Text style={s.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnPrimary, { flex: 2 }, busy && s.btnDisabled]} disabled={busy} onPress={submit}>
              <Text style={s.btnPrimaryText}>Item collected → refund buyer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Pickup detail + complete ─────────────────────────────────────────────────

function PickupSheet({ item, onClose, onDone }: { item: FePickup; onClose: () => void; onDone: () => void }) {
  const [passed, setPassed] = useState(true);
  const [notes, setNotes] = useState('');
  const [photoKeys, setPhotoKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const addPhoto = async () => {
    try {
      // Reuse the fe-visits image upload pipeline. We treat each pickup as
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
          <Text style={s.sheetTitle}>{item.listing_title || 'Pickup'}</Text>
          <Text style={s.sheetSub}>₹{item.gross_amount}</Text>

          <View style={s.row}>
            <Text style={s.rowLabel}>Inspection passed</Text>
            <Switch value={passed} onValueChange={setPassed} thumbColor={C.honey} />
          </View>

          <Text style={s.rowLabel}>Notes</Text>
          <TextInput
            style={s.input}
            value={notes}
            onChangeText={setNotes}
            placeholder={passed ? 'Item matches listing, condition matches' : 'Why pickup is being rejected'}
            placeholderTextColor={C.text4}
            multiline
          />

          <Text style={s.rowLabel}>Inspection photos ({photoKeys.length})</Text>
          <TouchableOpacity style={s.btnSecondary} onPress={addPhoto}>
            <Text style={s.btnSecondaryText}>+ Add photo</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
            <TouchableOpacity style={[s.btnGhost, { flex: 1 }]} onPress={onClose}>
              <Text style={s.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnPrimary, { flex: 2 }, busy && s.btnDisabled]} disabled={busy} onPress={submit}>
              <Text style={s.btnPrimaryText}>{passed ? 'Mark passed → at hub' : 'Reject pickup'}</Text>
            </TouchableOpacity>
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
      Alert.alert('Handover photo required', 'Take a photo of the item being handed over.');
      return;
    }
    if (ackCode.length < 6) {
      Alert.alert('Ack code', 'Ask the buyer for their 6-digit handover code.');
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

          <Text style={s.rowLabel}>Handover photo</Text>
          <TouchableOpacity style={s.btnSecondary} onPress={addPhoto}>
            <Text style={s.btnSecondaryText}>{photoKey ? '✓ Photo captured' : '+ Take handover photo'}</Text>
          </TouchableOpacity>

          <Text style={[s.rowLabel, { marginTop: 16 }]}>
            Buyer's 6-digit code
          </Text>
          <Text style={s.hint}>
            Ask the buyer to open their Owmee app and read out the code on the order screen.
          </Text>
          <TextInput
            style={[s.input, { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontWeight: '700' }]}
            value={ackCode}
            onChangeText={(t) => setAckCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="••••••"
            placeholderTextColor={C.text4}
          />

          <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
            <TouchableOpacity style={[s.btnGhost, { flex: 1 }]} onPress={onClose}>
              <Text style={s.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnPrimary, { flex: 2 }, busy && s.btnDisabled]} disabled={busy} onPress={submit}>
              <Text style={s.btnPrimaryText}>Complete delivery</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  header: { paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { fontSize: 20, color: C.text3 },
  title: { fontSize: 18, fontWeight: '700', color: C.text },

  tabs: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  tabOn: { backgroundColor: C.honey, borderColor: C.honey },
  tabText: { fontSize: 13, color: C.text3 },
  tabTextOn: { color: '#fff', fontWeight: '700' },

  card: { backgroundColor: C.surface, borderRadius: 10, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  cardTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  cardMeta: { fontSize: 13, color: C.text3, marginTop: 4 },
  cardWarn: { fontSize: 11, color: C.honey, marginTop: 6, fontStyle: 'italic' },

  empty: { padding: 60, alignItems: 'center' },
  emptyText: { color: C.text4, fontSize: 14 },

  sheetBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.cream, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 24, paddingBottom: 36 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.text },
  sheetSub: { fontSize: 14, color: C.text3, marginBottom: 16 },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 12 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: C.text2, marginTop: 8, marginBottom: 4 },
  hint: { fontSize: 12, color: C.text4, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 12, color: C.text, minHeight: 44 },

  btnPrimary: { backgroundColor: C.honey, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  btnSecondary: { borderWidth: 1, borderColor: C.honey, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnSecondaryText: { color: C.honey, fontSize: 14, fontWeight: '600' },
  btnGhost: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnGhostText: { color: C.text3, fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
});
