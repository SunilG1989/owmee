# Mobile hardening — done + follow-ups (2026-06-11 review)

## Done in this pass (type-checked, `tsc --noEmit` clean)

- **Buyer-protection wording** (hard rule — must be "100% refund if not as
  promised", never "held until you confirm" / "released after confirmation"):
  - `src/screens/auth/OnboardingScreen.tsx:29` — reworded.
  - `src/screens/purchase/OrderConfirmationScreen.tsx:16,30` — reworded (timeline
    step 5 + subtitle).
- **HomeScreen feed virtualization** — added `removeClippedSubviews`,
  `windowSize`, `maxToRenderPerBatch`, `initialNumToRender` to the main
  `FlatList` (`src/screens/HomeScreen.tsx:517`), mirroring OffersScreen.
- **ErrorBoundary** — verified already mounted in `App.tsx` (wraps
  `<RootNavigator/>`); no change needed.

## Follow-ups that need the native toolchain or a running app

### 1. Secure token storage (needs a native dependency)
`src/store/authStore.ts` persists the access + refresh JWTs in plaintext
`AsyncStorage` (`@ow_a` / `@ow_r`). The real fix is the iOS Keychain / Android
Keystore via `react-native-keychain` (or `expo-secure-store`), which requires
adding the dependency and a native rebuild — not doable from a headless edit.

Recommended: add `react-native-keychain`, create `src/services/secureStore.ts`
with `getToken/setToken/clear`, route all token reads/writes in `authStore.ts`
through it (currently 7 direct AsyncStorage call sites: `setTokens`, `setTier`,
`setKycStatus`, `setTriState`, `setPhone`, `logout`, `hydrate`). Keep non-secret
prefs in AsyncStorage; move only `@ow_a`/`@ow_r` to the keychain.

### 2. Design-system sweep (mechanical, but needs a visual pass)
The hard quality bar (no raw `TouchableOpacity`, no hex/rgba literals, no
hardcoded font/padding/radius numbers — use tokens + `components/ui`). This is a
large, regression-prone sweep across styling, so it should be done file-by-file
with the app running to catch layout regressions, not blind.

**DONE — exact-match color literals → tokens (value-preserving):** 26 hex/rgba
literals that exactly equal a token value were replaced with the token across 10
files (HomeScreen, HeroCard, SearchScreen, OwmeeListingCard, RootNavigator,
LocationMapScreen, CreateListingScreen, and the AI price/comparables/edit
sheets). Pixel-identical by construction; verified with `tsc --noEmit` + a full
Metro bundle build. The remaining color literals are genuine one-offs with no
matching token — promoting those to tokens is a design decision (don't auto-map
to the nearest value). Still TODO below:

Heaviest `TouchableOpacity` offenders (raw, outside `components/ui/`):

| File | count |
|---|---|
| `screens/listings/ai/AIListingSuggestScreen.tsx` | 31 |
| `screens/listings/CreateListingScreen.tsx` | 29 |
| `screens/TransactionDetailScreen.tsx` | 19 |
| `screens/listings/ai/shared/EditDetailsSheet.tsx` | 18 |
| `screens/HomeScreen.tsx` | 15 |
| `screens/listings/MyListingsScreen.tsx` | 14 |
| `screens/listings/concierge/BookingScreen.tsx` | 13 |
| `screens/fe/FeCaptureScreen.tsx` | 13 |

Plus hex/rgba color literals across ~25 files (heaviest: `OwmeeListingCard.tsx`,
`HomeScreen.tsx`, `HeroCard.tsx`, `LocationMapScreen.tsx`, `SearchScreen.tsx`)
and hardcoded numeric size/padding/radius literals (and `T.size.display + 18`
arithmetic-on-tokens) in the Order/Checkout/RootNavigator screens.

Suggested order: migrate the `ui/` primitive usage first (swap raw
`TouchableOpacity` → `Button`/`IconButton`/`Card`/`Chip`), then colors, then
numeric tokens, one screen per PR with a screenshot diff.

### 3. Other correctness items from the review (lower risk, do with app running)
- Typed navigation params + API responses (replace `({navigation,route}: any)`
  and the `r.data.x || r.data || []` response guessing with the existing
  `RootStackParams` types and typed response generics).
- `OffersScreen.load` closes over `refreshing` (flashes full-screen loader on
  pull-to-refresh).
- Config: move the hardcoded API hosts in `config.ts` to env injection.
