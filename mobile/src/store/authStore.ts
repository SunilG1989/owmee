import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AuthState as TriAuthState, SellerTier, UserRole, EligibilitySnapshot } from '../eligibility';

/** Decode the `sub` claim from a JWT. Handles base64url (RFC 7515)
 *  — RN's atob() only accepts standard base64, which is why a naive
 *  `atob(token.split('.')[1])` fails on every JWT. */
function decodeJwtSub(token: string): string {
  try {
    const raw = token.split('.')[1];
    if (!raw) return '';
    let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4;
    if (pad === 2) b64 += '==';
    else if (pad === 3) b64 += '=';
    else if (pad === 1) return '';
    const decoded = JSON.parse(atob(b64));
    return decoded.sub || '';
  } catch { return ''; }
}

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
  ) => Promise<void>;
  setTier: (t: AuthState['tier']) => void;
  setKycStatus: (s: AuthState['kycStatus']) => void;
  setTriState: (authState: TriAuthState, buyerEligible: boolean, sellerTier: SellerTier, role?: UserRole) => void;
  setPhone: (p: string) => Promise<void>;
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

let authHydratePromise: Promise<void> | null = null;

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

  setTokens: async (a, r, uid, tier, kycStatus, authState, buyerEligible, sellerTier, role) => {
    const resolvedUid = uid || decodeJwtSub(a);
    const t = (tier as AuthState['tier']) || get().tier || 'basic';
    const k = (kycStatus as AuthState['kycStatus']) || get().kycStatus || 'not_started';
    // Sprint 4 / Pass 2 — infer sane defaults if backend didn't send them
    const newAuthState: TriAuthState = authState || 'otp_verified';
    const newBuyerEligible = buyerEligible ?? (t === 'verified');
    const newSellerTier: SellerTier = sellerTier || (t === 'verified' ? 'full' : 'not_eligible');
    const newRole: UserRole = role || 'user';

    try {
      await AsyncStorage.multiSet([
        [KEYS.a, a],
        [KEYS.r, r],
        [KEYS.u, resolvedUid],
        [KEYS.tier, t],
        [KEYS.kyc, k],
        [KEYS.authState, newAuthState],
        [KEYS.buyer, newBuyerEligible ? '1' : '0'],
        [KEYS.stier, newSellerTier],
        [KEYS.role, newRole],
      ]);
    } catch (e) {
      console.warn('authStore.setTokens: AsyncStorage.multiSet failed', e);
      throw new Error('AUTH_STORAGE_FAILED');
    }

    set({
      isAuthenticated: true,
      hydrated: true,
      accessToken: a,
      refreshToken: r,
      userId: resolvedUid,
      tier: t,
      kycStatus: k,
      authState: newAuthState,
      buyerEligible: newBuyerEligible,
      sellerTier: newSellerTier,
      role: newRole,
    });
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
  setPhone: async (p) => {
    set({ phone: p });
    try {
      await AsyncStorage.setItem(KEYS.phone, p);
    } catch (e) {
      console.warn('authStore.setPhone: AsyncStorage.setItem failed', e);
    }
  },

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
    if (get().hydrated) return;
    if (authHydratePromise) return authHydratePromise;

    authHydratePromise = (async () => {
      try {
        const pairs = await AsyncStorage.multiGet([
          KEYS.a, KEYS.r, KEYS.u, KEYS.tier, KEYS.kyc, KEYS.phone,
          KEYS.authState, KEYS.buyer, KEYS.stier, KEYS.role,
        ]);
        const map: Record<string, string | null> = {};
        pairs.forEach(([k, v]) => { map[k] = v; });
        const a = map[KEYS.a];
        const r = map[KEYS.r];
        let u = map[KEYS.u];

        // Self-heal: existing builds shipped with a buggy extractUserId that
        // silently returned '' for any base64url-encoded JWT (i.e. all of
        // them). Those users have valid a + r in storage but u === ''.
        // Decode the access token and patch the userId so they stay logged
        // in without having to re-OTP.
        if (a && r && !u) {
          const sub = decodeJwtSub(a);
          if (sub) {
            u = sub;
            AsyncStorage.setItem(KEYS.u, sub).catch(() => {});
          }
        }

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
    })();

    try {
      await authHydratePromise;
    } finally {
      authHydratePromise = null;
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

export function ensureAuthHydrated(): Promise<void> {
  return useAuthStore.getState().hydrate();
}
