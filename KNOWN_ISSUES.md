# Known issues

Pre-existing bugs surfaced during the post-fix validation pass on
2026-04-26. None are caused by the bug-fix batch in that commit; all are
worth queuing as their own work.

## A. Auto-detected location can stick at "Detecting…"

**Where:** `mobile/src/navigation/RootNavigator.tsx:175-188`

**What:** If a user skips `LocationPickerScreen` but grants GPS
permission, RootNavigator stores `{lat, lng, city: 'Detecting…',
state: '', fullAddress: 'Detecting address…'}` in AsyncStorage. There
is no follow-up reverse-geocode, so `city` stays as the literal string
`'Detecting…'` indefinitely.

**End-user impact:** the home screen location pill, search header,
profile city, etc. all show `Detecting…` until the user manually opens
`LocationPicker` and confirms a city. Before the storage-key
unification fix, `useLocation` couldn't see this stored value at all
(it read a different key) so the user instead saw a "Set location"
pill — which is at least actionable. Unifying the keys exposed the
underlying bug.

**Suggested fix:** call Nominatim reverse-geocode from RootNavigator
the same way `LocationPickerScreen` does, and update the stored object
once the city is known. Or remove the auto-detect path entirely and
require an explicit pick.

**Priority:** medium. Affects only the "skipped picker + granted GPS"
edge case but is now user-visible.

---

## B. No UI to view your own offers (Sprint 6b deliverable never landed)

**Where:** product gap. `mobile/src/screens/OffersScreen.tsx` exists
but is unreachable — no `Tab.Screen`, no `navigate('Offers')` caller.

**What:** Sprint 6 brief §3 (Deliverable 6b) specified renaming the
"Deals" tab to "My Offers" with a new `MyOffersScreen` and the offer
v2 mechanics (3-update limit, counter flow, cooldown). Sprint 6b was
never shipped — only Sprint 6a (KYC inversion) and Sprint 8 (home
redesign + AI listing flow) landed.

**End-user impact:** buyers and sellers cannot see their own offer
history or pending counter-offers anywhere in the app. The offer
endpoints exist on the backend but no mobile screen consumes them.

**Suggested fix:** ship Sprint 6b. At minimum: a `MyOffersScreen`
reachable from Profile that lists active/countered/rejected/accepted
offers per the brief. Offer v2 backend (update_count, lockout_until,
counter_price, counter_expires_at) is also unshipped per the same
sprint brief.

**Priority:** high (core marketplace feature missing). Tracking as a
sprint, not a hotfix.

---

## C. Pre-Sprint-6a listings + late-verifying sellers don't get the badge

**Where:** migration `backend/app/db/migrations/versions/0024_kyc_to_badge.py:40-49`
plus the snapshot+live formula in
`backend/app/modules/listings/router.py::_seller_verified` and
`backend/app/modules/listings/feed_router.py::_serialize_row`.

**What:** the snapshot column was backfilled on 2026-04-21 from each
seller's KYC status at that moment. A seller who completes KYC after
the backfill date does not retroactively earn the "Verified by Owmee"
badge on listings they created before they verified.

The Sprint 6a amendment intends snapshot to record verification at
*listing creation* time, but for pre-6a listings there is no
historical record — the migration's own comment acknowledges the
backfill is "best-effort". So the snapshot column is permanently False
for those listings even if the seller is verified now.

**End-user impact:** a newly-verified seller with active pre-6a
listings sees no badge on those old listings even though they are now
verified. New listings work correctly. May surprise sellers who don't
realize re-listing would help.

**Suggested fix:** on the KYC-verified webhook, run a one-shot update
for that seller's still-active listings — but only those created
before the verification timestamp, and only if business policy is OK
with retroactive badging. This is a small policy decision, not a bug.
Document the chosen behavior in the Sprint 6a amendment when fixed.

**Priority:** low. Cosmetic; affects a small cohort. Worth tackling
once there are real verified-after-listing sellers in the system.
