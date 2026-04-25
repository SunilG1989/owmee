/**
 * LocationPickerScreen — Swiggy/Zomato-style
 *
 * Flow:
 *  1. GPS auto-detect → reverse geocode to full street address
 *  2. Show "Confirm address" screen with all fields editable
 *  3. OR search → debounced Nominatim autocomplete → select → same confirm screen
 *  4. OR pick from popular cities → confirm screen (with empty street/area)
 *
 * Uses OpenStreetMap Nominatim API (free, no key required):
 *   - Reverse geocoding: /reverse?lat=X&lon=Y&format=json&addressdetails=1
 *   - Forward search:    /search?q=QUERY&format=json&countrycodes=in&addressdetails=1
 *
 * Nominatim policy: max 1 req/sec. We debounce 500ms which is well under.
 * User-Agent header required (we send "Owmee/3.0").
 *
 * Saves full address to AsyncStorage under @ow_location:
 *   {
 *     label, area, street, landmark, city, state, pincode, lat, lng, fullAddress
 *   }
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Platform, PermissionsAndroid, KeyboardAvoidingView,
  Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from '@react-native-community/geolocation';
import { C, T, S, R, Shadow } from '../../utils/tokens';

// ── Types ────────────────────────────────────────────────────────────

interface OwmeeLocation {
  label?: string;       // user-given label (Home, Office)
  fullAddress: string;  // human-readable summary line
  street?: string;      // house + road
  area?: string;        // neighborhood, locality
  landmark?: string;    // user-entered landmark
  city: string;
  state: string;
  pincode?: string;
  lat: number;
  lng: number;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    village?: string;
    town?: string;
    city?: string;
    city_district?: string;
    state_district?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country_code?: string;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

const USER_AGENT = 'Owmee/3.0 (https://owmee.in)';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

async function reverseGeocode(lat: number, lng: number): Promise<OwmeeLocation | null> {
  try {
    const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    });
    if (!res.ok) return null;
    const data: NominatimResult = await res.json();
    return toOwmeeLocation(data, lat, lng);
  } catch (e) {
    console.warn('reverseGeocode failed', e);
    return null;
  }
}

async function searchPlaces(query: string): Promise<NominatimResult[]> {
  if (query.trim().length < 3) return [];
  try {
    const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&countrycodes=in&limit=8`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn('searchPlaces failed', e);
    return [];
  }
}

function toOwmeeLocation(data: NominatimResult, lat: number, lng: number): OwmeeLocation {
  const a = data.address || {};
  const city =
    a.city || a.town || a.village || a.city_district || a.county || a.state_district || 'Unknown';
  const state = a.state || '';
  const pincode = a.postcode || '';
  const streetParts = [a.house_number, a.road].filter(Boolean);
  const street = streetParts.join(' ');
  const area = a.neighbourhood || a.suburb || '';
  const fullAddress = buildSummary({ street, area, city, state, pincode });
  return { street, area, city, state, pincode, lat, lng, fullAddress };
}

function buildSummary(parts: Partial<OwmeeLocation>): string {
  return [parts.street, parts.area, parts.city, parts.state, parts.pincode]
    .filter(Boolean)
    .join(', ');
}

// Popular Indian cities — shown when no search yet
const POPULAR_CITIES: { name: string; state: string; lat: number; lng: number; emoji: string }[] = [
  { name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946, emoji: '🏙️' },
  { name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777, emoji: '🌊' },
  { name: 'Delhi', state: 'Delhi', lat: 28.7041, lng: 77.1025, emoji: '🏛️' },
  { name: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867, emoji: '🕌' },
  { name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707, emoji: '🛕' },
  { name: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567, emoji: '⛰️' },
  { name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639, emoji: '🌉' },
  { name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714, emoji: '🏘️' },
];

// ── Props ────────────────────────────────────────────────────────────

interface Props {
  onLocationSet: (loc: OwmeeLocation) => void;
}

type Screen = 'picker' | 'confirm';

export default function LocationPickerScreen({ onLocationSet }: Props) {
  const [screen, setScreen] = useState<Screen>('picker');
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');

  // Search
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const searchDebounce = useRef<NodeJS.Timeout | null>(null);

  // Staging area for confirm screen
  const [stageLoc, setStageLoc] = useState<OwmeeLocation | null>(null);

  // ── GPS detection ──────────────────────────────────────────────────
  const detectGPS = useCallback(async () => {
    setDetecting(true);
    setError('');
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Enable location?',
            message: 'Owmee uses your location to show items near you.',
            buttonPositive: 'Allow',
            buttonNegative: 'Not now',
          },
        );
        if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          setDetecting(false);
          Alert.alert(
            'Location blocked',
            'Open Settings → Apps → Owmee → Permissions and enable Location.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ],
          );
          return;
        }
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setError('Location permission denied. Search or pick a city below.');
          setDetecting(false);
          return;
        }
      }

      Geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          const loc = await reverseGeocode(latitude, longitude);
          if (loc) {
            setStageLoc(loc);
            setScreen('confirm');
          } else {
            // Reverse geocode failed — still stage raw coords with fallback city
            setStageLoc({
              city: 'Unknown',
              state: '',
              lat: latitude,
              lng: longitude,
              fullAddress: 'Location detected — please fill in details',
            });
            setScreen('confirm');
          }
          setDetecting(false);
        },
        (err) => {
          const msg = err.code === 1 ? 'Location permission denied'
                    : err.code === 2 ? 'Location unavailable — enable GPS in Settings'
                    : err.code === 3 ? 'Location timed out — try again'
                    : 'Could not detect location';
          setError(msg);
          setDetecting(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    } catch (e) {
      setError('Location unavailable. Please search or pick manually.');
      setDetecting(false);
    }
  }, []);

  // ── Debounced search ───────────────────────────────────────────────
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (search.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchDebounce.current = setTimeout(async () => {
      const res = await searchPlaces(search);
      setResults(res);
      setSearching(false);
    }, 500);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [search]);

  const selectSearchResult = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const loc = toOwmeeLocation(result, lat, lng);
    setStageLoc(loc);
    setScreen('confirm');
  };

  const selectPopularCity = (city: typeof POPULAR_CITIES[0]) => {
    setStageLoc({
      city: city.name,
      state: city.state,
      lat: city.lat,
      lng: city.lng,
      fullAddress: `${city.name}, ${city.state}`,
    });
    setScreen('confirm');
  };

  // ── Confirm + save ─────────────────────────────────────────────────
  const handleConfirm = async (final: OwmeeLocation) => {
    await AsyncStorage.setItem('@ow_location', JSON.stringify(final));
    onLocationSet(final);
  };

  // ── UI ─────────────────────────────────────────────────────────────
  if (screen === 'confirm' && stageLoc) {
    return (
      <ConfirmAddressScreen
        initial={stageLoc}
        onBack={() => setScreen('picker')}
        onConfirm={handleConfirm}
      />
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.header}>
          <Text style={s.logo}>
            owm<Text style={{ color: C.honey }}>ee</Text>
            <Text style={s.logoDot}>●</Text>
          </Text>
        </View>

        <View style={s.hero}>
          <Text style={s.heroEmoji}>📍</Text>
          <Text style={s.heroTitle}>Where are you?</Text>
          <Text style={s.heroSub}>
            We'll show items available near you
          </Text>
        </View>

        {/* GPS detect — big primary button */}
        <TouchableOpacity
          style={s.gpsBtn}
          onPress={detectGPS}
          disabled={detecting}
          activeOpacity={0.85}
        >
          {detecting ? (
            <>
              <ActivityIndicator color={C.honeyDeep} size="small" />
              <Text style={s.gpsBtnText}>Detecting location...</Text>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 18 }}>🎯</Text>
              <Text style={s.gpsBtnText}>Use my current location</Text>
            </>
          )}
        </TouchableOpacity>

        {error ? <Text style={s.error}>{error}</Text> : null}

        {/* Divider */}
        <View style={s.divider}>
          <View style={s.dividerLine} />
          <Text style={s.dividerText}>or</Text>
          <View style={s.dividerLine} />
        </View>

        {/* Search */}
        <View style={s.searchWrap}>
          <Text style={{ fontSize: 16, color: C.text3 }}>🔍</Text>
          <TextInput
            style={s.searchInput}
            placeholder="Search area, street, landmark, or pincode..."
            placeholderTextColor={C.text4}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="words"
            returnKeyType="search"
          />
          {searching && <ActivityIndicator size="small" color={C.honey} />}
        </View>

        {/* Search results from Nominatim */}
        {search.trim().length >= 3 && (
          <View style={s.results}>
            {!searching && results.length === 0 && (
              <View style={s.noResults}>
                <Text style={{ fontSize: T.size.base, color: C.text4 }}>
                  No places found for "{search}"
                </Text>
                <Text style={{ fontSize: T.size.sm, color: C.text4, marginTop: 4 }}>
                  Try a different search or pick a popular city below.
                </Text>
              </View>
            )}
            {results.map((r) => {
              const a = r.address || {};
              const cityGuess =
                a.city || a.town || a.village || a.state_district || '';
              const primary =
                [a.road || a.neighbourhood || a.suburb, cityGuess]
                  .filter(Boolean)
                  .join(', ') || r.display_name.split(',')[0];
              return (
                <TouchableOpacity
                  key={r.place_id}
                  style={s.resultRow}
                  onPress={() => selectSearchResult(r)}
                  activeOpacity={0.75}
                >
                  <View style={s.resultIcon}>
                    <Text style={{ fontSize: 14 }}>📍</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.resultPrimary} numberOfLines={1}>{primary}</Text>
                    <Text style={s.resultSecondary} numberOfLines={2}>
                      {r.display_name}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Popular cities grid — only shown when no search */}
        {search.trim().length === 0 && (
          <View style={s.popularWrap}>
            <Text style={s.popularTitle}>Popular cities</Text>
            <View style={s.popularGrid}>
              {POPULAR_CITIES.map((city) => (
                <TouchableOpacity
                  key={city.name}
                  style={s.popularChip}
                  onPress={() => selectPopularCity(city)}
                  activeOpacity={0.75}
                >
                  <Text style={s.popularEmoji}>{city.emoji}</Text>
                  <Text style={s.popularName}>{city.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ══════════════════════════════════════════════════════════════════════
//  Confirm address screen
// ══════════════════════════════════════════════════════════════════════

function ConfirmAddressScreen({
  initial,
  onBack,
  onConfirm,
}: {
  initial: OwmeeLocation;
  onBack: () => void;
  onConfirm: (loc: OwmeeLocation) => void;
}) {
  const [street, setStreet] = useState(initial.street || '');
  const [area, setArea] = useState(initial.area || '');
  const [landmark, setLandmark] = useState('');
  const [city, setCity] = useState(initial.city || '');
  const [stateVal, setStateVal] = useState(initial.state || '');
  const [pincode, setPincode] = useState(initial.pincode || '');
  const [saving, setSaving] = useState(false);

  const canSave = city.trim().length >= 2;

  const save = async () => {
    if (!canSave) {
      Alert.alert('City required', 'Please enter at least a city.');
      return;
    }
    setSaving(true);
    const final: OwmeeLocation = {
      street: street.trim() || undefined,
      area: area.trim() || undefined,
      landmark: landmark.trim() || undefined,
      city: city.trim(),
      state: stateVal.trim(),
      pincode: pincode.trim() || undefined,
      lat: initial.lat,
      lng: initial.lng,
      fullAddress: buildSummary({
        street: street.trim(),
        area: area.trim(),
        city: city.trim(),
        state: stateVal.trim(),
        pincode: pincode.trim(),
      }),
    };
    onConfirm(final);
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={s.confirmHeader}>
          <TouchableOpacity onPress={onBack} style={s.backBtn}>
            <Text style={{ fontSize: 20, color: C.text2 }}>←</Text>
          </TouchableOpacity>
          <Text style={s.confirmTitle}>Confirm address</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ padding: S.xl, paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Detected summary */}
          <View style={s.detectedCard}>
            <View style={s.detectedIcon}>
              <Text style={{ fontSize: 18 }}>📍</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.detectedLabel}>Detected address</Text>
              <Text style={s.detectedAddr} numberOfLines={2}>
                {initial.fullAddress || 'Tap fields below to fill in'}
              </Text>
            </View>
          </View>

          {/* Editable fields */}
          <Text style={s.fieldLabel}>House / Flat / Building</Text>
          <TextInput
            style={s.field}
            placeholder="e.g. Flat 402, Tower B"
            placeholderTextColor={C.text4}
            value={street}
            onChangeText={setStreet}
          />

          <Text style={s.fieldLabel}>Area / Locality</Text>
          <TextInput
            style={s.field}
            placeholder="e.g. Koramangala, Indiranagar"
            placeholderTextColor={C.text4}
            value={area}
            onChangeText={setArea}
          />

          <Text style={s.fieldLabel}>Landmark (optional)</Text>
          <TextInput
            style={s.field}
            placeholder="e.g. Near Forum Mall"
            placeholderTextColor={C.text4}
            value={landmark}
            onChangeText={setLandmark}
          />

          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>City *</Text>
              <TextInput
                style={s.field}
                placeholder="Bengaluru"
                placeholderTextColor={C.text4}
                value={city}
                onChangeText={setCity}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Pincode</Text>
              <TextInput
                style={s.field}
                placeholder="560034"
                placeholderTextColor={C.text4}
                keyboardType="number-pad"
                maxLength={6}
                value={pincode}
                onChangeText={setPincode}
              />
            </View>
          </View>

          <Text style={s.fieldLabel}>State</Text>
          <TextInput
            style={s.field}
            placeholder="Karnataka"
            placeholderTextColor={C.text4}
            value={stateVal}
            onChangeText={setStateVal}
          />
        </ScrollView>

        {/* Fixed bottom CTA */}
        <View style={s.bottomBar}>
          <TouchableOpacity
            style={[s.saveBtn, !canSave && { opacity: 0.4 }]}
            onPress={save}
            disabled={!canSave || saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={s.saveBtnText}>Save and continue →</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cream },
  header: { paddingHorizontal: S.xl, paddingTop: S.md },
  logo: { fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.8 },
  logoDot: { fontSize: 10, color: C.honey },

  hero: { alignItems: 'center', paddingVertical: 32 },
  heroEmoji: { fontSize: 48, marginBottom: S.md },
  heroTitle: { fontSize: T.size.xl, fontWeight: '700', color: C.ink },
  heroSub: { fontSize: T.size.base, color: C.text3, marginTop: S.xs },

  gpsBtn: {
    marginHorizontal: S.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: S.sm, backgroundColor: C.honeyLight, borderRadius: R.lg, paddingVertical: 16,
    borderWidth: 1.5, borderColor: C.honey, ...Shadow.glow,
  },
  gpsBtnText: { fontSize: T.size.md, fontWeight: '700', color: C.honeyDeep },
  error: { fontSize: T.size.sm, color: C.red, textAlign: 'center', marginTop: S.sm, paddingHorizontal: S.xl },

  divider: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.xl, marginVertical: S.lg, gap: S.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { fontSize: T.size.sm, color: C.text4, fontWeight: '500' },

  searchWrap: {
    marginHorizontal: S.xl, flexDirection: 'row', alignItems: 'center',
    gap: S.sm, backgroundColor: C.surface, borderRadius: R.lg, paddingHorizontal: S.lg,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: T.size.md, color: C.text, paddingVertical: 14 },

  results: { marginHorizontal: S.xl, marginTop: S.md },
  resultRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: S.md,
    paddingVertical: S.md, borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  resultIcon: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: C.forestLight,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  resultPrimary: { fontSize: T.size.md, fontWeight: '600', color: C.text },
  resultSecondary: { fontSize: T.size.xs, color: C.text3, marginTop: 2, lineHeight: 16 },
  noResults: { alignItems: 'center', paddingVertical: S.xl },

  popularWrap: { marginTop: S.xl, paddingHorizontal: S.xl },
  popularTitle: {
    fontSize: T.size.base, fontWeight: '600', color: C.text3, marginBottom: S.md,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  popularGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: S.sm },
  popularChip: {
    width: '23%', alignItems: 'center', paddingVertical: S.md, backgroundColor: C.surface,
    borderRadius: R.lg, borderWidth: 1, borderColor: C.border, ...Shadow.card,
  },
  popularEmoji: { fontSize: 24, marginBottom: S.xs },
  popularName: { fontSize: T.size.sm, fontWeight: '600', color: C.text2 },

  // Confirm screen
  confirmHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: S.lg, paddingVertical: S.md,
    backgroundColor: C.surface, borderBottomWidth: 0.5, borderBottomColor: C.border,
  },
  backBtn: { padding: 4, width: 40 },
  confirmTitle: { fontSize: T.size.md, fontWeight: '600', color: C.text },

  detectedCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: S.md,
    padding: S.md, backgroundColor: C.honeyLight, borderRadius: R.md,
    borderWidth: 1, borderColor: C.honey, marginBottom: S.xl,
  },
  detectedIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  detectedLabel: { fontSize: T.size.xs, fontWeight: '700', color: C.honeyDeep, textTransform: 'uppercase', letterSpacing: 0.5 },
  detectedAddr: { fontSize: T.size.sm, color: C.text, marginTop: 2, lineHeight: 18 },

  fieldLabel: {
    fontSize: 11, fontWeight: '700', color: C.text3,
    marginTop: S.md, marginBottom: S.xs,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  field: {
    borderWidth: 1, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: S.md, paddingVertical: 12,
    fontSize: T.size.md, color: C.text, backgroundColor: C.surface,
  },

  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border,
    padding: S.md,
  },
  saveBtn: {
    backgroundColor: C.honey, borderRadius: R.sm, paddingVertical: 16,
    alignItems: 'center', ...Shadow.glow,
  },
  saveBtnText: { fontSize: T.size.md, fontWeight: '700', color: '#fff' },
});
