/**
 * Auth store — Zustand + AsyncStorage
 * AsyncStorage is the safe choice (no native module needed beyond what RN ships).
 * MMKV would be faster but requires native build — switched for emulator compatibility.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAuthToken } from '../services/api';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  tier: 'basic' | 'verified' | null;
  kycStatus: string | null;
  isAuthenticated: boolean;

  setTokens: (access: string, refresh: string, tier: string, kycStatus: string, userId?: string) => void;
  clearAuth: () => void;
  updateTier: (tier: string, kycStatus: string) => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  userId: null,
  tier: null,
  kycStatus: null,
  isAuthenticated: false,

  setTokens: (access, refresh, tier, kycStatus, userId) => {
    setAuthToken(access);
    AsyncStorage.multiSet([
      ['access_token', access],
      ['refresh_token', refresh],
      ['tier', tier],
      ['kyc_status', kycStatus],
      ...(userId ? [['user_id', userId] as [string, string]] : []),
    ]);
    set({
      accessToken: access,
      refreshToken: refresh,
      userId: userId ?? null,
      tier: tier as 'basic' | 'verified',
      kycStatus,
      isAuthenticated: true,
    });
  },

  updateTier: (tier, kycStatus) => {
    AsyncStorage.multiSet([['tier', tier], ['kyc_status', kycStatus]]);
    set({ tier: tier as 'basic' | 'verified', kycStatus });
  },

  clearAuth: () => {
    AsyncStorage.multiRemove(['access_token', 'refresh_token', 'tier', 'kyc_status', 'user_id']);
    setAuthToken(null);
    set({
      accessToken: null,
      refreshToken: null,
      userId: null,
      tier: null,
      kycStatus: null,
      isAuthenticated: false,
    });
  },

  hydrate: async () => {
    const keys = ['access_token', 'refresh_token', 'tier', 'kyc_status', 'user_id'];
    const pairs = await AsyncStorage.multiGet(keys);
    const data = Object.fromEntries(pairs.map(([k, v]) => [k, v]));
    if (data['access_token']) {
      setAuthToken(data['access_token']);
      set({
        accessToken: data['access_token'],
        refreshToken: data['refresh_token'],
        userId: data['user_id'],
        tier: (data['tier'] as 'basic' | 'verified') ?? null,
        kycStatus: data['kyc_status'],
        isAuthenticated: true,
      });
    }
  },
}));
