import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList, TouchableOpacity, Alert,
  ActivityIndicator, Modal, TextInput, useWindowDimensions, Share, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import {
  C, T, S, R, Shadow, formatPrice, formatDistance, timeAgo, percentOff, condStyle,
} from '../../utils/tokens';
import { Listings, Offers, Wishlist, type Listing } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { BackButton, Button, IconButton } from '../../components/ui';
import { parseApiError } from '../../utils/errors';
import type { RootScreen } from '../../navigation/types';

// Sprint 4 / Pass 3: kids safety checklist labels — must match FeCaptureScreen.
const KIDS_SAFETY_PANEL_KEYS: { key: string; label: string }[] = [
  { key: 'cleaned',            label: 'Cleaned / sanitised' },
  { key: 'no_small_parts',     label: 'No small parts that can be swallowed' },
  { key: 'no_loose_batteries', label: 'No loose or accessible batteries' },
  { key: 'no_sharp_edges',     label: 'No sharp edges or broken pieces' },
  { key: 'original_packaging', label: 'Original packaging available' },
  { key: 'working_condition',  label: 'Working condition' },
  { key: 'no_recalled_model',  label: 'Not a recalled model' },
  { key: 'age_label_correct',  label: 'Age suitability confirmed' },
];

export default function ListingDetailScreen({ navigation, route }: RootScreen<'ListingDetail'>) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { listingId } = route.params;
  const { isAuthenticated, userId } = useAuthStore();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [wishlisted, setWishlisted] = useState(false);
  const [showOffer, setShowOffer] = useState(false);
  const [offerAmt, setOfferAmt] = useState('');
  const [offerNote, setOfferNote] = useState('');
  const [imgIdx, setImgIdx] = useState(0);
  const imgH = width * 0.85;

  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        const r = await Listings.get(listingId); setListing(r.data);
        // Save to recently viewed
        try {
          const rv = JSON.parse(await AsyncStorage.getItem('@ow_recent_viewed') || '[]');
          await AsyncStorage.setItem(
            '@ow_recent_viewed',
            JSON.stringify([listingId, ...rv.filter((x: string) => x !== listingId)].slice(0, 20)),
          );
        } catch {}
        if (isAuthenticated) {
          try {
            const w = await Wishlist.list();
            const items = w.data?.wishlist || [];
            setWishlisted(items.some((i: any) => i.listing_id === listingId));
          } catch {}
        }
      } catch {} finally { setLoading(false); }
    })();
  }, [listingId, isAuthenticated]));

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <ActivityIndicator color={C.petrol} style={s.loadingSpinner} />
      </SafeAreaView>
    );
  }
  if (!listing) {
    return (
      <SafeAreaView style={s.safe}>
        <Text style={s.notFound}>Not found</Text>
      </SafeAreaView>
    );
  }

  const images = listing.image_urls?.length
    ? listing.image_urls
    : listing.images?.length
      ? listing.images
      : [];
  const isOwn = listing.seller_id === userId;
  const off = percentOff(listing.price, listing.original_price);
  const cs = condStyle(listing.condition);

  const toggleWish = async () => {
    try {
      if (wishlisted) await Wishlist.remove(listingId);
      else await Wishlist.add(listingId);
      setWishlisted(!wishlisted);
    } catch {}
  };

  const onShare = () => {
    Share.share({
      message: `Check out ${listing.title} on Owmee for ${formatPrice(listing.price)}! https://owmee.in/listing/${listingId}`,
    }).catch(() => {});
  };

  const onReport = () => {
    Alert.alert('Report listing', 'Why are you reporting?', [
      { text: 'Fake/misleading' },
      { text: 'Stolen item' },
      { text: 'Inappropriate' },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const makeOffer = async () => {
    if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
    try {
      await Offers.create(listingId, parseFloat(offerAmt), offerNote || undefined);
      setShowOffer(false);
      setOfferAmt('');
      setOfferNote('');
      Alert.alert(
        'Offer sent!',
        'The seller will respond within 48 hours. You can update your price up to 3 times before the seller decides.',
      );
    } catch (e: any) {
      // Sprint 6b: 409 from server means OFFER_ALREADY_EXISTS or LOCKOUT_ACTIVE.
      const code = (e?.response?.data?.detail?.error || '').toString();
      if (code === 'OFFER_ALREADY_EXISTS') {
        Alert.alert(
          'You already have an offer here',
          'Open My Offers to update your price (up to 3 times) or wait for the seller.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'My Offers', onPress: () => { setShowOffer(false); navigation.navigate('MyOffers' as never); } },
          ],
        );
        return;
      }
      if (code === 'LOCKOUT_ACTIVE') {
        Alert.alert(
          'Cooldown active',
          'Your last offer on this listing was rejected. You can offer again in 7 days.',
        );
        return;
      }
      Alert.alert('Error', parseApiError(e, 'Could not send offer'));
    }
  };

  const fairPriceOff = listing.original_price && listing.price < listing.original_price
    ? Math.round((1 - listing.price / listing.original_price) * 100)
    : null;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Image carousel */}
        <View style={[s.imgWrap, { width, height: imgH }]}>
          {images.length > 0 ? (
            <FlatList
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              data={images}
              keyExtractor={(_, i) => String(i)}
              onMomentumScrollEnd={e =>
                setImgIdx(Math.round(e.nativeEvent.contentOffset.x / width))
              }
              renderItem={({ item: uri }) => (
                <Image source={{ uri }} style={{ width, height: imgH }} resizeMode="cover" />
              )}
              removeClippedSubviews
              initialNumToRender={1}
              maxToRenderPerBatch={2}
              windowSize={3}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            />
          ) : (
            <View style={[s.imgPlaceholder, { width, height: imgH }]}>
              <Text style={s.imgPlaceholderEmoji}>📦</Text>
            </View>
          )}

          {images.length > 1 && (
            <View style={s.dots}>
              {images.map((_, i) => (
                <View key={i} style={[s.dot, i === imgIdx && s.dotOn]} />
              ))}
            </View>
          )}

          <View style={s.backBtnWrap}>
            <BackButton variant="floating" onPress={() => navigation.goBack()} />
          </View>

          <View style={s.shareBtnWrap}>
            <IconButton icon="↗" onPress={onShare} a11y="Share listing" variant="outlined" />
          </View>

          {!isOwn && (
            <View style={s.wishBtnWrap}>
              <IconButton
                icon={wishlisted ? '♥' : '♡'}
                onPress={toggleWish}
                a11y={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                variant="outlined"
                style={wishlisted ? s.wishActiveBg : undefined}
              />
            </View>
          )}
        </View>

        {/* Trust strip */}
        {listing.seller_verified && (
          <View style={s.trustStrip}>
            <Text style={s.trustStripIcon}>🛡️</Text>
            <Text style={s.trustStripText}>
              Aadhaar verified seller{listing.imei ? ' · IMEI checked' : ''}
            </Text>
            {listing.seller?.avg_rating && (
              <View style={s.trustScore}>
                <Text style={s.trustScoreText}>{listing.seller.avg_rating.toFixed(1)}★</Text>
              </View>
            )}
          </View>
        )}

        {/* Info */}
        <View style={s.info}>
          <Text style={s.title}>{listing.title}</Text>

          <View style={s.priceRow}>
            <Text style={s.price}>{formatPrice(listing.price)}</Text>
            {listing.original_price ? (
              <Text style={s.mrp}>{formatPrice(listing.original_price)}</Text>
            ) : null}
            {off ? <Text style={s.off}>{off}% off</Text> : null}
            {listing.is_negotiable && (
              <View style={s.negoTag}>
                <Text style={s.negoText}>Negotiable</Text>
              </View>
            )}
          </View>

          {listing.imei_verified && (
            <Text style={s.imeiVerified}>✓ IMEI verified — not blacklisted</Text>
          )}
          {fairPriceOff != null && (
            <View style={s.fairPriceRow}>
              <Text style={s.fairPriceLabel}>✓ Fair price</Text>
              <Text style={s.fairPriceMrp}>{formatPrice(listing.original_price!)}</Text>
              <Text style={s.fairPriceOff}>{fairPriceOff}% off</Text>
            </View>
          )}

          <View style={s.metaRow}>
            <View style={[s.condBadge, { backgroundColor: cs.bg }]}>
              <Text style={[s.condBadgeText, { color: cs.color }]}>{cs.label}</Text>
            </View>
            <Text style={s.metaDot}>·</Text>
            <Text style={s.meta}>{listing.city}</Text>
            {listing.distance_km != null && (
              <>
                <Text style={s.metaDot}>·</Text>
                <Text style={s.meta}>{formatDistance(listing.distance_km)}</Text>
              </>
            )}
            {listing.published_at && (
              <>
                <Text style={s.metaDot}>·</Text>
                <Text style={s.meta}>{timeAgo(listing.published_at)}</Text>
              </>
            )}
          </View>
        </View>

        {/* Detail chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {listing.battery_health && (
            <View style={s.chip}>
              <Text style={s.chipIcon}>🔋</Text>
              <View>
                <Text style={s.chipLabel}>Battery</Text>
                <Text style={s.chipVal}>{listing.battery_health}%</Text>
              </View>
            </View>
          )}
          {listing.accessories && (
            <View style={s.chip}>
              <Text style={s.chipIcon}>📦</Text>
              <View>
                <Text style={s.chipLabel}>Accessories</Text>
                <Text style={s.chipVal}>{listing.accessories}</Text>
              </View>
            </View>
          )}
          {listing.warranty_status && (
            <View style={s.chip}>
              <Text style={s.chipIcon}>🔐</Text>
              <View>
                <Text style={s.chipLabel}>Warranty</Text>
                <Text style={s.chipVal}>{listing.warranty_status}</Text>
              </View>
            </View>
          )}
          {listing.view_count != null && (
            <View style={s.chip}>
              <Text style={s.chipIcon}>👁</Text>
              <View>
                <Text style={s.chipLabel}>Views</Text>
                <Text style={s.chipVal}>{listing.view_count}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Seller card */}
        {listing.seller && (
          <View style={s.seller}>
            <View style={s.sellerAvatar}>
              <Text style={s.sellerInitial}>{(listing.seller.name || 'S').charAt(0)}</Text>
            </View>
            <View style={s.sellerInfo}>
              <TouchableOpacity onPress={() => navigation.navigate('SellerProfile', {
                seller: {
                  id: listing.seller_id,
                  name: listing.seller?.name,
                  city: listing.city,
                  kyc_verified: listing.seller?.kyc_verified,
                  avg_rating: listing.seller?.avg_rating,
                  deal_count: listing.seller?.deal_count,
                },
              })}>
                <Text style={s.sellerName}>{listing.seller.name || 'Seller'} →</Text>
              </TouchableOpacity>
              <View style={s.sellerStatRow}>
                {listing.seller.kyc_verified && (
                  <View style={s.sellerBadge}>
                    <Text style={s.sellerBadgeText}>✓ Verified</Text>
                  </View>
                )}
                {listing.seller.deal_count ? (
                  <Text style={s.sellerStat}>{listing.seller.deal_count} items sold</Text>
                ) : null}
                {listing.seller.avg_rating ? (
                  <Text style={s.sellerStat}>· {listing.seller.avg_rating.toFixed(1)}★</Text>
                ) : null}
              </View>
            </View>
          </View>
        )}

        {listing.description && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Description</Text>
            <Text style={s.desc}>{listing.description}</Text>
          </View>
        )}

        {/* Sprint 4 / Pass 3: Kids safety checklist panel */}
        {listing.is_kids_item && listing.kids_safety_checklist && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Safety checklist</Text>
            <Text style={s.kidsSafetyIntro}>
              The seller has verified the following for this kids item:
            </Text>
            {KIDS_SAFETY_PANEL_KEYS.map(({ key, label }) => {
              const checked = !!(listing.kids_safety_checklist as any)?.[key];
              return (
                <View key={key} style={s.kidsRow}>
                  <Text style={[s.kidsCheck, { color: checked ? C.petrolText : C.text4 }]}>
                    {checked ? '✓' : '○'}
                  </Text>
                  <Text style={[s.kidsLabel, { color: checked ? C.text2 : C.text4 }]}>
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Sprint 4 / Pass 3: Ops-verified badge for fe_assisted listings */}
        {listing.listing_source === 'fe_assisted' && (
          <View style={s.feAssistedRow}>
            <Text style={s.feAssistedIcon}>🤝</Text>
            <View style={s.feAssistedText}>
              <Text style={s.feAssistedTitle}>Listed by an Owmee Field Executive</Text>
              <Text style={s.feAssistedSub}>
                {listing.reviewed_by === 'fe_and_ops'
                  ? 'FE captured on-site · Ops reviewed'
                  : 'FE captured on-site'}
              </Text>
            </View>
          </View>
        )}

        <View style={s.bottomSpacer} />

        <TouchableOpacity style={s.reportRow} onPress={onReport}>
          <Text style={s.reportText}>⚑ Report this listing</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bottom CTA */}
      {!isOwn && (
        <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, S.lg) }]}>
          {listing.is_negotiable && (
            <Button
              label="Offer"
              variant="secondary"
              onPress={() => {
                if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
                setShowOffer(true);
              }}
              style={s.offerOutlineBtn}
            />
          )}
          <Button
            label="Buy Now →"
            variant="primary"
            onPress={() => {
              if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
              navigation.navigate('Checkout', { listingId });
            }}
            style={s.buyBtn}
          />
        </View>
      )}

      {/* Offer modal */}
      <Modal visible={showOffer} transparent animationType="slide">
        <View style={s.modalBg}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Make an offer</Text>
            <Text style={s.modalAsking}>Asking: {formatPrice(listing.price)}</Text>
            <Text style={s.modalRules}>
              This is a binding offer. You can update your price up to 3 times. After that, the seller decides.
            </Text>
            <View style={s.modalAmtRow}>
              <Text style={s.modalRupee}>₹</Text>
              <TextInput
                style={s.modalInput}
                placeholder="Your offer"
                placeholderTextColor={C.text4}
                keyboardType="numeric"
                value={offerAmt}
                onChangeText={setOfferAmt}
                autoFocus
              />
            </View>
            <TextInput
              style={[s.modalInput, s.modalNote]}
              placeholder="Add a note (optional)"
              placeholderTextColor={C.text4}
              value={offerNote}
              onChangeText={setOfferNote}
            />
            <View style={s.modalActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setShowOffer(false)}
                style={s.modalCancel}
              />
              <Button
                label="Send offer"
                variant="primary"
                onPress={makeOffer}
                disabled={!offerAmt || parseFloat(offerAmt) <= 0}
                style={s.modalSend}
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
  loadingSpinner: { marginTop: S.xxxl + S.xxxl },
  notFound: { textAlign: 'center', marginTop: S.xxxl + S.xxxl, color: C.text3 },

  imgWrap: { position: 'relative' },
  imgPlaceholder: {
    backgroundColor: C.bone2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imgPlaceholderEmoji: { fontSize: T.size.display + 26 },        // 56

  dots: {
    position: 'absolute',
    bottom: S.md,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: S.xs + 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: C.white, width: 18, borderRadius: 3 },

  backBtnWrap:  { position: 'absolute', top: S.md, left: S.md },
  shareBtnWrap: { position: 'absolute', top: S.md, right: S.xxxl + S.xxxl },
  wishBtnWrap:  { position: 'absolute', top: S.md, right: S.lg },
  wishActiveBg: { backgroundColor: 'rgba(255,255,255,0.95)' },

  trustStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingHorizontal: S.xl,
    paddingVertical: S.sm + 2,
    backgroundColor: C.petrolLight,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  trustStripIcon: { fontSize: T.size.sm + 1 },
  trustStripText: { fontSize: T.size.sm, fontWeight: T.weight.bold, color: C.petrolText, flex: 1 },
  trustScore: {
    backgroundColor: C.white,
    paddingHorizontal: S.sm,
    paddingVertical: 3,
    borderRadius: R.xs,
  },
  trustScoreText: { fontSize: T.size.sm, fontWeight: T.weight.bold, color: C.petrol },

  info: { paddingHorizontal: S.xl, paddingTop: S.lg },
  title: {
    fontSize: T.size.xl - 1,                                      // 19
    fontWeight: T.weight.bold,
    color: C.ink,
    lineHeight: 25,
    letterSpacing: -0.3,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.sm },
  price: {
    fontSize: T.size.display - 4,                                 // 26
    fontWeight: T.weight.heavy,
    color: C.ink,
    letterSpacing: -0.5,
  },
  mrp: { fontSize: T.size.base, color: C.text4, textDecorationLine: 'line-through' },
  off: { fontSize: T.size.sm, fontWeight: T.weight.heavy, color: C.petrolMid },
  negoTag: {
    backgroundColor: C.petrolLight,
    paddingHorizontal: S.sm + 2,
    paddingVertical: S.xs,
    borderRadius: R.xs,
  },
  negoText: { fontSize: T.size.sm, fontWeight: T.weight.bold, color: C.petrolDeep },

  imeiVerified: {
    fontSize: T.size.sm,
    color: C.petrol,
    fontWeight: T.weight.semi,
    marginTop: 3,
  },
  fairPriceRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2, marginTop: S.xs },
  fairPriceLabel: { fontSize: T.size.sm, color: C.green, fontWeight: T.weight.bold },
  fairPriceMrp: { fontSize: T.size.sm, color: C.text4, textDecorationLine: 'line-through' },
  fairPriceOff: { fontSize: T.size.sm, color: C.green, fontWeight: T.weight.semi },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2, marginTop: S.sm },
  condBadge: { paddingHorizontal: S.sm, paddingVertical: 3, borderRadius: R.xs },
  condBadgeText: { fontSize: T.size.sm, fontWeight: T.weight.bold },
  meta: { fontSize: T.size.base - 1, color: C.text3 },
  metaDot: { color: C.text4 },

  chips: { paddingHorizontal: S.xl, paddingVertical: S.md + 2, gap: S.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: S.sm,
    paddingHorizontal: S.md + 2, paddingVertical: S.sm + 2,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: R.sm,
  },
  chipIcon: { fontSize: T.size.sm + 1 },
  chipLabel: { fontSize: T.size.xs, color: C.text3 },
  chipVal: { fontSize: T.size.base - 1, fontWeight: T.weight.bold, color: C.ink },

  seller: {
    marginHorizontal: S.xl, padding: S.md + 2,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: R.lg,
    flexDirection: 'row', alignItems: 'center', gap: S.md,
  },
  sellerInfo: { flex: 1 },
  sellerAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.petrolLight,
    alignItems: 'center', justifyContent: 'center',
  },
  sellerInitial: { fontSize: T.size.lg - 1, fontWeight: T.weight.bold, color: C.petrolDeep },
  sellerName: { fontSize: T.size.sm + 1, fontWeight: T.weight.bold, color: C.petrol },
  sellerStatRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2, marginTop: 2 },
  sellerBadge: {
    backgroundColor: C.petrolLight,
    paddingHorizontal: S.xs + 2, paddingVertical: 2,
    borderRadius: R.xs - 2,
  },
  sellerBadgeText: { fontSize: T.size.xs, fontWeight: T.weight.bold, color: C.petrol },
  sellerStat: { fontSize: T.size.sm, color: C.text3 },

  section: { paddingHorizontal: S.xl, marginTop: S.lg },
  sectionTitle: {
    fontSize: T.size.md, fontWeight: T.weight.semi,
    color: C.text, marginBottom: S.sm,
  },
  desc: { fontSize: T.size.base, color: C.text2, lineHeight: 20 },

  kidsSafetyIntro: { fontSize: T.size.sm, color: C.text3, marginBottom: S.sm },
  kidsRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  kidsCheck: { fontSize: T.size.lg - 1, marginRight: S.sm },
  kidsLabel: { flex: 1, fontSize: T.size.base },

  feAssistedRow: {
    paddingHorizontal: S.xl, marginTop: S.lg,
    flexDirection: 'row', alignItems: 'center', gap: S.sm,
  },
  feAssistedIcon: { fontSize: T.size.lg },
  feAssistedText: { flex: 1 },
  feAssistedTitle: { fontSize: T.size.base, fontWeight: T.weight.bold, color: C.text },
  feAssistedSub: { fontSize: T.size.sm, color: C.text3, marginTop: 2 },

  bottomSpacer: { height: 120 },

  reportRow: { paddingVertical: S.md + 2, paddingHorizontal: S.lg },
  reportText: { fontSize: T.size.base, color: C.red },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.surface,
    borderTopWidth: 1, borderTopColor: C.border,
    paddingHorizontal: S.xl, paddingTop: S.md,
    flexDirection: 'row', gap: S.sm + 2,                            // 10
  },
  offerOutlineBtn:{ flex: 1, borderWidth: 1.5, borderColor: C.petrol },
  buyBtn:         { flex: 2, ...Shadow.glow },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    padding: S.xl,
  },
  modalTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text },
  modalAsking: { fontSize: T.size.base, color: C.text3, marginTop: 2 },
  modalRules: {
    fontSize: T.size.sm, color: C.text4, marginTop: S.xs + 2,
    lineHeight: 16,
  },
  modalAmtRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.lg },
  modalRupee: { fontSize: T.size.xxl - 2, fontWeight: T.weight.semi, color: C.text },
  modalInput: {
    flex: 1,
    borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: S.md, paddingVertical: S.md,
    fontSize: T.size.lg - 1,
    color: C.text, backgroundColor: C.bone,
  },
  modalNote: { marginTop: S.sm, flex: undefined },                 // override flex for non-row layout
  modalActions: { flexDirection: 'row', gap: S.sm, marginTop: S.lg },
  modalCancel: { flex: 1 },
  modalSend:   { flex: 2 },
});
