import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, FlatList, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, useWindowDimensions, Share , Image} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { C, T, S, R, Shadow, formatPrice, formatDistance, timeAgo, percentOff, condStyle } from '../../utils/tokens';
import { Listings, Offers, Wishlist, type Listing } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { parseApiError } from '../../utils/errors';
import type { RootScreen } from '../../navigation/types';

// Sprint 4 / Pass 3: kids safety checklist labels — must match FeCaptureScreen
const KIDS_SAFETY_PANEL_KEYS: { key: string; label: string }[] = [
  { key: 'cleaned', label: 'Cleaned / sanitised' },
  { key: 'no_small_parts', label: 'No small parts that can be swallowed' },
  { key: 'no_loose_batteries', label: 'No loose or accessible batteries' },
  { key: 'no_sharp_edges', label: 'No sharp edges or broken pieces' },
  { key: 'original_packaging', label: 'Original packaging available' },
  { key: 'working_condition', label: 'Working condition' },
  { key: 'no_recalled_model', label: 'Not a recalled model' },
  { key: 'age_label_correct', label: 'Age suitability confirmed' },
];

export default function ListingDetailScreen({ navigation, route }: RootScreen<'ListingDetail'>) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { listingId } = route.params;
  const { isAuthenticated, kycStatus, userId } = useAuthStore();
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
        try { const rv = JSON.parse(await AsyncStorage.getItem('@ow_recent_viewed') || '[]'); await AsyncStorage.setItem('@ow_recent_viewed', JSON.stringify([listingId,...rv.filter((x:string)=>x!==listingId)].slice(0,20))); } catch {}
        // FIX: Wishlist.list doesn't exist — use Wishlist.list and filter
        if (isAuthenticated) {
          try {
            const w = await Wishlist.list();
            const items = w.data?.wishlist || [];
            setWishlisted(items.some((i: any) => i.listing_id === listingId));
          } catch {}
        }
      } catch {} finally { setLoading(false); }
    })();
  }, [listingId]));

  if (loading) return <SafeAreaView style={s.safe}><ActivityIndicator color={C.honey} style={{ marginTop: 60 }} /></SafeAreaView>;
  if (!listing) return <SafeAreaView style={s.safe}><Text style={{ textAlign: 'center', marginTop: 60, color: C.text3 }}>Not found</Text></SafeAreaView>;

  const images = listing.image_urls?.length ? listing.image_urls : listing.images?.length ? listing.images : [];
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

  const makeOffer = async () => {
    if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
    try {
      // FIX: Offers.create now sends offered_price (matches backend schema)
      await Offers.create(listingId, parseFloat(offerAmt), offerNote || undefined);
      setShowOffer(false);
      setOfferAmt('');
      setOfferNote('');
      Alert.alert('Offer sent!', 'The seller will respond within 48 hours.');
    } catch (e: any) {
      // FIX: use parseApiError instead of accessing detail.error directly
      Alert.alert('Error', parseApiError(e, 'Could not send offer'));
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Image carousel */}
        <View style={[s.imgWrap, { width, height: imgH }]}>
          {images.length > 0 ? (
            <FlatList horizontal pagingEnabled showsHorizontalScrollIndicator={false}
              data={images} keyExtractor={(_, i) => String(i)}
              onMomentumScrollEnd={e => setImgIdx(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item: uri, index: i }) => (
                <Image
                  source={{ uri, priority: i === 0 ? undefined : undefined }}
                  style={{ width, height: imgH }} resizeMode={"cover"}
                />
              )}
              removeClippedSubviews initialNumToRender={1} maxToRenderPerBatch={2} windowSize={3}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            />
          ) : <View style={{ width, height: imgH, backgroundColor: C.sand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 56 }}>📦</Text></View>}
          {images.length > 1 && <View style={s.dots}>{images.map((_, i) => <View key={i} style={[s.dot, i === imgIdx && s.dotOn]} />)}</View>}
          <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}><Text style={{ fontSize: 18, color: '#fff' }}>←</Text></TouchableOpacity>
          <TouchableOpacity style={s.shareBtn} onPress={() => Share.share({ message: `Check out ${listing.title} on Owmee for ${formatPrice(listing.price)}! https://owmee.in/listing/${listingId}` }).catch(() => {})}><Text style={{ fontSize: 16 }}>↗</Text></TouchableOpacity>
          {!isOwn && <TouchableOpacity style={s.wishBtn} onPress={toggleWish}><Text style={{ fontSize: 18, color: wishlisted ? C.red : C.text3 }}>{wishlisted ? '♥' : '♡'}</Text></TouchableOpacity>}
        </View>

        {/* Trust strip */}
        {listing.seller_verified && (
          <View style={s.trustStrip}>
            <Text style={{ fontSize: 14 }}>🛡️</Text>
            <Text style={s.trustStripText}>Aadhaar verified seller{listing.imei ? ' · IMEI checked' : ''}</Text>
            {listing.seller?.avg_rating && <View style={s.trustScore}><Text style={s.trustScoreText}>{listing.seller.avg_rating.toFixed(1)}★</Text></View>}
          </View>
        )}

        {/* Info */}
        <View style={s.info}>
          <Text style={s.title}>{listing.title}</Text>
          <View style={s.priceRow}>
            <Text style={s.price}>{formatPrice(listing.price)}</Text>
          {listing.imei_verified && <Text style={{fontSize:11,color:C.forest,fontWeight:'600',marginTop:3}}>✓ IMEI verified — not blacklisted</Text>}
          {listing.original_price && listing.price < listing.original_price && (
            <View style={{flexDirection:'row',alignItems:'center',gap:6,marginTop:4}}>
              <Text style={{fontSize:12,color:C.green,fontWeight:'700'}}>✓ Fair price</Text>
              <Text style={{fontSize:11,color:C.text4,textDecorationLine:'line-through'}}>{formatPrice(listing.original_price)}</Text>
              <Text style={{fontSize:11,color:C.green,fontWeight:'600'}}>{Math.round((1 - listing.price / listing.original_price) * 100)}% off</Text>
            </View>
          )}
            {listing.original_price ? <Text style={s.mrp}>{formatPrice(listing.original_price)}</Text> : null}
            {off ? <Text style={s.off}>{off}% off</Text> : null}
            {listing.is_negotiable && <View style={s.negoTag}><Text style={s.negoText}>Negotiable</Text></View>}
          </View>
          <View style={s.metaRow}>
            <View style={[s.condBadge, { backgroundColor: cs.bg }]}><Text style={[s.condBadgeText, { color: cs.color }]}>{cs.label}</Text></View>
            <Text style={s.metaDot}>·</Text><Text style={s.meta}>{listing.city}</Text>
            {listing.distance_km != null && <><Text style={s.metaDot}>·</Text><Text style={s.meta}>{formatDistance(listing.distance_km)}</Text></>}
            {listing.published_at && <><Text style={s.metaDot}>·</Text><Text style={s.meta}>{timeAgo(listing.published_at)}</Text></>}
          </View>
        </View>

        {/* Detail chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {listing.battery_health && <View style={s.chip}><Text style={{ fontSize: 14 }}>🔋</Text><View><Text style={s.chipLabel}>Battery</Text><Text style={s.chipVal}>{listing.battery_health}%</Text></View></View>}
          {listing.accessories && <View style={s.chip}><Text style={{ fontSize: 14 }}>📦</Text><View><Text style={s.chipLabel}>Accessories</Text><Text style={s.chipVal}>{listing.accessories}</Text></View></View>}
          {listing.warranty_status && <View style={s.chip}><Text style={{ fontSize: 14 }}>🔐</Text><View><Text style={s.chipLabel}>Warranty</Text><Text style={s.chipVal}>{listing.warranty_status}</Text></View></View>}
          {listing.view_count != null && <View style={s.chip}><Text style={{ fontSize: 14 }}>👁</Text><View><Text style={s.chipLabel}>Views</Text><Text style={s.chipVal}>{listing.view_count}</Text></View></View>}
        </ScrollView>

        {/* Seller card */}
        {listing.seller && (
          <View style={s.seller}>
            <View style={s.sellerAvatar}><Text style={s.sellerInitial}>{(listing.seller.name || 'S').charAt(0)}</Text></View>
            <View style={{ flex: 1 }}>
              <TouchableOpacity onPress={() => navigation.navigate('SellerProfile', { seller: { id: listing.seller_id, name: listing.seller?.name, city: listing.city, kyc_verified: listing.seller?.kyc_verified, avg_rating: listing.seller?.avg_rating, deal_count: listing.seller?.deal_count } })}>
              <Text style={[s.sellerName, { color: C.honey }]}>{listing.seller.name || 'Seller'} →</Text>
            </TouchableOpacity>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                {listing.seller.kyc_verified && <View style={s.sellerBadge}><Text style={s.sellerBadgeText}>✓ Verified</Text></View>}
                {listing.seller.deal_count ? <Text style={s.sellerStat}>{listing.seller.deal_count} items sold</Text> : null}
                {listing.seller.avg_rating ? <Text style={s.sellerStat}>· {listing.seller.avg_rating.toFixed(1)}★</Text> : null}
              </View>
            </View>
          </View>
        )}

        {listing.description && <View style={s.section}><Text style={s.sectionTitle}>Description</Text><Text style={s.desc}>{listing.description}</Text></View>}

        {/* Sprint 4 / Pass 3: Kids safety checklist panel */}
        {listing.is_kids_item && listing.kids_safety_checklist && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Safety checklist</Text>
            <Text style={{ fontSize: 12, color: C.text3, marginBottom: 8 }}>
              The seller has verified the following for this kids item:
            </Text>
            {KIDS_SAFETY_PANEL_KEYS.map(({ key, label }) => {
              const checked = !!(listing.kids_safety_checklist as any)?.[key];
              return (
                <View key={key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5 }}>
                  <Text style={{ fontSize: 16, marginRight: 8, color: checked ? '#1F6B3A' : C.text4 }}>
                    {checked ? '✓' : '○'}
                  </Text>
                  <Text style={{ flex: 1, fontSize: 13, color: checked ? C.text2 : C.text4 }}>
                    {label}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Sprint 4 / Pass 3: Ops-verified badge for fe_assisted listings */}
        {listing.listing_source === 'fe_assisted' && (
          <View style={[s.section, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <Text style={{ fontSize: 18 }}>🤝</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>
                Listed by an Owmee Field Executive
              </Text>
              <Text style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>
                {listing.reviewed_by === 'fe_and_ops'
                  ? 'FE captured on-site · Ops reviewed'
                  : 'FE captured on-site'}
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: 120 }} />
      <TouchableOpacity style={{paddingVertical:14,paddingHorizontal:16}} onPress={() => Alert.alert('Report listing','Why are you reporting?',[{text:'Fake/misleading'},{text:'Stolen item'},{text:'Inappropriate'},{text:'Cancel',style:'cancel'}])}>
          <Text style={{fontSize:13,color:C.red}}>⚑ Report this listing</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bottom CTA */}
      {!isOwn && (
        <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity style={s.chatBtn} onPress={() => Alert.alert('Coming soon', 'Chat will be available in the next update. For now, you can buy directly or make an offer.')}><Text style={s.chatBtnText}>Chat</Text></TouchableOpacity>
          {listing.is_negotiable && (
            <TouchableOpacity style={[s.offerBtn, {flex:1, borderWidth:1.5, borderColor:C.honey, backgroundColor:'transparent'}]} onPress={() => { if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; } setShowOffer(true); }}>
              <Text style={[s.offerBtnText, {color:C.honey}]}>Offer</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.offerBtn} onPress={() => {
            if (!isAuthenticated) { navigation.navigate('AuthFlow'); return; }
            navigation.navigate('Checkout', { listingId });
          }}>
            <Text style={s.offerBtnText}>Buy Now →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Offer modal */}
      <Modal visible={showOffer} transparent animationType="slide">
        <View style={s.modalBg}><View style={s.modal}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: C.text }}>Make an offer</Text>
          <Text style={{ fontSize: 13, color: C.text3, marginTop: 2 }}>Asking: {formatPrice(listing.price)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <Text style={{ fontSize: 22, fontWeight: '600', color: C.text }}>₹</Text>
            <TextInput style={s.modalInput} placeholder="Your offer" placeholderTextColor={C.text4} keyboardType="numeric" value={offerAmt} onChangeText={setOfferAmt} autoFocus />
          </View>
          <TextInput style={[s.modalInput, { marginTop: 8 }]} placeholder="Add a note (optional)" placeholderTextColor={C.text4} value={offerNote} onChangeText={setOfferNote} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            <TouchableOpacity style={s.modalCancel} onPress={() => setShowOffer(false)}><Text style={{ fontSize: 14, color: C.text3 }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[s.offerBtn, { flex: 2 }]} onPress={makeOffer} disabled={!offerAmt || parseFloat(offerAmt) <= 0}><Text style={s.offerBtnText}>Send offer</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  imgWrap: { position: 'relative' },
  dots: { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: '#fff', width: 18, borderRadius: 3 },
  backBtn: { position: 'absolute', top: 12, left: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
  shareBtn: { position: 'absolute', top: 12, right: 64, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  wishBtn: { position: 'absolute', top: 12, right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' },
  trustStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: S.xl, paddingVertical: 10, backgroundColor: C.forestLight, borderBottomWidth: 1, borderBottomColor: '#cde9dc' },
  trustStripText: { fontSize: T.size.sm, fontWeight: '700', color: C.forestText, flex: 1 },
  trustScore: { backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  trustScoreText: { fontSize: T.size.sm, fontWeight: '700', color: C.forest },
  info: { paddingHorizontal: S.xl, paddingTop: S.lg },
  title: { fontSize: 19, fontWeight: '700', color: C.ink, lineHeight: 25, letterSpacing: -0.3 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  price: { fontSize: 26, fontWeight: '800', color: C.ink, letterSpacing: -0.5 },
  mrp: { fontSize: 13, color: C.text4, textDecorationLine: 'line-through' },
  off: { fontSize: 12, fontWeight: '800', color: C.forestVivid },
  negoTag: { backgroundColor: C.honeyLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  negoText: { fontSize: T.size.sm, fontWeight: '700', color: C.honeyDeep },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  condBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  condBadgeText: { fontSize: T.size.sm, fontWeight: '700' },
  meta: { fontSize: T.size.base - 1, color: C.text3 },
  metaDot: { color: C.text4 },
  chips: { paddingHorizontal: S.xl, paddingVertical: 14, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: R.sm },
  chipLabel: { fontSize: T.size.xs, color: C.text3 },
  chipVal: { fontSize: T.size.base - 1, fontWeight: '700', color: C.ink },
  seller: { marginHorizontal: S.xl, padding: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: R.lg, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sellerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.honeyLight, alignItems: 'center', justifyContent: 'center' },
  sellerInitial: { fontSize: 16, fontWeight: '700', color: C.honeyDeep },
  sellerName: { fontSize: 14, fontWeight: '700', color: C.ink },
  sellerBadge: { backgroundColor: C.forestLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  sellerBadgeText: { fontSize: 10, fontWeight: '700', color: C.forest },
  sellerStat: { fontSize: 11, color: C.text3 },
  section: { paddingHorizontal: S.xl, marginTop: S.lg },
  sectionTitle: { fontSize: T.size.md, fontWeight: '600', color: C.text, marginBottom: 8 },
  desc: { fontSize: T.size.base, color: C.text2, lineHeight: 20 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: S.xl, paddingTop: 12, flexDirection: 'row', gap: 10 },
  chatBtn: { flex: 1, paddingVertical: 14, borderRadius: R.sm, borderWidth: 1.5, borderColor: C.honey, alignItems: 'center' },
  chatBtnText: { fontSize: 14, fontWeight: '700', color: C.honey },
  offerBtn: { flex: 2, paddingVertical: 14, borderRadius: R.sm, backgroundColor: C.honey, alignItems: 'center', ...Shadow.glow },
  offerBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: S.xl },
  modalInput: { borderWidth: 0.5, borderColor: C.border, borderRadius: R.sm, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: C.text, backgroundColor: C.cream },
  modalCancel: { flex: 1, borderRadius: R.sm, paddingVertical: 12, alignItems: 'center', borderWidth: 0.5, borderColor: C.border },
});
