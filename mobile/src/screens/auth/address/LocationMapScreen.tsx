/**
 * LocationMapScreen — Address PRD section 4.2 screen B.
 *
 * Drag-pin map. The map slides UNDER a fixed-position pin at the screen
 * center; on every region-change-complete (debounced 400ms) we hit
 * /v1/geo/reverse-geocode and update the bottom sheet preview.
 *
 * Tile source: OpenStreetMap. We don't use Google Maps; PROVIDER_DEFAULT
 * + UrlTile gives us OSM rendering without any SDK key. Visual quality is
 * acceptable; if it turns out to be too rough in pilot we can swap the
 * UrlTile URL for a free tile provider with prettier rendering (one-line
 * change).
 *
 * Confirm-disabled-while-loading rule (PRD 4.2.B "Edge cases"): we don't
 * let the user save with no city/state — those are required by the
 * UserAddress model. If the first reverse geocode is still in-flight,
 * the button stays disabled.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { PROVIDER_DEFAULT, Region, UrlTile } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Geo, type PhotonReverseResponse } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import { C, R, S, Shadow, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

const REGION_DEBOUNCE_MS = 400;
const STREET_ZOOM = { latitudeDelta: 0.005, longitudeDelta: 0.005 };
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function LocationMapScreen({
  navigation,
  route,
}: RootScreen<'LocationMap'>) {
  const { initialLat, initialLng, source, gpsAccuracy } = route.params;

  const [center, setCenter] = useState({ lat: initialLat, lng: initialLng });
  const [reverse, setReverse] = useState<PhotonReverseResponse | null>(null);
  const [loadingReverse, setLoadingReverse] = useState(true);
  const [reverseError, setReverseError] = useState(false);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const inFlightRef = useRef(0); // monotonic seq to ignore stale responses

  const fetchReverse = useCallback(async (lat: number, lng: number) => {
    const seq = ++inFlightRef.current;
    setLoadingReverse(true);
    setReverseError(false);
    try {
      const r = await Geo.reverseGeocodeStructured(lat, lng);
      if (seq !== inFlightRef.current) return; // stale, a newer pan already fired
      setReverse(r.data);
    } catch {
      if (seq !== inFlightRef.current) return;
      setReverseError(true);
      setReverse(null);
    } finally {
      if (seq === inFlightRef.current) setLoadingReverse(false);
    }
  }, []);

  // Initial reverse geocode on mount.
  useEffect(() => {
    fetchReverse(initialLat, initialLng);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [initialLat, initialLng, fetchReverse]);

  const onRegionChangeComplete = (region: Region) => {
    setCenter({ lat: region.latitude, lng: region.longitude });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchReverse(region.latitude, region.longitude);
    }, REGION_DEBOUNCE_MS);
  };

  const canConfirm = !loadingReverse && reverse !== null && !!reverse.city && !!reverse.state;

  const onConfirm = () => {
    if (!reverse) return;
    navigation.replace('AddressDetails', {
      lat: center.lat,
      lng: center.lng,
      source: source ?? 'manual',
      reverse,
      // returnTo metadata stays opaque to AddressDetails for now — it
      // doesn't need to know.
      ...(route.params.returnTo ? { returnTo: route.params.returnTo } : {}),
    });
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Move map to your exact location</Text>
      </View>

      <View style={s.mapWrap}>
        <MapView
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={{
            latitude: initialLat,
            longitude: initialLng,
            ...STREET_ZOOM,
          }}
          onRegionChangeComplete={onRegionChangeComplete}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
        >
          <UrlTile
            urlTemplate={OSM_TILE_URL}
            maximumZ={19}
            shouldReplaceMapContent={true}
          />
        </MapView>

        {/* Sticky pin in the screen-center. NOT a Marker — the map pans
            under it. */}
        <View style={s.pinAnchor} pointerEvents="none">
          <Text style={s.pinGlyph}>📍</Text>
        </View>

        {gpsAccuracy && gpsAccuracy > 100 ? (
          <View style={s.accuracyBadge}>
            <Text style={s.accuracyText}>
              Rough location — drag pin to your exact spot
            </Text>
          </View>
        ) : null}
      </View>

      <View style={s.sheet}>
        {loadingReverse ? (
          <View style={s.sheetLoading}>
            <ActivityIndicator color={C.petrol} />
            <Text style={s.sheetSub}>Reading location…</Text>
          </View>
        ) : reverseError ? (
          <Text style={s.sheetError}>
            Couldn't read this location — try moving to a road, or fill manually on the next screen.
          </Text>
        ) : reverse ? (
          <>
            <Text style={s.sheetMain} numberOfLines={2}>
              {reverse.approximate_address || 'Drop pin to read address'}
            </Text>
            <Text style={s.sheetSub}>
              {[reverse.city, reverse.pincode].filter(Boolean).join(' ') || ' '}
            </Text>
            {!reverse.in_service_area ? (
              <Text style={s.sheetWarn}>
                Outside India. You can save this address but specialist visits
                are limited to Bengaluru.
              </Text>
            ) : null}
          </>
        ) : null}

        <Button
          label="Confirm location"
          onPress={onConfirm}
          disabled={!canConfirm}
          style={s.confirmBtn}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bone },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.sm,
    paddingTop: S.xs,
    paddingBottom: S.xs,
    gap: S.xs,
    backgroundColor: C.bone,
  },
  headerTitle: {
    fontSize: T.size.lg - 1,
    fontWeight: T.weight.semi,
    color: C.text,
    flex: 1,
  },
  mapWrap: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  pinAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 40, // shift up so the actual pin tip lands at center
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinGlyph: {
    fontSize: T.size.display + 14,                                   // 44
  },
  accuracyBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(15,26,31,0.85)',
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
  },
  accuracyText: {
    color: C.bone,
    fontSize: T.size.base,
    textAlign: 'center',
  },
  sheet: {
    backgroundColor: C.surface,
    paddingHorizontal: S.lg,
    paddingTop: S.lg,
    paddingBottom: S.xl,
    gap: S.sm,
    borderTopLeftRadius: R.lg,
    borderTopRightRadius: R.lg,
    ...Shadow.glow,
  },
  sheetMain: {
    fontSize: T.size.lg - 1,
    fontWeight: T.weight.semi,
    color: C.text,
    lineHeight: 22,
  },
  sheetSub: {
    fontSize: T.size.base,
    color: C.text3,
  },
  sheetWarn: {
    fontSize: T.size.sm,
    color: C.petrolDeep,
    fontStyle: 'italic',
    marginTop: S.xs,
  },
  sheetLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    minHeight: 22,
  },
  sheetError: {
    fontSize: T.size.sm + 1,
    color: C.text2,
  },
  confirmBtn: {
    marginTop: S.md,
  },
});
