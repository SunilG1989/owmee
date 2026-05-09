import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserAddress } from '../services/api';
import { LOCATION_KEY } from './storageKeys';

export interface UserLocation {
  lat: number;
  lng: number;
  city: string;
  locality?: string;
  state?: string;
  pincode?: string;
  fullAddress?: string;
  addressId?: string;
  label?: string;
}

function addressLabel(addr: Pick<UserAddress, 'label' | 'custom_label'>) {
  if (addr.label === 'other' && addr.custom_label) return addr.custom_label;
  return addr.label.charAt(0).toUpperCase() + addr.label.slice(1);
}

export function addressToLocation(addr: UserAddress): UserLocation {
  const label = addressLabel(addr);
  const fullAddress = [
    addr.flat_house_number,
    addr.building_name,
    addr.address_line_1,
    addr.locality,
    addr.city,
    addr.pincode,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    lat: addr.lat,
    lng: addr.lng,
    city: addr.city,
    locality: addr.locality ?? undefined,
    state: addr.state,
    pincode: addr.pincode ?? undefined,
    fullAddress,
    addressId: addr.id,
    label,
  };
}

export function cacheAddressLocation(addr: UserAddress) {
  return AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(addressToLocation(addr)));
}

export function locationDisplayLabel(
  location: UserLocation | null,
  fallback = 'Set location',
) {
  if (!location) return fallback;
  const area = location.locality || location.city;
  if (location.label && area) return `${location.label} · ${area}`;
  return area || location.label || fallback;
}
