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
import React, { useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, Button } from '../../../components/ui';
import { C, MIN_TAP, R, S, Shadow, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

const BENGALURU = { lat: 12.9716, lng: 77.5946 };
const GPS_TIMEOUT_MS = 10_000;

export default function LocationDetectScreen({
  navigation,
  route,
}: RootScreen<'LocationDetect'>) {
  const [probing, setProbing] = useState(false);
  const [denied, setDenied] = useState(false);

  const onUseCurrent = async () => {
    setProbing(true);
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

      Geolocation.getCurrentPosition(
        (pos) => {
          // PRD 9.2: accuracy > 1000m means we're effectively indoors —
          // skip the GPS fix entirely and let user drop the pin manually.
          const accuracy = (pos.coords as any).accuracy ?? 0;
          if (accuracy > 1000) {
            navigation.replace('LocationMap', {
              initialLat: BENGALURU.lat,
              initialLng: BENGALURU.lng,
              source: 'manual',
              ...route.params,
            });
            return;
          }
          navigation.replace('LocationMap', {
            initialLat: pos.coords.latitude,
            initialLng: pos.coords.longitude,
            source: 'gps_detected',
            gpsAccuracy: accuracy,
            ...route.params,
          });
        },
        () => {
          // Timeout / position-unavailable: fall through to manual map.
          navigation.replace('LocationMap', {
            initialLat: BENGALURU.lat,
            initialLng: BENGALURU.lng,
            source: 'manual',
            ...route.params,
          });
        },
        {
          enableHighAccuracy: true,
          timeout: GPS_TIMEOUT_MS,
          maximumAge: 0,
        },
      );
    } catch {
      setProbing(false);
    }
  };

  const onSetManually = () => {
    navigation.replace('LocationMap', {
      initialLat: BENGALURU.lat,
      initialLng: BENGALURU.lng,
      source: 'manual',
      ...route.params,
    });
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

        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={onSetManually}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <Text style={s.secondaryText}>Set manually</Text>
        </TouchableOpacity>
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
  glyph: { fontSize: 64, marginBottom: S.lg },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: C.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
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
    minHeight: MIN_TAP,
    paddingHorizontal: S.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: S.xs,
  },
  secondaryText: {
    fontSize: 16,
    color: C.text2,
    fontWeight: '500',
  },
  deniedHint: {
    fontSize: 14,
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
    fontSize: 13,
    color: C.text3,
  },
});
