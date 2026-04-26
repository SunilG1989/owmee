import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AuthState {
  isAuthenticated: boolean;
  hydrated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  phone: string | null;
  tier: 'guest' | 'basic' | 'verified';
  kycStatus: 'not_started' | 'in_progress' | 'pending_review' | 'verified' | 'rejected';
  // FIX: setTokens now accepts tier + kycStatus from backend response
  setTokens: (a: string, r: string, uid: string, tier?: string, kycStatus?: string) => void;
  setTier: (t: AuthState['tier']) => void;
  setKycStatus: (s: AuthState['kycStatus']) => void;
  setPhone: (p: string) => void;
  logout: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false, hydrated: false,
  accessToken: null, refreshToken: null, userId: null,
  phone: null, tier: 'guest', kycStatus: 'not_started',

  // FIX: persist tier + kycStatus alongside tokens
  setTokens: (a, r, uid, tier, kycStatus) => {
    const t = (tier as AuthState['tier']) || get().tier || 'basic';
    const k = (kycStatus as AuthState['kycStatus']) || get().kycStatus || 'not_started';
    set({ isAuthenticated: true, accessToken: a, refreshToken: r, userId: uid, tier: t, kycStatus: k });
    AsyncStorage.multiSet([['@ow_a', a], ['@ow_r', r], ['@ow_u', uid], ['@ow_tier', t], ['@ow_kyc', k]]);
  },

  setTier: (t) => { set({ tier: t }); AsyncStorage.setItem('@ow_tier', t); },
  setKycStatus: (s) => { set({ kycStatus: s }); AsyncStorage.setItem('@ow_kyc', s); },
  setPhone: (p) => { set({ phone: p }); AsyncStorage.setItem('@ow_ph', p); },

  logout: () => {
    set({ isAuthenticated: false, accessToken: null, refreshToken: null, userId: null, phone: null, tier: 'guest', kycStatus: 'not_started' });
    AsyncStorage.multiRemove(['@ow_a', '@ow_r', '@ow_u', '@ow_tier', '@ow_kyc', '@ow_ph']);
  },

  hydrate: async () => {
    try {
      const [[, a], [, r], [, u], [, t], [, k], [, p]] = await AsyncStorage.multiGet(['@ow_a', '@ow_r', '@ow_u', '@ow_tier', '@ow_kyc', '@ow_ph']);
      if (a && r && u) {
        set({
          isAuthenticated: true, accessToken: a, refreshToken: r, userId: u,
          tier: (t as any) || 'basic', kycStatus: (k as any) || 'not_started',
          phone: p || null,
        });
      }
    } catch {} finally {
      set({ hydrated: true });
    }
  },
}));
