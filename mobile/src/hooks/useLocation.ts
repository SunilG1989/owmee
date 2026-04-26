import { useState, useEffect, useCallback } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from '@react-native-community/geolocation';
import { LOCATION_KEY } from '../utils/storageKeys';

export interface UserLocation { lat: number; lng: number; city: string; locality?: string; }

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

// T1-05: Pure math, zero network, < 0.1ms — replaces Nominatim HTTP call
function nearestCity(lat: number, lng: number): string {
  let best = INDIAN_CITIES[0], min = Infinity;
  for (const c of INDIAN_CITIES) {
    const d = (c.lat - lat) ** 2 + (c.lng - lng) ** 2; // squared distance is fine for comparison
    if (d < min) { min = d; best = c; }
  }
  return best.name;
}

export function useLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  // T1-03 synergy: load cached location FIRST — instant, no flash
  useEffect(() => {
    AsyncStorage.getItem(LOCATION_KEY).then(s => {
      if (s) { try { setLocation(JSON.parse(s)); } catch {} }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const save = async (loc: UserLocation) => {
    setLocation(loc);
    AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
  };

  const request = useCallback(async () => {
    setLoading(true);
    try {
      if (Platform.OS === 'android') {
        const g = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          { title: 'Location', message: 'Show items near you', buttonPositive: 'Allow', buttonNegative: 'Not now' });
        if (g !== PermissionsAndroid.RESULTS.GRANTED) { setDenied(true); setLoading(false); return null; }
      }
      return new Promise<UserLocation | null>((resolve) => {
        Geolocation.getCurrentPosition(
          async (pos) => {
            const city = nearestCity(pos.coords.latitude, pos.coords.longitude); // T1-05: instant, no HTTP
            const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, city };
            await save(loc); setLoading(false); resolve(loc);
          },
          () => { setDenied(true); setLoading(false); resolve(null); },
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 }, // T1-04: 10s → 5s
        );
      });
    } catch { setLoading(false); return null; }
  }, []);

  const setManualCity = useCallback(async (city: typeof INDIAN_CITIES[0]) => {
    await save({ lat: city.lat, lng: city.lng, city: city.name });
  }, []);

  return { location, loading, denied, request, setManualCity };
}
