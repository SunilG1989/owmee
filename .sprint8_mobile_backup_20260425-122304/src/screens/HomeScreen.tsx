import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, FlatList, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseApiError } from '../utils/errors';
import { C, T, S, R, Shadow, formatPrice } from '../utils/tokens';
import type { TabScreen } from '../navigation/types';
import { Listings, Notifications, ActivityFeed, type Listing } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useLocation, INDIAN_CITIES } from '../hooks/useLocation';
import { ListingCard, SkeletonCard, ActivityTicker, SectionHeader, calcCardWidth } from '../components/listing/ListingCard';

const CATS = [
  { slug: 'smartphones', icon: '📱', label: 'Phones', bg: '#FFF8EB' },
  { slug: 'laptops', icon: '💻', label: 'Laptops', bg: '#F0F0FF' },
  { slug: 'small-appliances', icon: '🔌', label: 'Appliances', bg: '#FFE8F0' },
  { slug: 'kids-utility', icon: '🧸', label: 'Kids', bg: '#E4F2EA' },
];

export default function HomeScreen({ navigation }: TabScreen<'Home'>) {
  const { isAuthenticated, kycStatus, tier } = useAuthStore();
  const { location, loading: locLoading, denied, request: requestLoc, setManualCity } = useLocation();
  const { width: sw } = useWindowDimensions();
  const cardWidth = useMemo(() => calcCardWidth(sw), [sw]); // T2-07: calculated once

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // #67: Offline detection
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 3000);
        await fetch('https://clients3.google.com/generate_204', { signal: controller.signal });
        setIsOffline(false);
      } catch { setIsOffline(true); }
    };
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, []);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [activityText, setActivityText] = useState<string | null>(null);
  const lastLoc = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => { if (!location && !locLoading) requestLoc(); }, []);

  useEffect(() => {
    if (!location) { loadListings(); return; }
    const p = lastLoc.current;
    if (!p) { lastLoc.current = { lat: location.lat, lng: location.lng }; loadListings(); return; }
    if (Math.abs(p.lat - location.lat) > 0.005 || Math.abs(p.lng - location.lng) > 0.005) {
      lastLoc.current = { lat: location.lat, lng: location.lng }; loadListings();
    }
  }, [location]);

  const loadListings = useCallback(async () => {
    if (!refreshing) setLoading(true);
    setError(null);
    try {
      const params: any = { limit: 20 };
      if (location) { params.lat = location.lat; params.lng = location.lng; params.radius_km = 25; params.city = location.city; }
      const [res] = await Promise.all([Listings.browse(params), loadExtras()]);
      setListings(res.data.listings || []);
    } catch { setError('Could not load listings. Check your connection.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [location, refreshing]);

  const loadExtras = async () => {
    try {
      if (isAuthenticated) { const c = await Notifications.unreadCount(); setUnreadCount(c.data.unread_count || 0); }
      const a = await ActivityFeed.get(); if (a.data?.text) setActivityText(a.data.text);
    } catch {}
  };

  const onPress = (l: Listing) => navigation.navigate('ListingDetail', { listingId: l.id });
  const gridData = !loading && !error && listings.length > 0 ? listings : [];

  const header = useMemo(() => () => (
    <>
      {/* Offline banner */}
      {isOffline && (
        <View style={{backgroundColor:C.red,paddingVertical:8,paddingHorizontal:16,flexDirection:'row',alignItems:'center',gap:8}}>
          <Text style={{fontSize:14}}>📡</Text>
          <Text style={{fontSize:12,color:'#fff',fontWeight:'600'}}>No internet connection</Text>
        </View>
      )}

      {/* Header */}
      <View style={s.hdr}>
        <Text style={s.logo}>owm<Text style={{ color: C.honey }}>ee</Text><Text style={s.logoDot}>●</Text></Text>
        <View style={s.hdrRight}>
          <TouchableOpacity style={s.hdrBtn} onPress={() => isAuthenticated ? navigation.navigate('Notifications') : navigation.navigate('AuthFlow')}>
            <Text style={{ fontSize: 16 }}>🔔</Text>
            {unreadCount > 0 && <View style={s.hdrDot} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Location — Amazon "Items near" pattern */}
      <TouchableOpacity style={s.loc} onPress={() => denied || !location ? setShowCityPicker(true) : requestLoc()}>
        <View style={s.locPin}><Text style={{ fontSize: 12 }}>📍</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.locPre}>Items near</Text>
          <Text style={s.locCity}>{locLoading ? 'Getting location...' : location ? location.city : 'Set your location'} <Text style={s.locArrow}>▾</Text></Text>
        </View>
      </TouchableOpacity>

      {/* Search bar — Flipkart clean */}
      <TouchableOpacity style={s.search} activeOpacity={0.7} onPress={() => navigation.navigate('Search')}>
        <Text style={s.searchIcon}>🔍</Text>
        <Text style={s.searchPh}>Search phones, laptops, toys...</Text>
        <View style={s.searchMic}><Text style={{ fontSize: 12, color: '#fff' }}>🎤</Text></View>
      </TouchableOpacity>

      {/* Trust banner — alive gradient */}
      <View style={s.trust}>
        <View style={s.trustShield}><Text style={{ fontSize: 20 }}>🛡️</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={s.trustTitle}>Every seller is Aadhaar verified</Text>
          <Text style={s.trustSub}>KYC-verified sellers · UPI-protected payments</Text>
        </View>
        <View style={s.trustNums}>
          <View style={{ alignItems: 'center' }}><Text style={s.trustVal}>247</Text><Text style={s.trustLbl}>SELLERS</Text></View>
          <View style={{ alignItems: 'center' }}><Text style={s.trustVal}>98%</Text><Text style={s.trustLbl}>SAFE</Text></View>
        </View>
      </View>

      {/* Categories — rounded rects with warm gradients */}
      <View style={s.cats}>
        {CATS.map(c => (
          <TouchableOpacity key={c.slug} style={s.cat} activeOpacity={0.7} onPress={() => navigation.navigate('Search', { category_slug: c.slug })}>
            <View style={[s.catBox, { backgroundColor: c.bg }]}><Text style={{ fontSize: 22 }}>{c.icon}</Text></View>
            <Text style={s.catName}>{c.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={s.cat}><View style={[s.catBox, { backgroundColor: C.sand }]}><Text style={{ fontSize: 14, color: C.text3 }}>···</Text></View><Text style={s.catName}>More</Text></TouchableOpacity>
      </View>


      {/* KYC prompt — P0: user has no idea they need verification */}
      {isAuthenticated && kycStatus !== 'verified' && (
        <TouchableOpacity style={s.kycPrompt} activeOpacity={0.85} onPress={() => navigation.navigate('KycFlow')}>
          <View style={s.kycPromptIcon}><Text style={{ fontSize: 20 }}>🪪</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.kycPromptTitle}>Complete Aadhaar verification</Text>
            <Text style={s.kycPromptSub}>Required to buy or sell. Takes 2 minutes.</Text>
          </View>
          <Text style={{ fontSize: 20, color: C.honey }}>→</Text>
        </TouchableOpacity>
      )}

      {/* Divider — Flipkart thick */}
      <View style={s.divider} />

      {activityText && <ActivityTicker text={activityText} />}

      <SectionHeader title={location ? `Near ${location.city}` : 'Latest listings'} onSeeAll={() => navigation.navigate('Search')} />

      {/* Loading skeletons */}
      {loading && <View style={s.skelRow}><SkeletonCard cardWidth={cardWidth} /><SkeletonCard cardWidth={cardWidth} /></View>}

      {/* Error state */}
      {!loading && error && (
        <View style={s.empty}><Text style={{ fontSize: 40, marginBottom: S.lg }}>⚠️</Text>
          <Text style={s.emptyTitle}>Something went wrong</Text><Text style={s.emptySub}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={loadListings}><Text style={s.retryText}>Try again</Text></TouchableOpacity></View>
      )}

      {!loading && !error && listings.length === 0 && (
        <View style={s.empty}><Text style={{ fontSize: 40, marginBottom: S.lg }}>📦</Text>
          <Text style={s.emptyTitle}>No listings nearby yet</Text>
          <Text style={s.emptySub}>Be the first to list something in {location?.city || 'your city'}!</Text></View>
      )}
    </>
  ), [loading, error, listings.length, location, activityText, unreadCount, locLoading, denied, cardWidth]);

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <FlatList data={gridData} keyExtractor={i => i.id} numColumns={2}
        columnWrapperStyle={s.gridRow} ListHeaderComponent={header} ListFooterComponent={<View style={{ height: 100 }} />}
        renderItem={({ item }) => <ListingCard listing={item} onPress={onPress} showDistance={!!location} cardWidth={cardWidth} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadListings(); }} tintColor={C.honey} />}
        showsVerticalScrollIndicator={false} removeClippedSubviews maxToRenderPerBatch={6} windowSize={5} initialNumToRender={4}
      />

      {/* City picker */}
      <Modal visible={showCityPicker} animationType="slide" transparent>
        <View style={s.modalOv}><View style={s.modalC}>
          <Text style={s.modalT}>Select your city</Text>
          <ScrollView>{INDIAN_CITIES.map(c => (
            <TouchableOpacity key={c.name} style={s.cityRow} onPress={() => { setManualCity(c); setShowCityPicker(false); }}>
              <Text style={s.cityName}>{c.name}</Text>
              {location?.city === c.name && <Text style={{ fontSize: T.size.md, color: C.honey, fontWeight: '700' }}>✓</Text>}
            </TouchableOpacity>
          ))}</ScrollView>
          <TouchableOpacity style={s.modalClose} onPress={() => setShowCityPicker(false)}><Text style={{ fontSize: T.size.md, color: C.text3 }}>Cancel</Text></TouchableOpacity>
        </View></View>
      </Modal>

      {/* Guest banner */}
      {!isAuthenticated && (
        <TouchableOpacity style={s.guestBar} onPress={() => navigation.navigate('AuthFlow')}>
          <Text style={s.guestText}>Sign in to list, make offers, and transact</Text>
          <Text style={{ fontSize: T.size.md, color: C.honey }}>→</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  hdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.xl, paddingTop: S.sm },
  logo: { fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.8 },
  logoDot: { fontSize:10, color: C.honey },
  hdrRight: { flexDirection: 'row', gap: S.sm },
  hdrBtn: { width: 38, height: 38, borderRadius: R.sm, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, position: 'relative' },
  hdrDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.honey, position: 'absolute', top: 5, right: 5, borderWidth: 2, borderColor: C.cream },

  loc: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: S.xl, paddingVertical: S.sm },
  locPin: { width: 28, height: 28, borderRadius: 9, backgroundColor: C.honeyLight, alignItems: 'center', justifyContent: 'center' },
  locPre: { fontSize: T.size.xs, color: C.text3, fontWeight: '600', letterSpacing: 0.3 },
  locCity: { fontSize: T.size.md, fontWeight: '700', color: C.ink },
  locArrow: { fontSize: 12, color: C.honey },

  search: { marginHorizontal: S.xl, marginTop: S.xs, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border, borderRadius: R.lg, paddingHorizontal: S.lg, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchIcon: { fontSize: 15, color: C.text3 },
  searchPh: { fontSize: T.size.base, color: C.text4, flex: 1, fontWeight: '500' },
  searchMic: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.honey, alignItems: 'center', justifyContent: 'center' },

  trust: { marginHorizontal: S.xl, marginTop: S.lg, backgroundColor: C.forest, borderRadius: R.lg, padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: 14 },
  trustShield: { width: 44, height: 44, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  trustTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  trustSub: { fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
  trustNums: { flexDirection: 'row', gap: 14 },
  trustVal: { fontSize: 18, fontWeight: '800', color: '#fff' },
  trustLbl: { fontSize:10, color: 'rgba(255,255,255,0.5)', fontWeight: '600', letterSpacing: 0.3 },

  cats: { flexDirection: 'row', paddingHorizontal: S.lg, paddingTop: 18, paddingBottom: 6, justifyContent: 'space-between' },
  cat: { alignItems: 'center', gap: 6, width: 62 },
  catBox: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  catName: { fontSize: T.size.xs, color: C.text2, fontWeight: '600' },

  kycPrompt: { marginHorizontal: S.xl, marginTop: S.md, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.honeyLight, borderRadius: R.lg, padding: S.lg, borderWidth: 1, borderColor: C.honey },
  kycPromptIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  kycPromptTitle: { fontSize: 14, fontWeight: '700', color: C.honeyDeep },
  kycPromptSub: { fontSize: 11, color: C.text3, marginTop: 2 },
  divider: { height: 6, backgroundColor: C.sand, marginTop: 14 },
  gridRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },
  skelRow: { flexDirection: 'row', gap: S.sm, paddingHorizontal: S.xl },

  empty: { alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: T.size.lg, fontWeight: '600', color: C.text, marginBottom: S.xs },
  emptySub: { fontSize: T.size.base, color: C.text3, textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: S.lg, backgroundColor: C.honey, borderRadius: R.sm, paddingHorizontal: S.xl, paddingVertical: 12 },
  retryText: { color: '#fff', fontSize: T.size.md, fontWeight: '600' },

  modalOv: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalC: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: S.xl, maxHeight: '70%' },
  modalT: { fontSize: T.size.lg, fontWeight: '600', color: C.text, marginBottom: S.lg },
  cityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: S.md, borderBottomWidth: 0.5, borderBottomColor: C.border },
  cityName: { fontSize: T.size.md, color: C.text },
  modalClose: { marginTop: S.lg, alignItems: 'center', paddingVertical: S.md },

  guestBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.ink, paddingVertical: 14, paddingHorizontal: S.lg },
  guestText: { fontSize: T.size.base, color: C.white },
});
