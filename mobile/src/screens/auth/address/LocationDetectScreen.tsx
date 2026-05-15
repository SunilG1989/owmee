/**
 * LocationDetectScreen — Address PRD section 4.2 screen A.
 *
 * The decision moment between "use my GPS" and "set manually."
 * Shown to:
 *   - Brand-new users who just OTP'd in and have no saved addresses.
 *   - Returning users who tap "+ Add a new address" from the picker.
 *
 * Permission denied / GPS times out / GPS too inaccurate stays on this
 * screen with a clear recovery path. We do not pretend Bengaluru centre
 * is the user's current location.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LocateFixed, MapPin } from 'lucide-react-native';

import { BackButton, Button } from '../../../components/ui';
import { C, R, S, Shadow, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';
import {
  getBestCurrentLocationFix,
  locationErrorCopy,
  requestFineLocationPermission,
} from '../../../utils/locationGps';

const BENGALURU = { lat: 12.9716, lng: 77.5946 };

export default function LocationDetectScreen({
  navigation,
  route,
}: RootScreen<'LocationDetect'>) {
  const [probing, setProbing] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const goToMap = (
    lat: number,
    lng: number,
    source: 'gps_detected' | 'manual',
    gpsAccuracy?: number,
  ) => {
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
    setLocationError(null);
    try {
      const granted = await requestFineLocationPermission();
      if (!granted) {
        setLocationError('Location permission is off. You can allow it or set your address manually.');
        setProbing(false);
        return;
      }

      const fix = await getBestCurrentLocationFix();
      goToMap(fix.lat, fix.lng, 'gps_detected', fix.accuracy);
    } catch (e) {
      setLocationError(locationErrorCopy(e));
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
        <View style={s.iconOrb}>
          <MapPin size={42} color={C.petrolDeep} strokeWidth={2.25} />
        </View>
        <Text style={s.title}>Where are you located?</Text>
        <Text style={s.subtitle}>
          Owmee uses your location to show items near you and let our
          specialists find your home for pickups.
        </Text>

        {locationError ? (
          <Text style={s.errorHint}>{locationError}</Text>
        ) : null}

        <Button
          label={probing ? 'Finding location' : 'Use my current location'}
          onPress={onUseCurrent}
          loading={probing}
          style={s.primaryBtn}
        />

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
          <View style={s.probingRow}>
            <LocateFixed size={15} color={C.text3} strokeWidth={2.4} />
            <Text style={s.probingText}>Finding your location...</Text>
          </View>
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
  iconOrb: {
    width: 88,
    height: 88,
    borderRadius: R.xl + R.lg,
    backgroundColor: C.petrolLight,
    borderWidth: 1,
    borderColor: C.blueBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: S.lg,
    ...Shadow.subtle,
  },
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
  errorHint: {
    fontSize: T.size.sm + 1,
    color: C.coralDeep,
    textAlign: 'center',
    marginBottom: S.md,
    lineHeight: 20,
  },
  probingOverlay: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: S.sm,
  },
  probingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.xs,
  },
  probingText: {
    fontSize: T.size.base,
    color: C.text3,
  },
});
