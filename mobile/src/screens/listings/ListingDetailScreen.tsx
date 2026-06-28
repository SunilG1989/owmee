import React, { useEffect, useRef, useState, useCallback } from 'react';
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
import { Listings, Offers, Reports, Wishlist, type Listing } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { Button, IconButton } from '../../components/ui';
import { parseApiError } from '../../utils/errors';
import { afterInteractions } from '../../utils/schedule';
import type { RootScreen } from '../../navigation/types';
import { buildListingProductFacts, type ProductFact } from '../../utils/listingDisplay';

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

function PremiumGalleryImage({ uri, width, height }: { uri: string; width: number; height: number }) {
  return (
    <View style={[s.galleryFrame, { width, height }]}>
      <Image source={{ uri }} style={s.galleryBackdrop} resizeMode="cover" blurRadius={18} />
      <View style={s.galleryWash} />
      <Image source={{ uri }} style={{ width, height }} resizeMode="contain" />
    </View>
  );
}

function imageIdentity(uri?: string | null): string | null {
  if (!uri) return null;
  const clean = uri.split('?')[0];
  return clean
    .replace(/\.thumb\.webp$/i, '')
    .replace(/\.display\.webp$/i, '');
}

function buildGalleryImages(listing: Listing): string[] {
  const gallery = (
    (listing.image_urls?.length ? listing.image_urls : listing.images) || []
  );
  const candidates = [
    ...gallery,
    listing.thumbnail_url,
  ].filter(Boolean) as string[];
  const seen = new Set<string>();
  return candidates.filter((uri) => {
    const key = imageIdentity(uri) || uri;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function ListingDetailScreen({ navigation, route }: RootScreen<'ListingDetail'>) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { listingId, openOffer, initialListing } = route.params;
  const { isAuthenticated, userId } = useAuthStore();
  const visibleListingRef = useRef(!!initialListing);
  const [listing, setListing] = useState<Listing | null>((initialListing as Listing | undefined) ?? null);
  const [loading, setLoading] = useState(!initialListing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wishlisted, setWishlisted] = useState(false);
  const [showOffer, setShowOffer] = useState(false);
  const [offerAmt, setOfferAmt] = useState('');
  const [imgIdx, setImgIdx] = useState(0);
  const didAutoOpenOffer = useRef(false);
  const imgH = width * 0.85;

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    if (!visibleListingRef.current) setLoading(true);
    setLoadError(null);

    const cancelTask = afterInteractions(() => {
      Listings.get(listingId)
        .then((r) => {
          if (cancelled) return;
          visibleListingRef.current = true;
          setListing(r.data);
        })
        .catch((e) => {
          if (cancelled) return;
          setLoadError(parseApiError(e, 'This listing could not be loaded.'));
          if (!visibleListingRef.current) setListing(null);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      // Non-critical side effects should not keep the product page spinner up.
      AsyncStorage.getItem('@ow_recent_viewed')
        .then((s) => {
          const rv = JSON.parse(s || '[]');
          return AsyncStorage.setItem(
            '@ow_recent_viewed',
            JSON.stringify([listingId, ...rv.filter((x: string) => x !== listingId)].slice(0, 20)),
          );
        })
        .catch(() => {});

      if (isAuthenticated) {
        Wishlist.list()
          .then((w) => {
            if (cancelled) return;
            const items = w.data?.wishlist || [];
            setWishlisted(items.some((i: any) => i.listing_id === listingId));
          })
          .catch((e) => {
            if (!cancelled) console.warn('[ListingDetail.wishlistLoad]', e);
          });
      }
    });

    return () => { cancelled = true; cancelTask(); };
  }, [listingId, isAuthenticated]));

  useEffect(() => {
    if (!openOffer || didAutoOpenOffer.current || !listing) return;
    if (listing.seller_id === userId) return;
    didAutoOpenOffer.current = true;
    if (!isAuthenticated) {
      navigation.navigate('AuthFlow');
      return;
    }
    if (listing.is_negotiable) setShowOffer(true);
  }, [openOffer, listing, userId, isAuthenticated, navigation]);

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
        <Text style={s.notFound}>{loadError || 'Listing not found'}</Text>
        <Button
          label="Back to Home"
          variant="secondary"
          onPress={() => (navigation as any).navigate('MainTabs')}
          style={s.notFoundBtn}
        />
      </SafeAreaView>
    );
  }

  const images = buildGalleryImages(listing);
  const isOwn = listing.seller_id === userId;
  const off = percentOff(listing.price, listing.original_price);
  const cs = condStyle(listing.condition);
  const productFacts = buildListingProductFacts(listing, cs.label);

  const toggleWish = async () => {
    if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
    const next = !wishlisted;
    setWishlisted(next);
    try {
      if (wishlisted) await Wishlist.remove(listingId);
      else await Wishlist.add(listingId);
    } catch (e) {
      setWishlisted(!next);
      Alert.alert('Could not update saved item', parseApiError(e, 'Please try again.'));
    }
  };

  const onShare = () => {
    Share.share({
      message: `Check out ${listing.title} on Owmee for ${formatPrice(listing.price)}! https://owmee.in/listing/${listingId}`,
    }).catch(() => {});
  };

  const submitReport = async (reportType: string, description: string) => {
    try {
      await Reports.reportListing(listingId, reportType, description);
      Alert.alert('Report submitted', 'Thanks. Our team will review this listing.');
    } catch (e) {
      Alert.alert('Could not submit report', parseApiError(e, 'Please try again.'));
    }
  };

  const onReport = () => {
    if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
    Alert.alert('Report listing', 'Why are you reporting?', [
      { text: 'Fake or misleading', onPress: () => submitReport('fraud', 'Fake or misleading listing') },
      { text: 'Counterfeit or stolen', onPress: () => submitReport('counterfeit', 'Counterfeit or possibly stolen item') },
      { text: 'Inappropriate', onPress: () => submitReport('inappropriate', 'Inappropriate listing content') },
      { text: 'Other issue', onPress: () => submitReport('other', 'Other listing issue') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const askOwmeeToVerify = async () => {
    if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
    try {
      await Reports.reportListing(
        listingId,
        'other',
        'Buyer requested Owmee verification before purchase.',
      );
      Alert.alert(
        'Verification requested',
        'Owmee will review this listing and support the next step if you choose to buy safely.',
      );
    } catch (e) {
      Alert.alert('Could not request verification', parseApiError(e, 'Please try again.'));
    }
  };

  const makeOffer = async () => {
    if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
    try {
      await Offers.create(listingId, parseFloat(offerAmt));
      setShowOffer(false);
      setOfferAmt('');
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
  const detailDealSignal = fairPriceOff != null
    ? fairPriceOff >= 20
      ? 'Great deal'
      : fairPriceOff >= 8
        ? 'Price dropped'
        : 'Fair price'
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
                <PremiumGalleryImage uri={uri} width={width} height={imgH} />
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

          <View pointerEvents="box-none" style={s.heroControls}>
            <IconButton
              icon="←"
              onPress={() => navigation.goBack()}
              a11y="Back"
              variant="floating"
              size="overlay"
            />
            <View style={s.heroActions}>
              <IconButton
                icon="↗"
                onPress={onShare}
                a11y="Share listing"
                variant="floating"
                size="overlay"
              />
              {!isOwn && (
                <IconButton
                  icon={wishlisted ? '♥' : '♡'}
                  onPress={toggleWish}
                  a11y={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                  variant="floating"
                  size="overlay"
                  style={wishlisted ? s.wishActiveBg : undefined}
                />
              )}
            </View>
          </View>
        </View>

        {/* Info */}
        <View style={s.info}>
          <Text style={s.title}>{listing.title}</Text>

          <View style={s.priceRow}>
            <Text style={s.price}>{formatPrice(listing.price)}</Text>
            {listing.original_price ? (
              <Text style={s.mrp}>MRP {formatPrice(listing.original_price)}</Text>
            ) : null}
            {off ? <Text style={s.off}>{off}% off</Text> : null}
          </View>

          {listing.imei_verified && (
            <Text style={s.imeiVerified}>✓ IMEI verified — not blacklisted</Text>
          )}
          {fairPriceOff != null && (
            <View style={s.fairPriceRow}>
              <Text style={s.fairPriceLabel}>✓ {detailDealSignal}</Text>
              <Text style={s.fairPriceMrp}>MRP {formatPrice(listing.original_price!)}</Text>
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

        <ProductDetailsSection facts={productFacts} />

        {listing.description && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Description</Text>
            <Text style={s.desc}>{listing.description}</Text>
          </View>
        )}

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
                  ? 'Specialist captured on-site · Ops reviewed'
                  : 'Specialist captured on-site'}
              </Text>
            </View>
          </View>
        )}

        <View style={s.buyerProtectionCard}>
          <Text style={s.buyerProtectionTitle}>Buyer protection</Text>
          <View style={s.protectionRow}>
            <Text style={s.protectionBullet}>✓</Text>
            <Text style={s.protectionText}>Protected payment through Owmee</Text>
          </View>
          <View style={s.protectionRow}>
            <Text style={s.protectionBullet}>✓</Text>
            <Text style={s.protectionText}>Payment and delivery support included</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.78}
            onPress={askOwmeeToVerify}
            style={s.verifyInline}
          >
            <Text style={s.verifyInlineText}>Ask Owmee to verify this listing</Text>
          </TouchableOpacity>
        </View>

        <View style={s.bottomSpacer} />

        <TouchableOpacity style={s.reportRow} onPress={onReport}>
          <Text style={s.reportText}>⚑ Report this listing</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bottom CTA */}
      {!isOwn && (
        <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, S.lg) }]}>
          <View style={s.bottomActionRow}>
            <Button
              label="Buy safely"
              variant="primary"
              onPress={() => {
                if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
                navigation.navigate('Checkout', { listingId });
              }}
              style={s.buyBtn}
            />
            {listing.is_negotiable && (
              <Button
                label="Make offer"
                variant="secondary"
                onPress={() => {
                  if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
                  setShowOffer(true);
                }}
                style={s.offerOutlineBtn}
              />
            )}
          </View>
          <Text style={s.bottomHelper}>
            Owmee manages payment and delivery support.
          </Text>
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
              />
            </View>
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

function ProductDetailsSection({ facts }: { facts: ProductFact[] }) {
  if (!facts.length) return null;
  return (
    <View style={s.productDetails}>
      <Text style={s.productDetailsTitle}>Product details</Text>
      <View style={s.productFactGrid}>
        {facts.map((fact) => (
          <View key={fact.label} style={s.productFact}>
            <Text style={s.productFactLabel}>{fact.label}</Text>
            <Text style={s.productFactValue} numberOfLines={2}>
              {fact.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  loadingSpinner: { marginTop: S.xxxl + S.xxxl },
  notFound: { textAlign: 'center', marginTop: S.xxxl + S.xxxl, color: C.text3 },
  notFoundBtn: { marginTop: S.lg, marginHorizontal: S.xl },

  imgWrap: { position: 'relative' },
  galleryFrame: {
    overflow: 'hidden',
    backgroundColor: C.bone2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryBackdrop: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.78,
    transform: [{ scale: 1.08 }],
  },
  galleryWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(254, 251, 244, 0.18)',
  },
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

  heroControls: {
    position: 'absolute',
    top: S.md,
    left: S.lg,
    right: S.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: S.sm },
  wishActiveBg: {
    backgroundColor: 'rgba(234, 244, 241, 0.96)',
    borderColor: C.petrolGlow,
  },

  info: { paddingHorizontal: S.xl, paddingTop: S.lg },
  title: {
    fontSize: T.size.xl - 1,                                      // 19
    fontWeight: T.weight.bold,
    color: C.ink,
    lineHeight: 25,
    letterSpacing: -0.3,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: S.sm, marginTop: S.sm },
  price: {
    fontSize: T.size.display - 4,                                 // 26
    fontWeight: T.weight.heavy,
    color: C.ink,
    letterSpacing: -0.5,
  },
  mrp: { flexShrink: 1, fontSize: T.size.base, color: C.text4, textDecorationLine: 'line-through' },
  off: { fontSize: T.size.sm, fontWeight: T.weight.heavy, color: C.petrolMid },

  imeiVerified: {
    fontSize: T.size.sm,
    color: C.petrol,
    fontWeight: T.weight.semi,
    marginTop: 3,
  },
  fairPriceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: S.xs + 2, marginTop: S.xs },
  fairPriceLabel: { fontSize: T.size.sm, color: C.green, fontWeight: T.weight.bold },
  fairPriceMrp: { fontSize: T.size.sm, color: C.text4, textDecorationLine: 'line-through' },
  fairPriceOff: { fontSize: T.size.sm, color: C.green, fontWeight: T.weight.semi },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: S.xs + 2, marginTop: S.sm },
  condBadge: { paddingHorizontal: S.sm, paddingVertical: 3, borderRadius: R.xs },
  condBadgeText: { fontSize: T.size.sm, fontWeight: T.weight.bold },
  meta: { fontSize: T.size.base - 1, color: C.text3 },
  metaDot: { color: C.text4 },

  productDetails: {
    marginHorizontal: S.xl,
    marginTop: S.lg,
    padding: S.md + 2,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
  },
  productDetailsTitle: {
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.sm,
  },
  productFactGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -S.xs,
    rowGap: S.sm,
  },
  productFact: {
    width: '50%',
    paddingHorizontal: S.xs,
  },
  productFactLabel: {
    fontSize: T.size.xs,
    color: C.text3,
    fontWeight: T.weight.semi,
    textTransform: 'uppercase',
  },
  productFactValue: {
    marginTop: 2,
    fontSize: T.size.base,
    lineHeight: T.size.base + 5,
    color: C.text,
    fontWeight: T.weight.bold,
  },

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

  buyerProtectionCard: {
    marginHorizontal: S.xl,
    marginTop: S.lg,
    padding: S.md + 2,
    backgroundColor: C.petrolLight,
    borderWidth: 1,
    borderColor: C.blueBorder,
    borderRadius: R.lg,
  },
  buyerProtectionTitle: { fontSize: T.size.base, fontWeight: T.weight.bold, color: C.petrolDeep },
  protectionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: S.xs + 2, marginTop: S.xs + 2 },
  protectionBullet: { fontSize: T.size.sm, color: C.petrolDeep, fontWeight: T.weight.heavy, marginTop: 1 },
  protectionText: { flex: 1, fontSize: T.size.sm + 1, lineHeight: 18, color: C.petrolText },
  verifyInline: {
    marginTop: S.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: S.sm + 2,
    paddingVertical: S.xs + 2,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.blueBorder,
  },
  verifyInlineText: { fontSize: T.size.sm, color: C.petrolDeep, fontWeight: T.weight.bold },

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

  bottomSpacer: { height: 156 },

  reportRow: { paddingVertical: S.md + 2, paddingHorizontal: S.lg },
  reportText: { fontSize: T.size.base, color: C.red },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.surface,
    borderTopWidth: 1, borderTopColor: C.border2,
    paddingHorizontal: S.xl, paddingTop: S.md,
    gap: S.sm,
  },
  bottomHelper: {
    fontSize: T.size.sm,
    lineHeight: 16,
    color: C.text3,
    textAlign: 'center',
  },
  bottomActionRow: { flexDirection: 'row', gap: S.sm + 2 },
  offerOutlineBtn:{ flex: 1, borderWidth: 1.25, borderColor: C.blueBorder },
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
  modalActions: { flexDirection: 'row', gap: S.sm, marginTop: S.lg },
  modalCancel: { flex: 1 },
  modalSend:   { flex: 2 },
});
