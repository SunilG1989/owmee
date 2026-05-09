/**
 * useLocation — Address PRD section 5.2
 *
 * Source of truth: the user's default `user_addresses` row, fetched from
 * /v1/users/me/addresses on auth + on focus. AsyncStorage is kept as a
 * cold-start cache so the home pill renders instantly while the API
 * request races in the background.
 *
 * Behavior matrix:
 *   Authed + has default address → location reflects that row
 *   Authed + no addresses        → location stays null; UI shows "Set location"
 *   Unauthed                     → falls back to AsyncStorage cache (last known
 *                                  location from a previous session, if any)
 *
 * Compatibility shims (legacy callers)
 * ------------------------------------
 *   - INDIAN_CITIES is still exported for any screen that hasn't been
 *     migrated off it (e.g. EditProfileScreen). Will be removed when
 *     PRD Phase 2 sweeps those.
 *   - request() / setManualCity() — kept as no-ops so old callers
 *     compile. New code should use the AddressPicker / 3-screen flow.
 */
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOCATION_KEY } from '../utils/storageKeys';
import { useAuthStore } from '../store/authStore';
import { Addresses } from '../services/api';
import { addressToLocation, cacheAddressLocation, type UserLocation } from '../utils/addressLocation';

// Kept for legacy imports. Prefer reading the user's default address.
export const INDIAN_CITIES = [
  { name: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  { name: 'Mumbai', lat: 19.076, lng: 72.8777 },
  { name: 'Delhi', lat: 28.7041, lng: 77.1025 },
  { name: 'Hyderabad', lat: 17.385, lng: 78.4867 },
  { name: 'Chennai', lat: 13.0827, lng: 80.2707 },
  { name: 'Pune', lat: 18.5204, lng: 73.8567 },
  { name: 'Kolkata', lat: 22.5726, lng: 88.3639 },
  { name: 'Ahmedabad', lat: 23.0225, lng: 72.5714 },
  { name: 'Jaipur', lat: 26.9124, lng: 75.7873 },
  { name: 'Lucknow', lat: 26.8467, lng: 80.9462 },
];

export function useLocation() {
  const { isAuthenticated } = useAuthStore();
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  // Cold start: read whatever was cached locally so the UI doesn't flash.
  useEffect(() => {
    AsyncStorage.getItem(LOCATION_KEY)
      .then((s) => {
        if (s) {
          try {
            setLocation(JSON.parse(s));
          } catch {}
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const refresh = useCallback(async (isCancelled?: () => boolean) => {
    if (!isAuthenticated) return;
    try {
      const res = await Addresses.list();
      if (isCancelled?.()) return;
      const def =
        res.data.find((a) => a.is_default) ??
        (res.data.length > 0 ? res.data[0] : null);
      if (def) {
        const loc = addressToLocation(def);
        setLocation(loc);
        cacheAddressLocation(def).catch(() => {});
      } else {
        // Authed user with no addresses — clear the stale cache so the
        // pill says "Set location" instead of showing a previous user's
        // address that the current user never set.
        setLocation(null);
        AsyncStorage.removeItem(LOCATION_KEY).catch(() => {});
      }
    } catch {
      // Silent; cold-start cache stays.
    } finally {
      if (!isCancelled?.()) setLoading(false);
    }
  }, [isAuthenticated]);

  // Authed path: refresh from API. Default address wins.
  useEffect(() => {
    let cancelled = false;
    refresh(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      refresh(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [refresh]),
  );

  // Legacy no-ops: any code still calling these compiles, but the new
  // flow lives in the address screens. Remove when PRD Phase 2 finishes
  // its consumer sweep.
  const request = useCallback(async (): Promise<UserLocation | null> => {
    setDenied(false);
    return null;
  }, []);

  const setManualCity = useCallback(
    async (_city: { name: string; lat: number; lng: number }) => {
      // Caller should navigate to the LocationDetect flow instead. This
      // shim only exists to keep EditProfileScreen-style legacy code
      // compiling until it's swept in Phase 2.
    },
    [],
  );

  return { location, loading, denied, request, setManualCity, refresh };
}
