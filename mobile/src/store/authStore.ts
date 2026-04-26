import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AuthState as TriAuthState, SellerTier, UserRole, EligibilitySnapshot } from '../eligibility';

interface AuthState {
  isAuthenticated: boolean;
  hydrated: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  phone: string | null;
  tier: 'guest' | 'basic' | 'verified';
  kycStatus: 'not_started' | 'in_progress' | 'pending_review' | 'verified' | 'rejected';
  // ── Sprint 4 / Pass 2: tri-state + role ────────────────────────────────────
  authState: TriAuthState;
  buyerEligible: boolean;
  sellerTier: SellerTier;
  role: UserRole;
  // ───────────────────────────────────────────────────────────────────────────
  setTokens: (
    a: string,
    r: string,
    uid: string,
    tier?: string,
    kycStatus?: string,
    authState?: TriAuthState,
    buyerEligible?: boolean,
    sellerTier?: SellerTier,
    role?: UserRole,
  ) => void;
  setTier: (t: AuthState['tier']) => void;
  setKycStatus: (s: AuthState['kycStatus']) => void;
  setTriState: (authState: TriAuthState, buyerEligible: boolean, sellerTier: SellerTier, role?: UserRole) => void;
  setPhone: (p: string) => void;
  logout: () => void;
  hydrate: () => Promise<void>;
  snapshot: () => EligibilitySnapshot;
}

const KEYS = {
  a: '@ow_a',
  r: '@ow_r',
  u: '@ow_u',
  tier: '@ow_tier',
  kyc: '@ow_kyc',
  phone: '@ow_ph',
  authState: '@ow_auth_state',
  buyer: '@ow_buyer',
  stier: '@ow_stier',
  role: '@ow_role',
} as const;

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  hydrated: false,
  accessToken: null,
  refreshToken: null,
  userId: null,
  phone: null,
  tier: 'guest',
  kycStatus: 'not_started',
  // Sprint 4 / Pass 2 defaults
  authState: 'guest',
  buyerEligible: false,
  sellerTier: 'not_eligible',
  role: 'user',

  setTokens: (a, r, uid, tier, kycStatus, authState, buyerEligible, sellerTier, role) => {
    const t = (tier as AuthState['tier']) || get().tier || 'basic';
    const k = (kycStatus as AuthState['kycStatus']) || get().kycStatus || 'not_started';
    // Sprint 4 / Pass 2 — infer sane defaults if backend didn't send them
    const newAuthState: TriAuthState = authState || 'otp_verified';
    const newBuyerEligible = buyerEligible ?? (t === 'verified');
    const newSellerTier: SellerTier = sellerTier || (t === 'verified' ? 'full' : 'not_eligible');
    const newRole: UserRole = role || 'user';

    set({
      isAuthenticated: true,
      accessToken: a,
      refreshToken: r,
      userId: uid,
      tier: t,
      kycStatus: k,
      authState: newAuthState,
      buyerEligible: newBuyerEligible,
      sellerTier: newSellerTier,
      role: newRole,
    });
    AsyncStorage.multiSet([
      [KEYS.a, a],
      [KEYS.r, r],
      [KEYS.u, uid],
      [KEYS.tier, t],
      [KEYS.kyc, k],
      [KEYS.authState, newAuthState],
      [KEYS.buyer, newBuyerEligible ? '1' : '0'],
      [KEYS.stier, newSellerTier],
      [KEYS.role, newRole],
    ]).catch((e) => console.warn('authStore.setTokens: AsyncStorage.multiSet failed', e));
  },

  setTier: (t) => { set({ tier: t }); AsyncStorage.setItem(KEYS.tier, t); },
  setKycStatus: (s) => { set({ kycStatus: s }); AsyncStorage.setItem(KEYS.kyc, s); },
  setTriState: (authState, buyerEligible, sellerTier, role) => {
    const patch: Partial<AuthState> = { authState, buyerEligible, sellerTier };
    if (role) patch.role = role;
    set(patch as any);
    AsyncStorage.multiSet([
      [KEYS.authState, authState],
      [KEYS.buyer, buyerEligible ? '1' : '0'],
      [KEYS.stier, sellerTier],
      ...(role ? [[KEYS.role, role]] as [string, string][] : []),
    ]);
  },
  setPhone: (p) => { set({ phone: p }); AsyncStorage.setItem(KEYS.phone, p); },

  logout: () => {
    set({
      isAuthenticated: false,
      accessToken: null,
      refreshToken: null,
      userId: null,
      phone: null,
      tier: 'guest',
      kycStatus: 'not_started',
      authState: 'guest',
      buyerEligible: false,
      sellerTier: 'not_eligible',
      role: 'user',
    });
    AsyncStorage.multiRemove([
      KEYS.a, KEYS.r, KEYS.u, KEYS.tier, KEYS.kyc, KEYS.phone,
      KEYS.authState, KEYS.buyer, KEYS.stier, KEYS.role,
    ]);
  },

  hydrate: async () => {
    try {
      const pairs = await AsyncStorage.multiGet([
        KEYS.a, KEYS.r, KEYS.u, KEYS.tier, KEYS.kyc, KEYS.phone,
        KEYS.authState, KEYS.buyer, KEYS.stier, KEYS.role,
      ]);
      const map: Record<string, string | null> = {};
      pairs.forEach(([k, v]) => { map[k] = v; });
      const a = map[KEYS.a];
      const r = map[KEYS.r];
      const u = map[KEYS.u];
      if (a && r && u) {
        set({
          isAuthenticated: true,
          accessToken: a,
          refreshToken: r,
          userId: u,
          tier: (map[KEYS.tier] as any) || 'basic',
          kycStatus: (map[KEYS.kyc] as any) || 'not_started',
          phone: map[KEYS.phone] || null,
          authState: (map[KEYS.authState] as TriAuthState) || 'otp_verified',
          buyerEligible: map[KEYS.buyer] === '1',
          sellerTier: (map[KEYS.stier] as SellerTier) || 'not_eligible',
          role: (map[KEYS.role] as UserRole) || 'user',
        });
      }
    } catch {} finally {
      set({ hydrated: true });
    }
  },

  snapshot: () => {
    const s = get();
    return {
      isAuthenticated: s.isAuthenticated,
      authState: s.authState,
      buyerEligible: s.buyerEligible,
      sellerTier: s.sellerTier,
      role: s.role,
    };
  },
}));
