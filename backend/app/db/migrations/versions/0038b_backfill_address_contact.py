r"""Backfill user_addresses.full_name + phone_number from the parent user.

Why
---
0038 added the columns NULLABLE so the schema migration is non-destructive.
But the FE checkout (CheckoutScreen) blocks Pay when name/phone are missing
on the delivery address — surfacing a red "Add recipient name" / "Add a
contact number" error. Existing pilot users hit that wall on the first
purchase after deploy.

Backfill rules:
- Copy users.name into user_addresses.full_name where address has none.
  If users.name is NULL too, leave the address NULL — the user will be
  prompted to set it on next address-edit.
- Copy users.phone_number into user_addresses.phone_number, stripping any
  leading '+91' or '91' so the column matches the FE format
  (bare 10-digit Indian number, /^[6-9]\d{9}$/). Keep phone NULL if the
  parent user phone doesn't fit the expected shape.
- Only touch rows where the field is NULL — never overwrite an explicit
  per-address recipient (gift deliveries, alternate contacts).

Idempotent: re-running is safe because of the IS NULL guard.

Revision ID: 0038b_backfill_address_contact
Revises: 0038_p0_p1_trust_floor
Create Date: 2026-05-03
"""
from alembic import op


revision = "0038b_backfill_address_contact"
down_revision = "0038_p0_p1_trust_floor"
branch_labels = None
depends_on = None


_BACKFILL_NAME = """
UPDATE user_addresses ua
SET full_name = u.name
FROM users u
WHERE ua.user_id = u.id
  AND ua.full_name IS NULL
  AND u.name IS NOT NULL
  AND TRIM(u.name) <> '';
"""


# Strip leading '+91' or '91' (with optional separators), normalize, then
# accept only valid Indian mobile numbers — the same /^[6-9]\d{9}$/ shape
# the FE enforces. The regex is conservative so a malformed parent phone
# silently leaves the address phone NULL rather than poisoning it.
_BACKFILL_PHONE = """
UPDATE user_addresses ua
SET phone_number = SUBSTRING(REGEXP_REPLACE(u.phone_number, '\\D', '', 'g') FROM '[6-9]\\d{9}$')
FROM users u
WHERE ua.user_id = u.id
  AND ua.phone_number IS NULL
  AND u.phone_number IS NOT NULL
  AND SUBSTRING(REGEXP_REPLACE(u.phone_number, '\\D', '', 'g') FROM '[6-9]\\d{9}$') IS NOT NULL;
"""


def upgrade() -> None:
    op.execute(_BACKFILL_NAME)
    op.execute(_BACKFILL_PHONE)


def downgrade() -> None:
    # No reverse — we don't track which rows we touched. The columns
    # themselves are dropped by 0038's downgrade; if you need to undo
    # only this backfill, set both fields to NULL via a one-off SQL.
    pass
