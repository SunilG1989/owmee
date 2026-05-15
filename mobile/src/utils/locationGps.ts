import {
  PermissionsAndroid,
  Platform,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import type {
  GeolocationError,
  GeolocationResponse,
} from '@react-native-community/geolocation';

const GOOD_ACCURACY_M = 100;
const USABLE_ACCURACY_M = 650;
const BROAD_ACCURACY_M = 1_200;
const FAST_LAST_KNOWN_AGE_MS = 2 * 60 * 1_000;
const LAST_KNOWN_MAX_AGE_MS = 30 * 60 * 1_000;
const FRESH_FIX_MAX_AGE_MS = 45_000;
const LAST_KNOWN_LOOKUP_MS = 1_800;
const QUICK_FRESH_FIX_MS = 3_200;
const HARD_FRESH_FIX_MS = 8_500;

let configured = false;

export type LocationFix = {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp: number;
  ageMs: number;
  source: 'fresh' | 'last-known';
};

export type LocationFixErrorCode = 'permission-denied' | 'timeout' | 'unavailable';

export class LocationFixError extends Error {
  code: LocationFixErrorCode;

  constructor(code: LocationFixErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function configureLocationProvider() {
  if (configured) return;
  Geolocation.setRNConfiguration({
    skipPermissionRequests: false,
    authorizationLevel: 'whenInUse',
    locationProvider: Platform.OS === 'android' ? 'playServices' : 'auto',
  });
  configured = true;
}

export async function requestFineLocationPermission(): Promise<boolean> {
  configureLocationProvider();

  if (Platform.OS !== 'android') {
    return new Promise((resolve) => {
      Geolocation.requestAuthorization(
        () => resolve(true),
        () => resolve(false),
      );
    });
  }

  const alreadyGranted = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  if (alreadyGranted) return true;

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Use your location?',
      message:
        'Owmee uses your location to show nearby listings and help with safer pickups.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );

  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function getBestCurrentLocationFix(): Promise<LocationFix> {
  configureLocationProvider();

  const startedAt = Date.now();
  const freshAttempt = startFreshLocationWatch();
  let permissionError: GeolocationError | null = null;

  const lastKnown = await getLastKnownLocation().catch((error: GeolocationError) => {
    if (error?.code === 1) permissionError = error;
    return null;
  });

  if (lastKnown && isStrongLastKnown(lastKnown)) {
    freshAttempt.cancel();
    return finishLocationFix(lastKnown, startedAt);
  }

  const fresh = await freshAttempt.promise.catch((error: GeolocationError) => {
    if (error?.code === 1) permissionError = error;
    return null;
  });

  const best = chooseBestFix([fresh, lastKnown]);
  if (best) {
    return finishLocationFix(best, startedAt);
  }

  if (permissionError) {
    throw new LocationFixError('permission-denied', 'Location permission is off.');
  }

  throw new LocationFixError('timeout', 'Could not get a reliable GPS fix.');
}

export function locationErrorCopy(error: unknown) {
  if (error instanceof LocationFixError && error.code === 'permission-denied') {
    return 'Location permission is off. You can allow it or set your address manually.';
  }
  return 'We could not read your phone location yet. Try again, or set it manually.';
}

function getLastKnownLocation(): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      (pos) => resolve(toLocationFix(pos, 'last-known')),
      reject,
      {
        enableHighAccuracy: false,
        maximumAge: LAST_KNOWN_MAX_AGE_MS,
        timeout: LAST_KNOWN_LOOKUP_MS,
        distanceFilter: 0,
      },
    );
  });
}

function startFreshLocationWatch() {
  let best: GeolocationResponse | null = null;
  let done = false;
  let watchId: number | null = null;
  let quickTimer: ReturnType<typeof setTimeout> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (watchId != null) Geolocation.clearWatch(watchId);
    if (quickTimer) clearTimeout(quickTimer);
    if (hardTimer) clearTimeout(hardTimer);
    watchId = null;
    quickTimer = null;
    hardTimer = null;
  };

  const promise = new Promise<LocationFix | null>((resolve, reject) => {
    const finish = (pos: GeolocationResponse | null) => {
      if (done) return;
      done = true;
      clear();
      resolve(pos ? toLocationFix(pos, 'fresh') : null);
    };

    const fail = (error?: GeolocationError) => {
      if (done) return;
      if (best) {
        finish(best);
        return;
      }
      done = true;
      clear();
      reject(error);
    };

    quickTimer = setTimeout(() => {
      if (best && accuracyOf(best) <= USABLE_ACCURACY_M) finish(best);
    }, QUICK_FRESH_FIX_MS);

    hardTimer = setTimeout(() => finish(best), HARD_FRESH_FIX_MS);

    watchId = Geolocation.watchPosition(
      (pos) => {
        if (!isFreshEnough(pos)) return;
        const accuracy = accuracyOf(pos);
        const bestAccuracy = best ? accuracyOf(best) : Number.POSITIVE_INFINITY;
        if (!best || accuracy < bestAccuracy) best = pos;
        if (accuracy <= GOOD_ACCURACY_M) finish(pos);
      },
      fail,
      {
        enableHighAccuracy: true,
        maximumAge: FRESH_FIX_MAX_AGE_MS,
        timeout: HARD_FRESH_FIX_MS,
        interval: 1000,
        fastestInterval: 500,
        distanceFilter: 0,
      },
    );
  });

  return {
    promise,
    cancel: () => {
      done = true;
      clear();
    },
  };
}

function finishLocationFix(fix: LocationFix, startedAt: number) {
  console.info(
    `[LocationPerf] gps_fix_ms=${Date.now() - startedAt} accuracy_m=${fix.accuracy ?? 'none'} age_ms=${fix.ageMs} source=${fix.source}`,
  );
  return fix;
}

function chooseBestFix(candidates: Array<LocationFix | null>) {
  return candidates
    .filter((candidate): candidate is LocationFix => !!candidate && isUsableFix(candidate))
    .sort((a, b) => scoreFix(a) - scoreFix(b))[0] ?? null;
}

function isStrongLastKnown(fix: LocationFix) {
  return (
    fix.source === 'last-known' &&
    fix.ageMs <= FAST_LAST_KNOWN_AGE_MS &&
    accuracyOfFix(fix) <= GOOD_ACCURACY_M
  );
}

function isUsableFix(fix: LocationFix) {
  const accuracy = accuracyOfFix(fix);
  if (fix.source === 'fresh') {
    return fix.ageMs <= FRESH_FIX_MAX_AGE_MS + 5_000 && accuracy <= BROAD_ACCURACY_M;
  }

  return fix.ageMs <= LAST_KNOWN_MAX_AGE_MS && accuracy <= USABLE_ACCURACY_M;
}

function scoreFix(fix: LocationFix) {
  const accuracy = accuracyOfFix(fix);
  const agePenalty = fix.source === 'fresh'
    ? Math.min(fix.ageMs / 1000, 45) * 0.6
    : Math.min(fix.ageMs / 1000, 1800) * 0.35;
  return accuracy + agePenalty;
}

function toLocationFix(pos: GeolocationResponse, source: LocationFix['source']): LocationFix {
  const timestamp = pos.timestamp || Date.now();
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? undefined,
    timestamp,
    ageMs: Math.max(0, Date.now() - timestamp),
    source,
  };
}

function isFreshEnough(pos: GeolocationResponse) {
  return Date.now() - (pos.timestamp || Date.now()) <= FRESH_FIX_MAX_AGE_MS + 5_000;
}

function accuracyOf(pos: GeolocationResponse) {
  return pos.coords.accuracy ?? Number.POSITIVE_INFINITY;
}

function accuracyOfFix(fix: LocationFix) {
  return fix.accuracy ?? Number.POSITIVE_INFINITY;
}
