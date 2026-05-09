/**
 * LocationMapScreen — precise address pinning.
 *
 * Production intent:
 * - Use Google Maps when an Android Maps SDK key is present.
 * - Never mount the native map when the key is missing, because Google Maps
 *   hard-crashes Android if the manifest key is absent/invalidly configured.
 * - Reverse-geocode only after the pin settles to protect performance and
 *   reduce provider noise.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  NativeModules,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import MapView, { Circle, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Geo, type PhotonReverseResponse } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import { C, R, S, Shadow, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

const STREET_DELTA = 0.0048;
const REVERSE_DEBOUNCE_MS = 650;
const MIN_REVERSE_DISTANCE_M = 20;
const SMALL_STEP = 0.00045;

const googleMapsEnabled =
  Platform.OS !== 'android' ||
  Boolean(NativeModules.MapsConfig?.googleMapsEnabled);

type Point = { lat: number; lng: number };
type GpsPoint = Point & { accuracy?: number };

export default function LocationMapScreen({
  navigation,
  route,
}: RootScreen<'LocationMap'>) {
  const { initialLat, initialLng, source, gpsAccuracy } = route.params;
  const mapRef = useRef<MapView | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(0);
  const lastReversePointRef = useRef<Point | null>(null);

  const [center, setCenter] = useState<Point>({ lat: initialLat, lng: initialLng });
  const [gpsPoint, setGpsPoint] = useState<GpsPoint | null>(
    source === 'gps_detected'
      ? { lat: initialLat, lng: initialLng, accuracy: gpsAccuracy }
      : null,
  );
  const [reverse, setReverse] = useState<PhotonReverseResponse | null>(null);
  const [loadingReverse, setLoadingReverse] = useState(true);
  const [reverseError, setReverseError] = useState(false);
  const [locating, setLocating] = useState(false);

  const fetchReverse = useCallback(async (lat: number, lng: number) => {
    const seq = ++inFlightRef.current;
    const startedAt = Date.now();
    setLoadingReverse(true);
    setReverseError(false);
    try {
      const r = await Geo.reverseGeocodeStructured(lat, lng);
      if (seq !== inFlightRef.current) return;
      setReverse(r.data);
      console.info(`[LocationPerf] reverse_geocode_ms=${Date.now() - startedAt}`);
    } catch {
      if (seq !== inFlightRef.current) return;
      setReverseError(true);
      setReverse(null);
      console.info(`[LocationPerf] reverse_geocode_error_ms=${Date.now() - startedAt}`);
    } finally {
      if (seq === inFlightRef.current) setLoadingReverse(false);
    }
  }, []);

  const scheduleReverse = useCallback(
    (point: Point, immediate = false) => {
      const last = lastReversePointRef.current;
      if (
        last &&
        !immediate &&
        distanceMeters(last.lat, last.lng, point.lat, point.lng) < MIN_REVERSE_DISTANCE_M
      ) {
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);

      const run = () => {
        lastReversePointRef.current = point;
        fetchReverse(point.lat, point.lng);
      };

      if (immediate) run();
      else debounceRef.current = setTimeout(run, REVERSE_DEBOUNCE_MS);
    },
    [fetchReverse],
  );

  useEffect(() => {
    scheduleReverse(center, true);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Run once for the initial coordinate. Later updates are scheduled by map/nudge handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRegionChangeComplete = (region: Region) => {
    const next = { lat: region.latitude, lng: region.longitude };
    setCenter(next);
    scheduleReverse(next);
  };

  const nudge = (latDelta: number, lngDelta: number) => {
    setCenter((prev) => {
      const next = {
        lat: Number((prev.lat + latDelta).toFixed(7)),
        lng: Number((prev.lng + lngDelta).toFixed(7)),
      };
      scheduleReverse(next, true);
      return next;
    });
  };

  const recenterToGps = () => {
    if (locating) return;
    setLocating(true);
    Geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const accuracy = pos.coords.accuracy ?? undefined;
        setGpsPoint({ ...next, accuracy });
        setCenter(next);
        mapRef.current?.animateToRegion(toRegion(next), 450);
        scheduleReverse(next, true);
        setLocating(false);
      },
      () => setLocating(false),
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 5_000,
      },
    );
  };

  const onConfirm = () => {
    navigation.replace('AddressDetails', {
      lat: center.lat,
      lng: center.lng,
      source: source ?? 'manual',
      reverse,
      ...(route.params.returnTo ? { returnTo: route.params.returnTo } : {}),
    });
  };

  const canContinue = !loadingReverse || reverseError || !!reverse;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Set precise location</Text>
      </View>

      <View style={s.body}>
        {googleMapsEnabled ? (
          <View style={s.mapWrap}>
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={StyleSheet.absoluteFill}
              initialRegion={toRegion(center)}
              onRegionChangeComplete={onRegionChangeComplete}
              showsUserLocation={source === 'gps_detected'}
              showsMyLocationButton={false}
              showsCompass
              toolbarEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              loadingEnabled
            >
              {gpsPoint?.accuracy ? (
                <Circle
                  center={{ latitude: gpsPoint.lat, longitude: gpsPoint.lng }}
                  radius={Math.min(gpsPoint.accuracy, 500)}
                  strokeColor="rgba(47,118,107,0.36)"
                  fillColor="rgba(47,118,107,0.10)"
                />
              ) : null}
            </MapView>

            <View style={s.mapHint} pointerEvents="none">
              <Text style={s.mapHintText}>Move the map until the pin is on your building</Text>
            </View>

            <TouchableOpacity
              style={s.recenterBtn}
              onPress={recenterToGps}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel="Use current GPS location"
            >
              {locating ? (
                <ActivityIndicator color={C.petrolDeep} />
              ) : (
                <Text style={s.recenterText}>Use GPS</Text>
              )}
            </TouchableOpacity>

            <View style={s.pinAnchor} pointerEvents="none">
              <View style={s.pinHalo}>
                <Text style={s.pinGlyph}>📍</Text>
              </View>
            </View>
          </View>
        ) : (
          <FallbackMap
            center={center}
            onNudge={nudge}
          />
        )}

        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetEyebrow}>
              {gpsPoint?.accuracy ? accuracyCopy(gpsPoint.accuracy) : 'Pin selected'}
            </Text>
            <Text style={s.coordText}>
              {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
            </Text>
          </View>

          {loadingReverse ? (
            <View style={s.sheetLoading}>
              <ActivityIndicator color={C.petrol} />
              <Text style={s.sheetSub}>Reading this location...</Text>
            </View>
          ) : reverseError ? (
            <Text style={s.sheetError}>
              Address lookup is slow right now. Continue and fill the address manually.
            </Text>
          ) : reverse ? (
            <>
              <Text style={s.sheetMain} numberOfLines={2}>
                {reverse.approximate_address || 'Selected location'}
              </Text>
              <Text style={s.sheetSub}>
                {[reverse.city, reverse.state, reverse.pincode].filter(Boolean).join(' ') || ' '}
              </Text>
              {!reverse.in_service_area ? (
                <Text style={s.sheetWarn}>
                  Owmee Assist visits are currently limited to Bengaluru.
                </Text>
              ) : null}
            </>
          ) : null}

          <Button
            label="Confirm and fill address"
            onPress={onConfirm}
            disabled={!canContinue}
            style={s.confirmBtn}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function FallbackMap({
  center,
  onNudge,
}: {
  center: Point;
  onNudge: (latDelta: number, lngDelta: number) => void;
}) {
  return (
    <View style={s.fallbackWrap}>
      <View style={s.fallbackMap}>
        <View style={s.gridA} />
        <View style={s.gridB} />
        <View style={s.gridC} />
        <View style={s.pinHalo}>
          <Text style={s.pinGlyph}>📍</Text>
        </View>
      </View>
      <Text style={s.fallbackTitle}>Google Maps is not enabled in this build</Text>
      <Text style={s.fallbackBody}>
        Add GOOGLE_MAPS_API_KEY to the Android build to show the live map. This fallback keeps the app usable without crashing.
      </Text>
      <Text style={s.coordText}>
        {center.lat.toFixed(5)}, {center.lng.toFixed(5)}
      </Text>
      <View style={s.nudgeGrid}>
        <View style={s.nudgeSpacer} />
        <NudgeButton label="Up" onPress={() => onNudge(SMALL_STEP, 0)} />
        <View style={s.nudgeSpacer} />
        <NudgeButton label="Left" onPress={() => onNudge(0, -SMALL_STEP)} />
        <NudgeButton label="Right" onPress={() => onNudge(0, SMALL_STEP)} />
        <NudgeButton label="Down" onPress={() => onNudge(-SMALL_STEP, 0)} />
      </View>
    </View>
  );
}

function NudgeButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={onPress}
      style={s.nudgeButton}
      accessibilityRole="button"
      accessibilityLabel={`Move pin ${label.toLowerCase()}`}
    >
      <Text style={s.nudgeButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function toRegion(point: Point): Region {
  return {
    latitude: point.lat,
    longitude: point.lng,
    latitudeDelta: STREET_DELTA,
    longitudeDelta: STREET_DELTA,
  };
}

function accuracyCopy(accuracy: number) {
  if (accuracy <= 50) return `GPS accuracy: excellent (${Math.round(accuracy)} m)`;
  if (accuracy <= 150) return `GPS accuracy: good (${Math.round(accuracy)} m)`;
  return `GPS accuracy: approximate (${Math.round(accuracy)} m)`;
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earth = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
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
  body: {
    flex: 1,
  },
  mapWrap: {
    flex: 1,
    minHeight: 360,
    overflow: 'hidden',
    backgroundColor: '#DCEBE7',
  },
  mapHint: {
    position: 'absolute',
    top: S.md,
    left: S.lg,
    right: S.lg,
    borderRadius: R.pill,
    backgroundColor: 'rgba(255,253,248,0.94)',
    paddingHorizontal: S.md,
    paddingVertical: S.sm,
    alignItems: 'center',
    ...Shadow.subtle,
  },
  mapHintText: {
    color: C.text,
    fontSize: T.size.sm,
    fontWeight: T.weight.semi,
    textAlign: 'center',
  },
  recenterBtn: {
    position: 'absolute',
    right: S.md,
    bottom: S.md,
    minWidth: 92,
    minHeight: 42,
    borderRadius: R.pill,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.subtle,
  },
  recenterText: {
    color: C.petrolDeep,
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
  },
  pinAnchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinHalo: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(255,253,248,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(47,118,107,0.18)',
    ...Shadow.subtle,
  },
  pinGlyph: {
    fontSize: T.size.display + 10,
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    paddingHorizontal: S.lg,
    paddingTop: S.lg,
    paddingBottom: S.lg,
    borderTopWidth: 1,
    borderColor: C.border,
    ...Shadow.glow,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: S.sm,
    marginBottom: S.xs,
  },
  sheetEyebrow: {
    flex: 1,
    fontSize: T.size.xs,
    color: C.petrolDeep,
    fontWeight: T.weight.bold,
    textTransform: 'uppercase',
  },
  coordText: {
    fontSize: T.size.xs,
    color: C.text4,
    fontWeight: T.weight.medium,
  },
  sheetLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    minHeight: 54,
  },
  sheetMain: {
    fontSize: T.size.lg,
    fontWeight: T.weight.bold,
    color: C.text,
    lineHeight: 24,
  },
  sheetSub: {
    fontSize: T.size.sm + 1,
    color: C.text2,
    marginTop: S.xs,
  },
  sheetError: {
    fontSize: T.size.sm + 1,
    color: C.text2,
    lineHeight: 20,
    minHeight: 48,
  },
  sheetWarn: {
    fontSize: T.size.sm,
    color: C.petrolDeep,
    marginTop: S.xs,
  },
  confirmBtn: {
    marginTop: S.md,
  },
  fallbackWrap: {
    flex: 1,
    paddingHorizontal: S.lg,
    paddingTop: S.md,
  },
  fallbackMap: {
    flex: 1,
    minHeight: 280,
    borderRadius: R.xl,
    overflow: 'hidden',
    backgroundColor: '#EAF4F1',
    borderWidth: 1,
    borderColor: 'rgba(47,118,107,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.glow,
  },
  fallbackTitle: {
    marginTop: S.md,
    color: C.text,
    fontSize: T.size.md,
    fontWeight: T.weight.bold,
  },
  fallbackBody: {
    marginTop: S.xs,
    color: C.text2,
    fontSize: T.size.sm,
    lineHeight: 20,
  },
  gridA: {
    position: 'absolute',
    left: -40,
    right: -20,
    top: '28%',
    height: 42,
    transform: [{ rotate: '-12deg' }],
    backgroundColor: 'rgba(255,253,248,0.78)',
  },
  gridB: {
    position: 'absolute',
    left: -20,
    right: -30,
    top: '58%',
    height: 34,
    transform: [{ rotate: '10deg' }],
    backgroundColor: 'rgba(255,253,248,0.62)',
  },
  gridC: {
    position: 'absolute',
    top: -40,
    bottom: -30,
    left: '24%',
    width: 38,
    transform: [{ rotate: '18deg' }],
    backgroundColor: 'rgba(187,104,79,0.08)',
  },
  nudgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.xs,
    marginTop: S.md,
  },
  nudgeSpacer: {
    width: '31%',
  },
  nudgeButton: {
    width: '31%',
    minHeight: 40,
    borderRadius: R.sm,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudgeButtonText: {
    fontSize: T.size.sm,
    color: C.petrolDeep,
    fontWeight: T.weight.semi,
  },
});
