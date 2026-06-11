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

## B. ~~No UI to view your own offers~~ — RESOLVED

Sprint 6b shipped on 2026-04-30. `OffersScreen` is now reachable via
the `MyOffers` route from the Profile menu, and exposes the v2
mechanics (update-price with 3-revision lock, counter accept/decline,
48h counter clock, 7-day cooldown).

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

---

## D. Alembic migration tree has two parallel heads

**Where:** `backend/app/db/migrations/versions/`

**What:** the migration history forks at 0018:
- Chain A: `0018_community_launch → 0019_listing_sort_score → 0020_user_location → 0021_ai_phase2`
- Chain B: `0018_fe_cat_kids_checklist → 0019_admin_refresh → 0020_stuck_workflows → 0021_fe_earnings → 0022_transaction_snapshot → 0023_analytics_events → 0024_kyc_to_badge → 0025_offer_v2`

`alembic current` reports the dev DB at `0021_ai_phase2` (chain A's
tip), but the schema actually contains chain B's column additions
(e.g. `seller_kyc_verified_at_listing_time`) — meaning chain B was
applied manually outside alembic at some point. `alembic upgrade head`
fails with "Multiple head revisions are present."

**End-user impact:** none in dev (schema is correct); fresh deploys
would fail because alembic can't pick a single path.

**Suggested fix:** create a merge migration with two `down_revision`s,
or `alembic stamp 0025_offer_v2` after manually verifying schema
parity. Don't do this without checking each chain-B migration's
upgrade body against the live schema first.

**Priority:** medium-high. Blocks any environment that bootstraps
from migrations rather than a SQL dump.

## Z. Deferred items from the 2026-06-11 principal-architect hardening pass

The `hardening/principal-review-fixes` branch fixed the auth, money-safety, and
foundation issues from the review. Two foundation items were **deliberately
deferred** rather than changed in that pass, with rationale:

### Z.1 Temporal workflows lack `get_version`/`workflow.patched()` gates

**Where:** `app/modules/{kyc,transactions,disputes,field_executive}/workflows.py`

**What:** CLAUDE.md requires a version gate on every workflow change. None of the
`run()` methods have one. Adding ceremonial anchors to *running* workflows is
replay-safe but low-value without an accompanying logic change, and the Python
SDK primitive is `workflow.patched()` (not Go/Java `get_version`), so the
convention text and the SDK disagree.

**Decision:** introduce a `workflow.patched("...")` gate as part of the *next*
real change to each workflow's `run()`, verified against a Temporal replay test —
not as an untested bulk edit to live workflows. The Wave 2 refund fixes touched
only **activities** (run-once, results recorded), which do not cause replay
non-determinism, so no gate was needed there.

### Z.2 Benign migration fork (0018 / 0025 both descend from 0024)

**Where:** `app/db/migrations/versions/0018_community_launch.py`,
`0025_offer_v2.py`

**What:** Two branches descend from `0024_kyc_to_badge` and re-converge at the
`0032_merge_heads` diamond. `alembic heads` resolves to a single head.

**Decision:** the fork is already applied to every environment, so rewriting the
`down_revision` chain of applied migrations is higher-risk than the benign,
self-healing fork. The 0018 docstring was corrected to match its real parent;
the lineage itself is left intact. `alembic upgrade head` remains unambiguous.
