/**
 * OffersScreen — Sprint 6c UX rewrite.
 *
 * Three tabs (Received / Sent / In progress). Each row is the same
 * info density: thumbnail, title, amount, status pills. Action buttons
 * are full-size (MIN_TAP) and use the design-system Button primitives
 * instead of the seven distinct styles the previous iteration grew.
 *
 * UX fixes from the audit:
 *   - Generic "Error / Failed" replaced with parseApiError + actionable
 *     messages for each kind of failure
 *   - Withdraw + decline now confirm via confirmDestructive (used to
 *     fire on the first tap with no recovery)
 *   - Empty states use the new EmptyState component (icon + heading +
 *     body + optional action) instead of bare emoji + text
 *   - Errored fetch now shows ErrorState with a "Try again" button
 *     instead of silently leaving the user staring at an empty screen
 *   - Buttons are full-size (MIN_TAP), single-tap-confirm hardened
 *   - Strikethrough listing price moved off C.text4 (was failing
 *     contrast on sand backgrounds)
 *   - Header copy: "Deals" → "Offers" (we have "In progress" tab so
 *     the screen header doesn't need to be a synonym)
 */
import React, { useCallback, useState } from 'react';
import {
  Alert, FlatList, Image, Modal, RefreshControl, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';

import { Offers, Transactions, type Offer, type Transaction } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { BackButton, Button, Card, Chip, EmptyState, ErrorState, StatusBadge } from '../components/ui';
import { confirmDestructive } from '../utils/confirm';
import { parseApiError } from '../utils/errors';
import { afterInteractions } from '../utils/schedule';
import { C, I, MIN_TAP, R, S, T, formatPrice, timeAgo } from '../utils/tokens';

type Tab = 'received' | 'sent' | 'inprogress';
type PricePrompt = {
  mode: 'counter' | 'update';
  offerId: string;
  title: string;
  body: string;
  submitLabel: string;
  initialValue?: string;
};

const TABS: { key: Tab; label: string }[] = [
  { key: 'received', label: 'Received' },
  { key: 'sent', label: 'Sent' },
  { key: 'inprogress', label: 'In progress' },
];

export default function OffersScreen({ navigation }: any) {
  const { isAuthenticated } = useAuthStore();
  const [tab, setTab] = useState<Tab>('received');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [deals, setDeals] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pricePrompt, setPricePrompt] = useState<PricePrompt | null>(null);
  const [priceInput, setPriceInput] = useState('');
  const [priceSubmitting, setPriceSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!refreshing) setLoading(true);
    setError(null);
    try {
      if (tab === 'inprogress') {
        const r = await Transactions.list();
        setDeals(r.data.transactions || r.data || []);
      } else {
        const r = tab === 'received' ? await Offers.received() : await Offers.sent();
        setOffers(r.data.offers || r.data || []);
      }
    } catch (e) {
      setError(parseApiError(e, "Couldn't load. Pull down to retry."));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tab, refreshing]);

  useFocusEffect(useCallback(() => afterInteractions(load), [load]));

  const renderHeader = () => (
    <View style={s.headerRow}>
      <BackButton onPress={() => navigation.goBack()} />
      <Text style={s.hdr}>Offers</Text>
    </View>
  );

  // ── Sign-in gate ─────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={s.safe} edges={['top']}>
        {renderHeader()}
        <EmptyState
          glyph="✉️"
          title="Sign in to see your offers"
          body="Make and receive offers, track deals — all in one place."
          ctaLabel="Sign in"
          onCtaPress={() => navigation.getParent()?.navigate('AuthFlow')}
        />
      </SafeAreaView>
    );
  }

  // ── Action handlers (used in card actions) ──────────────────────────────

  const handleAccept = async (offerId: string) => {
    try {
      const r = await Offers.accept(offerId);
      load();
      const txnId = r.data?.transaction_id;
      if (txnId) navigation.navigate('TransactionDetail', { transactionId: txnId });
    } catch (e) {
      Alert.alert("Couldn't accept offer", parseApiError(e, 'Try again in a moment.'));
    }
  };

  const openPricePrompt = (prompt: PricePrompt) => {
    setPricePrompt(prompt);
    setPriceInput(prompt.initialValue || '');
  };

  const closePricePrompt = () => {
    if (priceSubmitting) return;
    setPricePrompt(null);
    setPriceInput('');
  };

  const submitPricePrompt = async () => {
    if (!pricePrompt) return;
    const cleaned = priceInput.replace(/[₹,\s]/g, '');
    const nextPrice = Number(cleaned);
    if (!cleaned || Number.isNaN(nextPrice) || nextPrice <= 0) {
      Alert.alert('Enter a valid amount', 'Use numbers only, for example 12500.');
      return;
    }

    setPriceSubmitting(true);
    try {
      if (pricePrompt.mode === 'counter') {
        await Offers.counter(pricePrompt.offerId, nextPrice);
      } else {
        await Offers.updatePrice(pricePrompt.offerId, nextPrice);
      }
      setPricePrompt(null);
      setPriceInput('');
      await load();
    } catch (e: any) {
      const code = e?.response?.data?.detail?.error;
      if (pricePrompt.mode === 'update' && code === 'UPDATE_LIMIT_REACHED') {
        Alert.alert('No updates left', "You've used all 3 price updates. The seller has to respond next.");
      } else {
        const fallback = pricePrompt.mode === 'counter'
          ? "Couldn't send counter"
          : "Couldn't update price";
        Alert.alert(fallback, parseApiError(e, 'Try again.'));
      }
    } finally {
      setPriceSubmitting(false);
    }
  };

  const handleCounter = (offerId: string) => {
    openPricePrompt({
      mode: 'counter',
      offerId,
      title: 'Counter offer',
      body: 'Enter the price you would accept from the buyer.',
      submitLabel: 'Send counter',
    });
  };

  const handleReject = async (offerId: string) => {
    if (!await confirmDestructive('Decline this offer?', 'The buyer will be notified. They can\'t offer again on this listing for 7 days.', 'Decline')) return;
    try {
      await Offers.reject(offerId);
      load();
    } catch (e) {
      Alert.alert("Couldn't decline offer", parseApiError(e, 'Try again.'));
    }
  };

  const handleWithdraw = async (offerId: string) => {
    if (!await confirmDestructive('Withdraw your offer?', 'You can offer again later.', 'Withdraw')) return;
    try {
      await Offers.withdraw(offerId);
      load();
    } catch (e) {
      Alert.alert("Couldn't withdraw offer", parseApiError(e, 'Try again.'));
    }
  };

  const handleUpdatePrice = (o: Offer) => {
    const left = o.updates_remaining ?? Math.max(0, 3 - (o.update_count ?? 0));
    openPricePrompt({
      mode: 'update',
      offerId: o.id,
      title: 'Update offer',
      body: `Current: ${formatPrice(o.amount)}. ${left} update${left === 1 ? '' : 's'} left.`,
      submitLabel: 'Update price',
      initialValue: String(o.amount),
    });
  };

  // ── Row renderers ───────────────────────────────────────────────────────

  const renderOffer = ({ item }: { item: Offer }) => {
    const expired = item.expires_at && new Date(item.expires_at) < new Date();
    const minsToExpire = item.expires_at
      ? Math.max(0, Math.floor((new Date(item.expires_at).getTime() - Date.now()) / 60000))
      : null;
    const counterMins = item.counter_expires_at
      ? Math.max(0, Math.floor((new Date(item.counter_expires_at).getTime() - Date.now()) / 60000))
      : null;
    const updatesLeft = item.updates_remaining ?? Math.max(0, 3 - (item.update_count ?? 0));
    const lockoutActive = item.lockout_until ? new Date(item.lockout_until) > new Date() : false;

    return (
      <Card style={s.cardSpacing}>
        <View style={s.row}>
          {item.listing_thumbnail
            ? <Image source={{ uri: item.listing_thumbnail }} style={s.thumb} resizeMode="cover" />
            : <View style={[s.thumb, s.thumbPlaceholder]}><Text style={s.thumbIcon}>📦</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{item.listing_title}</Text>
            <View style={s.priceRow}>
              <Text style={s.amount}>{formatPrice(item.amount)}</Text>
              {item.listing_price !== item.amount && (
                <Text style={s.listed}>{formatPrice(item.listing_price)} listed</Text>
              )}
            </View>
            {item.note && <Text style={s.note} numberOfLines={1}>"{item.note}"</Text>}
            <View style={s.metaRow}>
              <Text style={s.time}>{timeAgo(item.created_at)}</Text>
              {minsToExpire !== null && !expired && (
                <Text style={[s.exp, minsToExpire < 60 && { color: C.red }]}>
                  {minsToExpire < 60 ? `${minsToExpire}m left` : `${Math.floor(minsToExpire / 60)}h left`}
                </Text>
              )}
              {expired && <Text style={[s.exp, { color: C.red }]}>Expired</Text>}
              {tab === 'sent' && item.status === 'pending' && !expired && (
                <Text style={[s.exp, updatesLeft === 0 && { color: C.text3 }]}>
                  {updatesLeft} update{updatesLeft === 1 ? '' : 's'} left
                </Text>
              )}
              {item.status === 'countered' && counterMins !== null && counterMins > 0 && (
                <Text style={[s.exp, { color: C.petrol }]}>
                  Counter: {counterMins < 60 ? `${counterMins}m` : `${Math.floor(counterMins / 60)}h`} to respond
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Action rows — sized to MIN_TAP via Button size="sm" */}
        {tab === 'received' && item.status === 'pending' && !expired && (
          <View style={s.actions}>
            <Button label="Accept" size="sm" variant="primary" onPress={() => handleAccept(item.id)} style={{ flex: 1 }} />
            <Button label="Counter" size="sm" variant="secondary" onPress={() => handleCounter(item.id)} style={{ flex: 1 }} />
            <Button label="Decline" size="sm" variant="ghost" onPress={() => handleReject(item.id)} style={{ flex: 1 }} />
          </View>
        )}
        {tab === 'sent' && item.status === 'pending' && !expired && (
          <View style={s.actions}>
            <Button
              label={updatesLeft === 0 ? 'Locked — seller decides' : 'Update price'}
              size="sm"
              variant="secondary"
              onPress={() => handleUpdatePrice(item)}
              disabled={updatesLeft === 0}
              style={{ flex: 2 }}
            />
            <Button label="Withdraw" size="sm" variant="ghost" onPress={() => handleWithdraw(item.id)} style={{ flex: 1 }} />
          </View>
        )}
        {tab === 'sent' && item.status === 'countered' && !expired && (
          <View style={s.actions}>
            <Button
              label={`Accept counter${item.counter_price ? ` (${formatPrice(item.counter_price)})` : ''}`}
              size="sm" variant="primary"
              onPress={() => handleAccept(item.id)}
              style={{ flex: 2 }}
            />
            <Button label="Decline" size="sm" variant="ghost" onPress={() => handleReject(item.id)} style={{ flex: 1 }} />
          </View>
        )}

        {/* Status footers */}
        {tab === 'sent' && lockoutActive && item.status !== 'accepted' && (
          <View style={s.statusFooter}>
            <StatusBadge tone="warning" label={`Cooldown until ${new Date(item.lockout_until!).toLocaleDateString('en-IN')}`} />
          </View>
        )}
        {item.status === 'accepted' && (
          <View style={s.statusFooter}>
            <StatusBadge tone="positive" label="✓ Accepted" />
          </View>
        )}
      </Card>
    );
  };

  const renderDeal = ({ item }: { item: Transaction }) => (
    <Card
      style={s.cardSpacing}
      onPress={() => navigation.navigate('TransactionDetail', { transactionId: item.id })}
    >
      <View style={s.row}>
        <View style={[s.thumb, s.thumbPlaceholder]}><Text style={s.thumbIcon}>🤝</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{item.listing_title || 'Deal'}</Text>
          <Text style={s.amount}>{formatPrice(item.amount)}</Text>
          <View style={{ marginTop: S.xs }}>
            <StatusBadge status={item.status} />
          </View>
        </View>
      </View>
    </Card>
  );

  // ── Main ────────────────────────────────────────────────────────────────

  const data: any[] = tab === 'inprogress' ? deals : offers;
  const renderItem = tab === 'inprogress' ? renderDeal as any : renderOffer as any;
  const emptyForTab = tab === 'received'
    ? { glyph: '✉️', title: 'No offers received', body: 'When buyers offer on your listings, they\'ll show up here.' }
    : tab === 'sent'
      ? { glyph: '✋', title: 'No offers sent', body: 'Find an item you like, hit Make Offer, and it\'ll appear here.' }
      : { glyph: '🤝', title: 'No deals in progress', body: 'Once an offer is accepted, the deal lives here until completion.' };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {renderHeader()}

      <View style={s.tabs}>
        {TABS.map(t => (
          <Chip
            key={t.key}
            label={t.label}
            selected={tab === t.key}
            variant="filter"
            onPress={() => setTab(t.key)}
            style={s.tab}
          />
        ))}
      </View>

      {loading ? (
        <View style={{ paddingTop: S.xxxl }}>
          <Text style={s.loading}>Loading…</Text>
        </View>
      ) : error ? (
        <ErrorState title="Couldn't load offers" body={error} onRetry={load} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={C.petrol}
            />
          }
          ListEmptyComponent={<EmptyState {...emptyForTab} />}
          removeClippedSubviews
          maxToRenderPerBatch={8}
          windowSize={5}
        />
      )}

      <Modal
        visible={!!pricePrompt}
        transparent
        animationType="fade"
        onRequestClose={closePricePrompt}
      >
        <View style={s.modalBackdrop}>
          <View style={s.priceSheet}>
            <Text style={s.promptTitle}>{pricePrompt?.title}</Text>
            <Text style={s.promptBody}>{pricePrompt?.body}</Text>
            <View style={s.inputWrap}>
              <Text style={s.rupee}>₹</Text>
              <TextInput
                value={priceInput}
                onChangeText={setPriceInput}
                keyboardType="number-pad"
                placeholder="Enter amount"
                placeholderTextColor={C.text4}
                style={s.priceInput}
              />
            </View>
            <View style={s.promptActions}>
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                onPress={closePricePrompt}
                style={{ flex: 1 }}
              />
              <Button
                label={pricePrompt?.submitLabel || 'Submit'}
                variant="primary"
                size="sm"
                onPress={submitPricePrompt}
                loading={priceSubmitting}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.md,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
  },
  hdr: {
    fontSize: T.size.xxl, fontWeight: T.weight.bold, color: C.text,
  },
  loading: { textAlign: 'center', color: C.text3, fontSize: T.size.base },

  tabs: { flexDirection: 'row', paddingHorizontal: S.lg, marginTop: S.md, gap: S.sm },
  tab: {
    paddingHorizontal: S.lg, paddingVertical: S.sm,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    minHeight: MIN_TAP / 1.4,  // tabs don't need full MIN_TAP
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: C.petrolLight, borderColor: C.petrol },
  tabText: { fontSize: T.size.base, color: C.text2 },
  tabTextOn: { color: C.petrolDeep, fontWeight: T.weight.semi },

  list: { padding: S.lg },
  cardSpacing: { marginBottom: S.md },

  row: { flexDirection: 'row', gap: S.md },
  thumb: { width: 64, height: 64, borderRadius: R.sm },
  thumbPlaceholder: { backgroundColor: C.bone2, alignItems: 'center', justifyContent: 'center' },
  thumbIcon: { fontSize: I.md },

  title: { fontSize: T.size.md, fontWeight: T.weight.semi, color: C.text, marginBottom: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: S.sm },
  amount: { fontSize: T.size.lg, fontWeight: T.weight.bold, color: C.petrol },
  // Was C.text4 + line-through; bumped to text3 for contrast on cream/sand backgrounds
  // and removed strike to avoid the price-confusion ambiguity ("Is it ₹X or ₹Y?").
  listed: { fontSize: T.size.sm, color: C.text3 },
  note: { fontSize: T.size.sm, color: C.text2, fontStyle: 'italic', marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: S.md, marginTop: S.xs, flexWrap: 'wrap' },
  time: { fontSize: T.size.xs, color: C.text3 },
  exp: { fontSize: T.size.xs, color: C.petrol, fontWeight: T.weight.semi },

  actions: {
    flexDirection: 'row', gap: S.sm, marginTop: S.md,
    paddingTop: S.md, borderTopWidth: 1, borderTopColor: C.border2,
  },

  statusFooter: { marginTop: S.md, alignItems: 'flex-start' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(16, 24, 40, 0.34)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.lg,
  },
  priceSheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: R.lg,
    backgroundColor: C.surface,
    padding: S.lg,
    borderWidth: 1,
    borderColor: C.border,
  },
  promptTitle: {
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
    color: C.text,
  },
  promptBody: {
    marginTop: S.xs,
    fontSize: T.size.base,
    color: C.text2,
    lineHeight: 20,
  },
  inputWrap: {
    marginTop: S.lg,
    minHeight: MIN_TAP,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.white,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.md,
  },
  rupee: {
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
    color: C.text2,
    marginRight: S.xs,
  },
  priceInput: {
    flex: 1,
    color: C.text,
    fontSize: T.size.lg,
    fontWeight: T.weight.semi,
    paddingVertical: S.sm,
  },
  promptActions: {
    flexDirection: 'row',
    gap: S.sm,
    marginTop: S.lg,
  },
});
