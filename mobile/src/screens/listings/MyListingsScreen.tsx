import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Alert, Image, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton, Button, IconButton } from '../../components/ui';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, Shadow, formatPrice, timeAgo } from '../../utils/tokens';
import { Listings, type Listing, type ListingDeletionReason } from '../../services/api';
import ReasonSheet, { type ReasonOption } from '../../components/listing/ReasonSheet';
import { afterInteractions } from '../../utils/schedule';

// Mirrors backend _VALID_DELETION_REASONS (router.py). Order is the chip
// order users see — most common reasons first.
const DELETE_REASONS: ReasonOption<ListingDeletionReason>[] = [
  { key: 'sold_elsewhere', label: 'Sold elsewhere' },
  { key: 'changed_mind',   label: 'Changed my mind' },
  { key: 'wrong_price',    label: 'Wrong price' },
  { key: 'no_buyers',      label: 'No buyers' },
  { key: 'item_damaged',   label: 'Item damaged' },
  { key: 'other',          label: 'Other' },
];

// Statuses where Edit is a useful action. Drafts edit via Sell flow,
// removed/sold listings are immutable.
const EDITABLE_STATUSES = new Set(['active', 'pending_review', 'pending_moderation']);
// Statuses where Delete is a no-op (already gone or seller can't pull
// the rug from a buyer mid-transaction).
const DELETABLE_STATUSES = new Set(['draft', 'pending_review', 'pending_moderation', 'active', 'expired']);
const LISTING_ROW_HEIGHT = 106;
const SKELETON_ROWS = Array.from({ length: 6 }, (_, i) => `my-listing-skeleton-${i}`);

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  draft:              { label: 'Draft',     color: C.text3,  bg: C.bone2        },
  pending_review:     { label: 'In review', color: C.yellow, bg: C.yellowLight  },
  pending_moderation: { label: 'In review', color: C.yellow, bg: C.yellowLight  },
  active:             { label: 'Active',    color: C.petrol, bg: C.petrolLight  },
  reserved:           { label: 'Reserved',  color: C.petrol, bg: C.petrolLight  },
  sold:               { label: 'Sold',      color: C.text4,  bg: C.bone2        },
  expired:            { label: 'Expired',   color: C.red,    bg: C.redLight     },
  removed:            { label: 'Removed',   color: C.text4,  bg: C.bone2        },
};

function listingsFromResponse(res: any): Listing[] {
  return res?.data?.listings || res?.data || [];
}

function prefetchThumbs(rows: Listing[]) {
  rows.slice(0, 6).forEach((item) => {
    const img = (item.image_urls || item.images)?.[0] || item.thumbnail_url;
    if (img) Image.prefetch(img).catch(() => {});
  });
}

export default function MyListingsScreen({ navigation }: any) {
  const cachedListings = useMemo(() => listingsFromResponse(Listings.peekMyListings()), []);
  const [listings, setListings] = useState<Listing[]>(cachedListings);
  const [loading, setLoading] = useState(cachedListings.length === 0);
  const [backgroundUpdating, setBackgroundUpdating] = useState(cachedListings.length > 0);
  const [refreshing, setRefreshing] = useState(false);

  // Action menu (kebab) + reason sheet state. Both target the same
  // listing — selectedListing is the canonical pointer.
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [showActions, setShowActions] = useState(false);
  const [showDeleteSheet, setShowDeleteSheet] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (showErrors = true) => {
    try {
      const res = await Listings.myListings();
      const next = listingsFromResponse(res);
      setListings(next);
      prefetchThumbs(next);
    } catch (e: any) {
      if (showErrors && listings.length === 0) {
        const { parseApiError } = require('../../utils/errors');
        Alert.alert('Could not load listings', parseApiError(e));
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
      setBackgroundUpdating(false);
    }
  }, [listings.length]);

  useFocusEffect(useCallback(() => {
    const cached = Listings.peekMyListings();
    if (cached) {
      const next = listingsFromResponse(cached);
      setListings(next);
      setLoading(false);
      setBackgroundUpdating(true);
      prefetchThumbs(next);
    }
    return afterInteractions(() => load(!cached));
  }, [load]));

  const openActions = useCallback((listing: Listing) => {
    setSelectedListing(listing);
    setShowActions(true);
  }, []);

  const closeActions = useCallback(() => {
    setShowActions(false);
  }, []);

  const goToSell = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'Sell' });
  }, [navigation]);

  const startDelete = useCallback(() => {
    setShowActions(false);
    // Tiny delay so the modal-stack swap doesn't jank on Android.
    setTimeout(() => setShowDeleteSheet(true), 150);
  }, []);

  const submitDelete = useCallback(async (reason: ListingDeletionReason, note: string) => {
    if (!selectedListing) return;
    setDeleting(true);
    try {
      const { data } = await Listings.delete(selectedListing.id, reason, note);
      setShowDeleteSheet(false);
      setSelectedListing(null);
      // Surface the cascade summary so the seller sees offers/visits
      // weren't silently dropped.
      const offersN = data?.offers_cancelled ?? 0;
      const visitsN = data?.visits_cancelled ?? 0;
      const parts: string[] = [];
      if (offersN > 0) parts.push(`${offersN} offer${offersN === 1 ? '' : 's'} cancelled`);
      if (visitsN > 0) parts.push(`${visitsN} visit${visitsN === 1 ? '' : 's'} cancelled`);
      Alert.alert(
        'Listing removed',
        parts.length ? `${parts.join(' · ')}. Buyers were notified.` : 'Buyers searching for it will no longer see it.',
      );
      load(false);
    } catch (e: any) {
      const { parseApiError } = require('../../utils/errors');
      Alert.alert('Could not remove', parseApiError(e));
    } finally {
      setDeleting(false);
    }
  }, [selectedListing, load]);

  const goEdit = useCallback(() => {
    if (!selectedListing) return;
    setShowActions(false);
    navigation.navigate('EditListing', { listingId: selectedListing.id });
  }, [selectedListing, navigation]);

  const markSold = useCallback(async (where: 'on_owmee' | 'elsewhere') => {
    if (!selectedListing) return;
    setShowActions(false);
    try {
      await Listings.markSold(selectedListing.id, where);
      load(false);
    } catch (e: any) {
      const { parseApiError } = require('../../utils/errors');
      Alert.alert('Could not update', parseApiError(e));
    }
  }, [selectedListing, load]);

  const confirmMarkSold = useCallback((where: 'on_owmee' | 'elsewhere') => {
    if (!selectedListing) return;
    const soldOnOwmee = where === 'on_owmee';
    Alert.alert(
      soldOnOwmee ? 'Mark sold on Owmee?' : 'Mark sold elsewhere?',
      soldOnOwmee
        ? 'This will move the listing out of the active marketplace.'
        : 'This will remove the listing from buyer discovery because it sold outside Owmee.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark sold',
          style: soldOnOwmee ? 'default' : 'destructive',
          onPress: () => markSold(where),
        },
      ],
    );
  }, [markSold, selectedListing]);

  const renderItem = ({ item }: { item: Listing | string }) => {
    if (typeof item === 'string') return <MyListingSkeleton />;
    const st = STATUS_MAP[item.status] || STATUS_MAP.draft;
    const img = (item.image_urls || item.images)?.[0] || item.thumbnail_url;
    const showKebab = EDITABLE_STATUSES.has(item.status) || DELETABLE_STATUSES.has(item.status);
    return (
      <View style={s.card}>
        <TouchableOpacity
          style={s.cardTouch}
          onPress={() => navigation.navigate('ListingDetail', { listingId: item.id, initialListing: item })}
          onLongPress={() => showKebab && openActions(item)}
          activeOpacity={0.85}
        >
          {img ? (
            <Image source={{ uri: img }} style={s.thumb} resizeMode="contain" />
          ) : (
            <View style={[s.thumb, s.noImg]}>
              <Text style={s.noImgIcon}>📦</Text>
            </View>
          )}
          <View style={s.info}>
            <Text style={s.title} numberOfLines={2}>{item.title}</Text>
            <Text style={s.price}>{formatPrice(item.price)}</Text>
            <View style={s.metaRow}>
              <View style={[s.statusBadge, { backgroundColor: st.bg }]}>
                <Text style={[s.statusText, { color: st.color }]}>{st.label}</Text>
              </View>
              {item.view_count != null && <Text style={s.views}>{item.view_count} views</Text>}
              {item.created_at && <Text style={s.time}>{timeAgo(item.created_at)}</Text>}
            </View>
          </View>
        </TouchableOpacity>
        {showKebab ? (
          <TouchableOpacity
            style={s.kebab}
            onPress={() => openActions(item)}
            accessibilityRole="button"
            accessibilityLabel="Manage listing"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.kebabDots}>⋯</Text>
          </TouchableOpacity>
        ) : (
          <Text style={s.arrow}>›</Text>
        )}
      </View>
    );
  };

  const sel = selectedListing;
  const canEdit = !!sel && EDITABLE_STATUSES.has(sel.status);
  const canDelete = !!sel && DELETABLE_STATUSES.has(sel.status);
  const canMarkSold = !!sel && sel.status === 'active';
  const rows: Array<Listing | string> = loading && listings.length === 0 ? SKELETON_ROWS : listings;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>My Listings</Text>
        <IconButton
          icon="+"
          onPress={goToSell}
          a11y="Create listing"
          variant="solid"
          size="sm"
        />
      </View>
      {backgroundUpdating && listings.length > 0 ? (
        <View style={s.syncPill} pointerEvents="none">
          <Text style={s.syncText}>Refreshing</Text>
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={i => typeof i === 'string' ? i : i.id}
        renderItem={renderItem}
        getItemLayout={(_, index) => ({ length: LISTING_ROW_HEIGHT, offset: LISTING_ROW_HEIGHT * index, index })}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.petrol} />}
        ListEmptyComponent={!loading ? (
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>📦</Text>
            <Text style={s.emptyTitle}>No listings yet</Text>
            <Text style={s.emptySub}>Tap + to list your first item</Text>
            <Button
              label="Create listing"
              variant="primary"
              onPress={goToSell}
            />
          </View>
        ) : null}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        removeClippedSubviews
        windowSize={5}
      />

      {/* Action menu — kebab tap brings up this slide-up sheet */}
      <Modal
        visible={showActions}
        transparent
        animationType="slide"
        onRequestClose={closeActions}>
        <View style={s.actionsBackdrop}>
          <TouchableOpacity
            style={s.actionsBackdropTouch}
            activeOpacity={1}
            onPress={closeActions}
          />
          <View style={s.actionsSheet}>
            <View style={s.actionsHandle} />
            <Text style={s.actionsTitle} numberOfLines={1}>
              {sel?.title || 'Manage listing'}
            </Text>
            {canEdit ? (
              <TouchableOpacity style={s.actionItem} onPress={goEdit}>
                <Text style={s.actionEmoji}>✏️</Text>
                <View style={s.actionTextWrap}>
                  <Text style={s.actionTitle}>Edit details</Text>
                  <Text style={s.actionSub}>Change price, item details, description</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            {canMarkSold ? (
              <>
                <TouchableOpacity style={s.actionItem} onPress={() => confirmMarkSold('on_owmee')}>
                  <Text style={s.actionEmoji}>✅</Text>
                  <View style={s.actionTextWrap}>
                    <Text style={s.actionTitle}>Mark sold on Owmee</Text>
                    <Text style={s.actionSub}>You sold it through Owmee</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity style={s.actionItem} onPress={() => confirmMarkSold('elsewhere')}>
                  <Text style={s.actionEmoji}>🛒</Text>
                  <View style={s.actionTextWrap}>
                    <Text style={s.actionTitle}>Mark sold elsewhere</Text>
                    <Text style={s.actionSub}>You sold it outside Owmee</Text>
                  </View>
                </TouchableOpacity>
              </>
            ) : null}
            {canDelete ? (
              <TouchableOpacity style={s.actionItem} onPress={startDelete}>
                <Text style={s.actionEmoji}>🗑</Text>
                <View style={s.actionTextWrap}>
                  <Text style={[s.actionTitle, s.actionTitleDanger]}>Remove listing</Text>
                  <Text style={s.actionSub}>Take it off the marketplace</Text>
                </View>
              </TouchableOpacity>
            ) : null}
            <Button
              label="Cancel"
              variant="ghost"
              size="md"
              onPress={closeActions}
              style={s.actionsCancel}
            />
          </View>
        </View>
      </Modal>

      {/* Delete confirm with reason capture */}
      <ReasonSheet<ListingDeletionReason>
        visible={showDeleteSheet}
        title="Remove this listing?"
        message="Buyers watching it will be notified and any open offers will be cancelled. You can re-list anytime."
        reasons={DELETE_REASONS}
        confirmLabel="Remove listing"
        loading={deleting}
        onConfirm={submitDelete}
        onClose={() => !deleting && setShowDeleteSheet(false)}
      />
    </SafeAreaView>
  );
}

function MyListingSkeleton() {
  return (
    <View style={s.card}>
      <View style={[s.thumb, s.skelBlock]} />
      <View style={s.info}>
        <View style={[s.skelLine, s.skelTitle]} />
        <View style={[s.skelLine, s.skelPrice]} />
        <View style={s.metaRow}>
          <View style={[s.skelLine, s.skelBadge]} />
          <View style={[s.skelLine, s.skelMeta]} />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingVertical: S.sm + 2,
    backgroundColor: C.surface,
    borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  headerTitle: { fontSize: T.size.lg - 1, fontWeight: T.weight.semi, color: C.text },
  syncPill: {
    position: 'absolute',
    top: 58,
    alignSelf: 'center',
    zIndex: 4,
    paddingHorizontal: S.sm,
    paddingVertical: S.xs,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255,253,248,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(79, 127, 134, 0.18)',
    ...Shadow.subtle,
  },
  syncText: {
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
    color: C.petrolDeep,
  },

  list: { padding: S.lg },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: R.lg,
    padding: S.md, marginBottom: S.sm + 2,
    borderWidth: 1, borderColor: C.border,
    ...Shadow.card,
  },
  cardTouch: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  kebab: {
    paddingHorizontal: S.sm, paddingVertical: S.xs,
    marginLeft: S.xs,
  },
  kebabDots: {
    fontSize: T.size.xl,
    color: C.text3,
    fontWeight: T.weight.bold,
    letterSpacing: 1,
  },
  thumb: { width: 72, height: 72, borderRadius: R.sm },
  noImg: { backgroundColor: C.bone2, alignItems: 'center', justifyContent: 'center' },
  noImgIcon: { fontSize: T.size.xxl },
  info: { flex: 1, marginLeft: S.md },
  title: { fontSize: T.size.sm + 1, fontWeight: T.weight.semi, color: C.text, marginBottom: 2 },
  price: { fontSize: T.size.lg - 1, fontWeight: T.weight.bold, color: C.petrol, marginBottom: S.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  statusBadge: { paddingHorizontal: S.sm, paddingVertical: 2, borderRadius: R.xs },
  statusText: { fontSize: T.size.xs, fontWeight: T.weight.bold },
  views: { fontSize: T.size.xs, color: C.text3 },
  time: { fontSize: T.size.xs, color: C.text4 },
  arrow: { fontSize: T.size.xl, color: C.text4, marginLeft: S.xs },
  skelBlock: { backgroundColor: '#EFE2D6' },
  skelLine: {
    height: 12,
    borderRadius: R.pill,
    backgroundColor: '#E9DACD',
  },
  skelTitle: { width: '72%', marginBottom: S.sm },
  skelPrice: { width: 92, height: 16, marginBottom: S.sm },
  skelBadge: { width: 74 },
  skelMeta: { width: 92 },

  empty: { alignItems: 'center', paddingTop: S.xxxl + S.xxl },
  emptyEmoji: { fontSize: T.size.display + 18, marginBottom: S.lg },
  emptyTitle: { fontSize: T.size.lg + 1, fontWeight: T.weight.semi, color: C.text, marginBottom: S.xs },
  emptySub: { fontSize: T.size.base, color: C.text3, marginBottom: S.xl },

  actionsBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  actionsBackdropTouch: { flex: 1 },
  actionsSheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    paddingTop: S.sm,
    paddingBottom: S.lg,
    ...Shadow.glow,
  },
  actionsHandle: {
    width: 40, height: 4, borderRadius: R.pill,
    backgroundColor: C.border, alignSelf: 'center', marginBottom: S.sm,
  },
  actionsTitle: {
    fontSize: T.size.md, fontWeight: T.weight.semi, color: C.text2,
    paddingHorizontal: S.lg, paddingBottom: S.sm,
  },
  actionItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: S.lg, paddingVertical: S.md,
    gap: S.md,
  },
  actionEmoji: { fontSize: T.size.xl },
  actionTextWrap: { flex: 1 },
  actionTitle: { fontSize: T.size.base, fontWeight: T.weight.semi, color: C.text },
  actionTitleDanger: { color: C.red },
  actionSub: { fontSize: T.size.sm, color: C.text3, marginTop: 2 },
  actionsCancel: { marginTop: S.sm, marginHorizontal: S.lg },
});
