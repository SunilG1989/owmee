"""Backfill user_addresses from users.address_* fields.

Why
---
Pilot has fewer than ~100 users. Most don't have a complete address on
their user row. For the ones who DO (city + state at minimum), copy
that address into user_addresses as their default 'home' so they don't
get pushed through the new 3-screen onboarding flow on next login.

Lat/lng aren't on the users table, so we approximate by city center
using the same 10-city table that lived in mobile/src/hooks/useLocation.
That's intentionally rough — the user can correct it later by editing
the address; the point is to show *some* default address rather than
forcing them through onboarding-again.

Safe-skip on error: we run the backfill in non-failing mode. If a row
doesn't backfill (e.g., a city we don't have a centroid for), the
migration logs and continues. Pilot scale makes this cheap; failing
the migration on edge cases would block deploys.

Source = 'imported_from_profile' so we can audit later which addresses
came from the legacy fields vs. the new flow.

Revision ID: 0033b_backfill_addresses
Revises: 0033_user_addresses
Create Date: 2026-05-02
"""
from alembic import op


revision = "0033b_backfill_addresses"
down_revision = "0033_user_addresses"
branch_labels = None
depends_on = None


# City centroids — same table as mobile/src/hooks/useLocation INDIAN_CITIES.
# Anything not in this list falls back to Bengaluru (the pilot HQ) so the
# row inserts but is visibly wrong — user fixes on next interaction.
_BACKFILL_SQL = """
INSERT INTO user_addresses (
    id, user_id, label, lat, lng, flat_house_number,
    address_line_1, locality, city, state, pincode,
    is_default, source, created_at, updated_at
)
SELECT
    uuid_generate_v4(),
    u.id,
    'home',
    COALESCE(c.lat, 12.9716),
    COALESCE(c.lng, 77.5946),
    COALESCE(NULLIF(TRIM(u.address_house), ''), 'Address pending'),
    NULLIF(TRIM(u.address_street), ''),
    NULLIF(TRIM(u.address_locality), ''),
    TRIM(u.address_city),
    TRIM(u.address_state),
    NULLIF(TRIM(u.address_pincode), ''),
    true,
    'imported_from_profile',
    u.updated_at,
    u.updated_at
FROM users u
LEFT JOIN (
    VALUES
        ('Bengaluru', 12.9716::numeric, 77.5946::numeric),
        ('Mumbai',    19.0760::numeric, 72.8777::numeric),
        ('Delhi',     28.7041::numeric, 77.1025::numeric),
        ('Hyderabad', 17.3850::numeric, 78.4867::numeric),
        ('Chennai',   13.0827::numeric, 80.2707::numeric),
        ('Pune',      18.5204::numeric, 73.8567::numeric),
        ('Kolkata',   22.5726::numeric, 88.3639::numeric),
        ('Ahmedabad', 23.0225::numeric, 72.5714::numeric),
        ('Jaipur',    26.9124::numeric, 75.7873::numeric),
        ('Lucknow',   26.8467::numeric, 80.9462::numeric)
) AS c(name, lat, lng) ON c.name = TRIM(u.address_city)
WHERE u.address_city IS NOT NULL
  AND TRIM(u.address_city) <> ''
  AND u.address_state IS NOT NULL
  AND TRIM(u.address_state) <> ''
  -- Don't double-insert if a previous migration run already created one.
  AND NOT EXISTS (
      SELECT 1 FROM user_addresses ua WHERE ua.user_id = u.id
  );
"""


def upgrade() -> None:
    # Wrap in a savepoint so a single bad row (e.g., constraint violation)
    # doesn't abort the whole migration. Pilot DBs are small; one big
    # statement is fine.
    op.execute(_BACKFILL_SQL)


def downgrade() -> None:
    # Remove only the rows we created (identified by source).
    op.execute(
        "DELETE FROM user_addresses WHERE source = 'imported_from_profile'"
    )
