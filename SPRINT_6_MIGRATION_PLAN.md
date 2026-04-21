# Sprint 6 Migration Plan

Three Alembic migrations, applied in strict order. Each ships as part of its deliverable bundle (6a / 6b / 6c).

**Alembic chain at start of Sprint 6:** `0026_pass4_batch2` (HEAD)

**Target at end of Sprint 6:** `0029_hybrid_logistics` (HEAD)

---

## Migration 0027 — KYC to badge (ships with Deliverable 6a)

**File:** `backend/app/db/migrations/versions/0027_kyc_to_badge.py`
**Revision:** `0027_kyc_to_badge`
**Down revision:** `0026_pass4_batch2` (or whatever current HEAD is — verify)

### Schema changes

**Additive only. No destructive changes.**

```sql
-- Snapshot the seller's verification status at the time of listing creation.
-- Used for (a) ranking, (b) dispute evidence.
ALTER TABLE listings
  ADD COLUMN seller_kyc_verified_at_listing_time BOOLEAN DEFAULT FALSE;

-- Index to accelerate "verified sellers first" ranking queries
CREATE INDEX idx_listings_seller_verified_recent
  ON listings (seller_kyc_verified_at_listing_time, created_at DESC)
  WHERE status = 'active';
```

### Backfill

```sql
-- For existing listings, set the snapshot based on current seller state.
-- Not perfect (it should reflect state at time of creation), but the only
-- feasible backfill. Future listings will snapshot correctly at creation.
UPDATE listings L
SET seller_kyc_verified_at_listing_time = (
  SELECT (u.kyc_status = 'verified')
  FROM users u
  WHERE u.id = L.seller_id
);
```

### App code changes in same deliverable

- **Remove** KYC gate from `listings/router.py::create_listing` — any authenticated user can create
- **Remove** KYC gate from `offers/router.py::create_offer` and `accept_offer`
- **Keep** KYC gate on `payouts/router.py::request_payout` (unchanged)
- **Add** in `listings/service.py::create_listing`: snapshot seller KYC state → `seller_kyc_verified_at_listing_time`
- **Add** to listings serializer: include `verified_by_owmee: bool` in API response (computed from snapshot)
- **Modify** listings ranking query in `listings/search.py`: multiply score by 1.3 when `seller_kyc_verified_at_listing_time = true`

### Rollback plan

```sql
DROP INDEX IF EXISTS idx_listings_seller_verified_recent;
ALTER TABLE listings DROP COLUMN seller_kyc_verified_at_listing_time;
```

App code rollback = revert the 6a commit. No data loss.

### Pre-migration check

```bash
# Ensure current HEAD is 0026
docker compose exec api alembic current
```

### Post-migration verification

```bash
# Confirm column exists
docker compose exec api psql "$DATABASE_URL" -c "\d listings" | grep seller_kyc

# Confirm backfill worked
docker compose exec api psql "$DATABASE_URL" -c \
  "SELECT seller_kyc_verified_at_listing_time, COUNT(*) FROM listings GROUP BY 1;"
# Expected: true + false counts matching user KYC distribution
```

---

## Migration 0028 — Offer v2 + chat deletion (ships with Deliverable 6b)

**File:** `backend/app/db/migrations/versions/0028_offer_v2.py`
**Revision:** `0028_offer_v2`
**Down revision:** `0027_kyc_to_badge`

### Schema changes

**Additive for offers. Destructive for chat.**

```sql
-- ── Offers v2: update mechanic ────────────────────────────────────────────
ALTER TABLE offers
  ADD COLUMN update_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN lockout_until TIMESTAMPTZ,
  ADD COLUMN counter_price NUMERIC(10, 2),
  ADD COLUMN counter_expires_at TIMESTAMPTZ,
  ADD COLUMN original_price NUMERIC(10, 2);

-- Capture the first-offer price for history. Populated on INSERT going forward.
UPDATE offers SET original_price = offered_price WHERE original_price IS NULL;

-- Enforce: only one active (non-terminal) offer per (buyer, listing)
CREATE UNIQUE INDEX uniq_active_offer_per_buyer_listing
  ON offers (buyer_id, listing_id)
  WHERE status NOT IN ('rejected', 'expired', 'withdrawn', 'accepted');

-- ── Chat deletion ─────────────────────────────────────────────────────────
-- Drop chat_channels table if it exists (Sprint 4 scaffold that never shipped)
DROP TABLE IF EXISTS chat_channels CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;

-- Remove chat FK from offers if it exists
ALTER TABLE offers DROP COLUMN IF EXISTS chat_channel_id;
```

### Pre-migration check (critical)

Before running this migration, confirm no business data depends on chat_channels:

```bash
# How many rows in chat_channels?
docker compose exec api psql "$DATABASE_URL" -c \
  "SELECT COUNT(*) FROM chat_channels;" 2>/dev/null || echo "Table doesn't exist — safe"

# How many offers reference a chat_channel?
docker compose exec api psql "$DATABASE_URL" -c \
  "SELECT COUNT(*) FROM offers WHERE chat_channel_id IS NOT NULL;" 2>/dev/null || \
  echo "Column doesn't exist — safe"
```

If either count > 0, STOP and escalate. Those rows represent real data that can't just be dropped.

### App code changes in same deliverable

**Delete entirely:**
- `backend/app/modules/chat/` — entire directory
- Remove `chat` router mount from `backend/app/main.py`
- Remove chat-related imports from `offers/service.py` (e.g. `open_offer_channel`)
- Remove chat-related imports from `disputes/activities.py` (e.g. `act_archive_chat_evidence`)

**Add:**
- `offers/router.py`: `POST /v1/offers/{id}/update-price` endpoint with `Body(price: Decimal)`
- `offers/service.py::update_offer_price`: increments `update_count`, rejects if already 3
- `offers/service.py::counter_offer`: sets `counter_price`, `counter_expires_at = now() + 48h`
- `offers/service.py::accept_offer`: accept either `offered_price` or `counter_price` depending on offer state
- `offers/service.py::_enforce_cooldown`: when creating offer, check if buyer has `lockout_until > now()` for this listing
- Reject hook on offer expiry/reject: set `lockout_until = now() + 7 days`

**Modify:**
- `OfferResponse` Pydantic schema adds `update_count`, `original_price`, `counter_price`, `counter_expires_at`
- Offer state machine: add `countered` state between `pending` and `accepted|rejected`

### Rollback plan

```sql
-- Offers rollback
DROP INDEX IF EXISTS uniq_active_offer_per_buyer_listing;
ALTER TABLE offers
  DROP COLUMN update_count,
  DROP COLUMN lockout_until,
  DROP COLUMN counter_price,
  DROP COLUMN counter_expires_at,
  DROP COLUMN original_price;

-- Chat rollback: data cannot be recovered — do not attempt
-- If rollback needed, restore from pre-migration backup
```

**Chat data is irrecoverable after this migration.** Take a DB snapshot before running.

### Post-migration verification

```bash
docker compose exec api psql "$DATABASE_URL" -c "\d offers" | grep -E "update_count|lockout_until|counter"
docker compose exec api psql "$DATABASE_URL" -c "\dt" | grep -i chat
# Expected: offers has 5 new columns, no chat_* tables
```

---

## Migration 0029 — Hybrid logistics (ships with Deliverable 6c)

**File:** `backend/app/db/migrations/versions/0029_hybrid_logistics.py`
**Revision:** `0029_hybrid_logistics`
**Down revision:** `0028_offer_v2`

### Schema changes

```sql
-- ── New states in transaction status enum ────────────────────────────────
-- Safely add values to the existing enum type
ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'at_hub';
ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'routed_to_fe_delivery';
ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'routed_to_courier';
ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'delivery_in_progress';
ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'delivered';

-- ── Delivery mode and fields ─────────────────────────────────────────────
-- Note: delivery_mode is a new enum type
DO $$ BEGIN
  CREATE TYPE delivery_mode AS ENUM ('fe', 'courier');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE transactions
  ADD COLUMN delivery_mode delivery_mode,
  ADD COLUMN delivery_fe_id UUID REFERENCES users(id),
  ADD COLUMN courier_name VARCHAR(64),
  ADD COLUMN courier_awb VARCHAR(64),
  ADD COLUMN courier_tracking_url TEXT,
  ADD COLUMN courier_estimated_delivery_date DATE,
  ADD COLUMN delivery_started_at TIMESTAMPTZ,
  ADD COLUMN delivered_at TIMESTAMPTZ,
  ADD COLUMN delivery_photo_id UUID REFERENCES media_files(id);

-- Index for admin hub dispatch queue
CREATE INDEX idx_transactions_at_hub
  ON transactions (status, updated_at)
  WHERE status = 'at_hub';

-- Index for FE delivery list
CREATE INDEX idx_transactions_fe_deliveries
  ON transactions (delivery_fe_id, status)
  WHERE status IN ('routed_to_fe_delivery', 'delivery_in_progress');

-- ── Drop meetup columns (if they exist from v2 implementation) ───────────
ALTER TABLE transactions DROP COLUMN IF EXISTS meetup_at;
ALTER TABLE transactions DROP COLUMN IF EXISTS meetup_confirmed_by_buyer_at;
ALTER TABLE transactions DROP COLUMN IF EXISTS meetup_confirmed_by_seller_at;
ALTER TABLE transactions DROP COLUMN IF EXISTS meetup_location;
```

### Pre-migration check (critical)

Before dropping meetup columns, confirm no transactions are in meetup states:

```bash
docker compose exec api psql "$DATABASE_URL" -c \
  "SELECT status, COUNT(*) FROM transactions WHERE meetup_at IS NOT NULL GROUP BY status;" \
  2>/dev/null || echo "Columns don't exist — safe"
```

If any transactions have non-null `meetup_at`, STOP. Manually transition them to `delivered` via admin tool before proceeding.

### App code changes in same deliverable

**Backend:**
- New workflow in `transactions/workflows.py`: `HybridLogisticsWorkflow` — manages pickup → hub → delivery branching
- New endpoints in `admin/hub.py`:
  - `GET /v1/admin/hub/transactions` — queue at `at_hub` state
  - `POST /v1/admin/transactions/{id}/route-to-fe-delivery`
  - `POST /v1/admin/transactions/{id}/route-to-courier`
  - `POST /v1/admin/transactions/{id}/update-courier-status`
- New endpoints in `field_executive/router.py`:
  - `GET /v1/fe/my-deliveries`
  - `POST /v1/fe/deliveries/{id}/complete`
- Remove all endpoints referencing meetup from any router

**Mobile (consumer):**
- Remove `MeetupScreen`, `MeetupConfirmScreen` if they exist
- Add tracking timeline component to `TransactionDetailScreen`
- Add "Confirm receipt" button, visible only when status = `delivered`

**Mobile (FE):**
- Add `MyDeliveriesScreen` alongside existing pickups screen
- Add `DeliveryHandoverScreen` — capture photo, buyer ack

**Admin:**
- Add "Hub Dispatch" tab to admin web sidebar
- Page shows transactions at `at_hub` with FE pickup photos, listing snapshot, buyer location, distance
- Two action buttons per row: "Assign to FE" (dropdown) and "Ship via courier" (form)

### Rollback plan

Enum values cannot be removed safely in Postgres without recreating the type. Rollback drops added columns but leaves enum values:

```sql
DROP INDEX IF EXISTS idx_transactions_fe_deliveries;
DROP INDEX IF EXISTS idx_transactions_at_hub;

ALTER TABLE transactions
  DROP COLUMN IF EXISTS delivery_photo_id,
  DROP COLUMN IF EXISTS delivered_at,
  DROP COLUMN IF EXISTS delivery_started_at,
  DROP COLUMN IF EXISTS courier_estimated_delivery_date,
  DROP COLUMN IF EXISTS courier_tracking_url,
  DROP COLUMN IF EXISTS courier_awb,
  DROP COLUMN IF EXISTS courier_name,
  DROP COLUMN IF EXISTS delivery_fe_id,
  DROP COLUMN IF EXISTS delivery_mode;

DROP TYPE IF EXISTS delivery_mode;

-- Enum values added are intentionally NOT removed in rollback;
-- removing requires recreating the type which is a bigger risk.
```

Meetup columns, once dropped, cannot be rolled back without recreation. Take a DB snapshot before running.

### Post-migration verification

```bash
docker compose exec api psql "$DATABASE_URL" -c "\d transactions" | grep -E "delivery_|courier_"
# Expected: 9 new columns visible

docker compose exec api psql "$DATABASE_URL" -c \
  "SELECT unnest(enum_range(NULL::transaction_status))::text AS status;" | \
  grep -E "at_hub|routed_to|delivered"
# Expected: new enum values present
```

---

## Overall migration safety rules

1. **Take a DB snapshot before each migration.** Use `docker compose exec postgres pg_dump` or RDS snapshot if deployed.
2. **Run each migration in isolation.** Do not batch 0027 + 0028 + 0029 in one apply. Ship 6a, verify, ship 6b, verify, ship 6c, verify.
3. **Mobile + backend deploy in lockstep.** Migrations 0028 and 0029 are breaking changes for old mobile clients. Users on pre-Sprint-6 app versions will see errors until they update. Force app update via minimum-version-check.
4. **Feature flag for KYC gate removal.** In Deliverable 6a, wrap the gate-removal in a feature flag (`kyc_as_badge_only: bool`). Ship flag off initially, flip on after mobile 6a also lands. This avoids mobile clients expecting the old behavior.
5. **No migrations applied during active Temporal workflows.** Before running 0029 especially, check Temporal UI for stuck workflows and let them drain or manually abort.

## Deployment order (strict)

```
Sprint 6 Day 1: Ship 6a backend → run 0027 → verify
Sprint 6 Day 2: Ship 6a mobile → flip feature flag ON → verify end-to-end
Sprint 6 Day 3: Ship 6b backend → snapshot DB → run 0028 → verify
Sprint 6 Day 4: Ship 6b mobile → force app update → verify offer v2 flow
Sprint 6 Day 5: Ship 6c backend → snapshot DB → run 0029 → verify
Sprint 6 Day 6: Ship 6c mobile + admin → verify end-to-end
Sprint 6 Day 7: End-to-end QA, admin training, post-sprint retrospective
```

## Rollback triggers

Any of these should halt the sprint and trigger rollback:

- Post-0027: ranking query regressions, listings not showing badges correctly
- Post-0028: buyers unable to create offers, existing offers corrupted
- Post-0029: pickup flow broken, FE app crashes, hub queue empty

Rollback process: revert app code commit, run the `downgrade` migration for the most recent version, force app re-update if needed.

## Data integrity checks (run after all 3 migrations)

```sql
-- No listings with incorrect verification snapshot
SELECT COUNT(*) FROM listings L
JOIN users U ON U.id = L.seller_id
WHERE L.seller_kyc_verified_at_listing_time != (U.kyc_status = 'verified');
-- Expected: rows with mismatched snapshots (which is fine for old data, but new inserts must match)

-- No offers over the update limit
SELECT COUNT(*) FROM offers WHERE update_count > 3;
-- Expected: 0

-- No transactions with both FE and courier delivery
SELECT COUNT(*) FROM transactions WHERE delivery_fe_id IS NOT NULL AND courier_awb IS NOT NULL;
-- Expected: 0

-- No transactions in meetup states (should not exist after 0029)
SELECT status, COUNT(*) FROM transactions GROUP BY 1 ORDER BY 2 DESC;
-- Expected: only Sprint 6 states — no 'meetup_*' statuses
```

If any integrity check fails, open a ticket and fix before further work.
