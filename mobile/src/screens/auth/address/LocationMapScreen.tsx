/**
 * LocationMapScreen — Address PRD section 4.2 screen B.
 *
 * Android release hardening:
 * react-native-maps uses Google Maps under the hood on Android and crashes
 * the app if com.google.android.geo.API_KEY is missing. Until the production
 * Google Maps key is configured, this screen deliberately avoids native maps.
 * It still uses GPS/search coordinates, reverse-geocodes them, lets the user
 * lightly adjust the point, and then moves into the structured address form.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Geo, type PhotonReverseResponse } from '../../../services/api';
import { BackButton, Button } from '../../../components/ui';
import { C, R, S, Shadow, T } from '../../../utils/tokens';
import type { RootScreen } from '../../../navigation/types';

const SMALL_STEP = 0.0015;

export default function LocationMapScreen({
  navigation,
  route,
}: RootScreen<'LocationMap'>) {
  const { initialLat, initialLng, source, gpsAccuracy } = route.params;

  const [center, setCenter] = useState({ lat: initialLat, lng: initialLng });
  const [reverse, setReverse] = useState<PhotonReverseResponse | null>(null);
  const [loadingReverse, setLoadingReverse] = useState(true);
  const [reverseError, setReverseError] = useState(false);
  const inFlightRef = useRef(0);

  const fetchReverse = useCallback(async (lat: number, lng: number) => {
    const seq = ++inFlightRef.current;
    setLoadingReverse(true);
    setReverseError(false);
    try {
      const r = await Geo.reverseGeocodeStructured(lat, lng);
      if (seq !== inFlightRef.current) return;
      setReverse(r.data);
    } catch {
      if (seq !== inFlightRef.current) return;
      setReverseError(true);
      setReverse(null);
    } finally {
      if (seq === inFlightRef.current) setLoadingReverse(false);
    }
  }, []);

  useEffect(() => {
    fetchReverse(center.lat, center.lng);
  }, [center.lat, center.lng, fetchReverse]);

  const nudge = (latDelta: number, lngDelta: number) => {
    setCenter((prev) => ({
      lat: Number((prev.lat + latDelta).toFixed(7)),
      lng: Number((prev.lng + lngDelta).toFixed(7)),
    }));
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

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={s.headerTitle}>Confirm your location</Text>
      </View>

      <View style={s.previewWrap}>
        <View style={s.mapSurface}>
          <View style={s.gridA} />
          <View style={s.gridB} />
          <View style={s.gridC} />
          <View style={s.gridD} />
          <View style={s.ringOuter}>
            <View style={s.ringInner}>
              <Text style={s.pinGlyph}>📍</Text>
            </View>
          </View>
        </View>

        {gpsAccuracy && gpsAccuracy > 100 ? (
          <View style={s.accuracyBadge}>
            <Text style={s.accuracyText}>
              Approx location. Fine tune if needed.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={s.sheet}>
        {loadingReverse ? (
          <View style={s.sheetLoading}>
            <ActivityIndicator color={C.petrol} />
            <Text style={s.sheetSub}>Reading location...</Text>
          </View>
        ) : reverseError ? (
          <Text style={s.sheetError}>
            Could not read this spot. You can fill the address manually next.
          </Text>
        ) : reverse ? (
          <>
            <Text style={s.sheetMain} numberOfLines={2}>
              {reverse.approximate_address || 'Selected location'}
            </Text>
            <Text style={s.sheetSub}>
              {[reverse.city, reverse.pincode].filter(Boolean).join(' ') || ' '}
            </Text>
            {!reverse.in_service_area ? (
              <Text style={s.sheetWarn}>
                Specialist visits are currently limited to Bengaluru.
              </Text>
            ) : null}
          </>
        ) : null}

        <View style={s.nudgeWrap}>
          <Text style={s.nudgeTitle}>Adjust pin</Text>
          <View style={s.nudgeGrid}>
            <View style={s.nudgeSpacer} />
            <NudgeButton label="Up" onPress={() => nudge(SMALL_STEP, 0)} />
            <View style={s.nudgeSpacer} />
            <NudgeButton label="Left" onPress={() => nudge(0, -SMALL_STEP)} />
            <NudgeButton label="Right" onPress={() => nudge(0, SMALL_STEP)} />
            <NudgeButton label="Down" onPress={() => nudge(-SMALL_STEP, 0)} />
          </View>
        </View>

        <Button
          label={reverse ? 'Confirm location' : 'Enter address details'}
          onPress={onConfirm}
          disabled={loadingReverse}
          style={s.confirmBtn}
        />
      </View>
    </SafeAreaView>
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
  previewWrap: {
    flex: 1,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
  },
  mapSurface: {
    flex: 1,
    minHeight: 280,
    borderRadius: R.xl,
    overflow: 'hidden',
    backgroundColor: '#EAF4F1',
    borderWidth: 1,
    borderColor: 'rgba(47, 118, 107, 0.14)',
    ...Shadow.glow,
  },
  gridA: {
    position: 'absolute',
    left: -40,
    right: -20,
    top: '28%',
    height: 42,
    transform: [{ rotate: '-12deg' }],
    backgroundColor: 'rgba(255, 253, 248, 0.78)',
  },
  gridB: {
    position: 'absolute',
    left: -20,
    right: -30,
    top: '58%',
    height: 34,
    transform: [{ rotate: '10deg' }],
    backgroundColor: 'rgba(255, 253, 248, 0.62)',
  },
  gridC: {
    position: 'absolute',
    top: -40,
    bottom: -30,
    left: '24%',
    width: 38,
    transform: [{ rotate: '18deg' }],
    backgroundColor: 'rgba(187, 104, 79, 0.08)',
  },
  gridD: {
    position: 'absolute',
    top: -50,
    bottom: -30,
    right: '20%',
    width: 30,
    transform: [{ rotate: '-20deg' }],
    backgroundColor: 'rgba(47, 118, 107, 0.10)',
  },
  ringOuter: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 150,
    height: 150,
    marginLeft: -75,
    marginTop: -75,
    borderRadius: 75,
    backgroundColor: 'rgba(47, 118, 107, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: 'rgba(255, 253, 248, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(47, 118, 107, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinGlyph: {
    fontSize: T.size.display + 14,
  },
  accuracyBadge: {
    position: 'absolute',
    top: S.xl,
    left: S.xl,
    right: S.xl,
    backgroundColor: 'rgba(15,26,31,0.80)',
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
  nudgeWrap: {
    marginTop: S.sm,
    padding: S.sm,
    borderRadius: R.md,
    backgroundColor: C.bone,
  },
  nudgeTitle: {
    fontSize: T.size.sm,
    color: C.text3,
    fontWeight: T.weight.semi,
    marginBottom: S.xs,
  },
  nudgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: S.xs,
  },
  nudgeSpacer: {
    width: '31%',
  },
  nudgeButton: {
    width: '31%',
    minHeight: 34,
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
  confirmBtn: {
    marginTop: S.md,
  },
});
