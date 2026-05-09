/**
 * LocationDetectScreen — Address PRD section 4.2 screen A.
 *
 * The 5-second decision moment between "use my GPS" and "set manually."
 * Shown to:
 *   - Brand-new users who just OTP'd in and have no saved addresses.
 *   - Returning users who tap "+ Add a new address" from the picker.
 *
 * Permission denied / GPS times out / GPS too inaccurate → all routes
 * forward to LocationMapScreen with the default Bengaluru centre. The
 * user can drag the pin to wherever they need it.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import type { GeolocationResponse } from '@react-native-community/geolocation';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, Button } from '../../../components/ui';
import { C, S, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const GPS_FAST_WINDOW_MS = 4_500;
const GPS_HARD_TIMEOUT_MS = 10_000;
const GOOD_ACCURACY_M = 150;

export default function LocationDetectScreen({
  navigation,
  route,
}: RootScreen<'LocationDetect'>) {
  const [probing, setProbing] = useState(false);
  const [denied, setDenied] = useState(false);
  const watchRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanupProbe = () => {
    if (watchRef.current != null) {
      Geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (hardTimerRef.current) {
      clearTimeout(hardTimerRef.current);
      hardTimerRef.current = null;
    }
  };

  useEffect(() => cleanupProbe, []);

  const goToMap = (
    lat: number,
    lng: number,
    source: 'gps_detected' | 'manual',
    gpsAccuracy?: number,
  ) => {
    cleanupProbe();
    setProbing(false);
    navigation.replace('LocationMap', {
      initialLat: lat,
      initialLng: lng,
      source,
      ...(gpsAccuracy != null ? { gpsAccuracy } : {}),
      ...route.params,
    });
  };

  const onUseCurrent = async () => {
    if (probing) return;
    setProbing(true);
    setDenied(false);
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Use your location?',
            message:
              "Owmee uses your location to show items near you and let our specialists find your home for pickups.",
            buttonPositive: 'Allow',
            buttonNegative: 'Not now',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setDenied(true);
          setProbing(false);
          return;
        }
      }

      let best: GeolocationResponse | null = null;
      let settled = false;
      const startedAt = Date.now();

      const finish = (pos: GeolocationResponse | null) => {
        if (settled) return;
        settled = true;
        const accuracy = pos?.coords?.accuracy;
        console.info(
          `[LocationPerf] gps_probe_ms=${Date.now() - startedAt} accuracy_m=${accuracy ?? 'none'}`,
        );
        if (pos) {
          goToMap(
            pos.coords.latitude,
            pos.coords.longitude,
            'gps_detected',
            accuracy,
          );
        } else {
          goToMap(BENGALURU.lat, BENGALURU.lng, 'manual');
        }
      };

      watchRef.current = Geolocation.watchPosition(
        (pos) => {
          const accuracy = pos.coords.accuracy ?? Number.POSITIVE_INFINITY;
          const bestAccuracy = best?.coords?.accuracy ?? Number.POSITIVE_INFINITY;
          if (!best || accuracy < bestAccuracy) best = pos;
          if (accuracy <= GOOD_ACCURACY_M) finish(pos);
        },
        () => finish(best),
        {
          enableHighAccuracy: true,
          timeout: GPS_HARD_TIMEOUT_MS,
          maximumAge: 30_000,
          distanceFilter: 0,
        },
      );

      timerRef.current = setTimeout(() => {
        if (best) finish(best);
      }, GPS_FAST_WINDOW_MS);
      hardTimerRef.current = setTimeout(() => finish(best), GPS_HARD_TIMEOUT_MS);
    } catch {
      cleanupProbe();
      setProbing(false);
    }
  };

  const onSetManually = () => {
    goToMap(BENGALURU.lat, BENGALURU.lng, 'manual');
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
      </View>

      <View style={s.body}>
        <Text style={s.glyph}>📍</Text>
        <Text style={s.title}>Where are you located?</Text>
        <Text style={s.subtitle}>
          Owmee uses your location to show items near you and let our
          specialists find your home for pickups.
        </Text>

        {denied ? (
          <Text style={s.deniedHint}>
            No problem — you can set it manually.
          </Text>
        ) : null}

        {!denied ? (
          <Button
            label="Use my current location"
            onPress={onUseCurrent}
            loading={probing}
            style={s.primaryBtn}
          />
        ) : null}

        <Button
          label="Set manually"
          variant="ghost"
          onPress={onSetManually}
          style={s.secondaryBtn}
        />
      </View>

      {probing ? (
        <View style={s.probingOverlay} pointerEvents="none">
          <ActivityIndicator color={C.petrol} />
          <Text style={s.probingText}>Finding your location…</Text>
        </View>
      ) : null}
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
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
    gap: S.md,
  },
  glyph: { fontSize: T.size.display + 34, marginBottom: S.lg },     // 64
  title: {
    fontSize: T.size.xxl,
    fontWeight: T.weight.bold,
    color: C.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: T.size.md,
    color: C.text2,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: S.xl,
  },
  primaryBtn: {
    minWidth: 240,
    marginTop: S.md,
  },
  secondaryBtn: {
    paddingHorizontal: S.xl,
    marginTop: S.xs,
  },
  deniedHint: {
    fontSize: T.size.sm + 1,
    color: C.text3,
    textAlign: 'center',
    marginBottom: S.md,
  },
  probingOverlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: S.sm,
  },
  probingText: {
    fontSize: T.size.base,
    color: C.text3,
  },
});
