/**
 * Eligibility types + selectors — Sprint 4 / Pass 2 (mobile)
 *
 * Mirrors backend app/eligibility.py. Tri-state model:
 *   authState      : guest | otp_verified | suspended
 *   buyerEligible  : bool
 *   sellerTier     : not_eligible | lite | full | restricted
 *   role           : user | fe
 *
 * Components should consume these via selectors on the authStore, never by
 * inspecting fields directly. Selectors collapse the matrix into intent-level
 * booleans the UI can branch on.
 */

export type AuthState = 'guest' | 'otp_verified' | 'suspended';
export type SellerTier = 'not_eligible' | 'lite' | 'full' | 'restricted';
export type UserRole = 'user' | 'fe';

export interface EligibilitySnapshot {
  isAuthenticated: boolean;
  authState: AuthState;
  buyerEligible: boolean;
  sellerTier: SellerTier;
  role: UserRole;
}

// ── Intent selectors ─────────────────────────────────────────────────────────

export function canBrowse(_e: EligibilitySnapshot): boolean {
  // Browsing is public; guests included.
  return true;
}

export function canDraftListing(e: EligibilitySnapshot): boolean {
  // Sprint 4: drafting requires OTP but not KYC.
  return e.isAuthenticated && e.authState === 'otp_verified';
}

export function canSell(e: EligibilitySnapshot): boolean {
  if (e.authState !== 'otp_verified') return false;
  return e.sellerTier === 'lite' || e.sellerTier === 'full';
}

export function canBuy(e: EligibilitySnapshot): boolean {
  if (e.authState !== 'otp_verified') return false;
  return e.buyerEligible;
}

export function canRequestFeVisit(e: EligibilitySnapshot): boolean {
  // A seller who has OTP-verified but hasn't done KYC is exactly who FE visits
  // are for. We allow it for any OTP-verified non-restricted user.
  return (
    e.isAuthenticated &&
    e.authState === 'otp_verified' &&
    e.sellerTier !== 'restricted'
  );
}

export function isFE(e: EligibilitySnapshot): boolean {
  return e.isAuthenticated && e.role === 'fe';
}

export function nextVerificationPath(
  e: EligibilitySnapshot,
  intent: 'buy' | 'sell' | 'publish',
): 'auth' | 'buyer_kyc' | 'seller_aadhaar' | 'seller_pan_liveness' | 'done' {
  if (!e.isAuthenticated || e.authState === 'guest') return 'auth';
  if (intent === 'buy') return e.buyerEligible ? 'done' : 'buyer_kyc';
  if (intent === 'sell' || intent === 'publish') {
    if (e.sellerTier === 'not_eligible' || e.sellerTier === 'restricted') {
      return 'seller_aadhaar';
    }
    if (e.sellerTier === 'lite' && intent === 'publish') return 'done';
    return 'done';
  }
  return 'done';
}

// ── TDS constants (mirrored from backend) ─────────────────────────────────────

export const TDS_THRESHOLD_PAISE = 500_000_00; // ₹5,00,000
export const TDS_NUDGE_PAISE = 400_000_00;     // ₹4,00,000
export const TDS_RATE_FULL = 0.01;             // 1%
export const TDS_RATE_206AA = 0.05;            // 5%

export function paiseToRupees(paise: number): number {
  return Math.round(paise / 100);
}

export function formatRupees(paise: number): string {
  const rupees = paiseToRupees(paise);
  return `₹${rupees.toLocaleString('en-IN')}`;
}
