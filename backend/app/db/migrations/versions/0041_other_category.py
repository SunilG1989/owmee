"""Add fallback Other listing category.

Why
---
AI-assisted listing should never fail just because the product does not
fit Owmee's launch taxonomy. Unknown or unsupported products now land in
an explicit "Other" category, while richer category-specific flows stay
available for phones, laptops, tablets, appliances, and kids utility.

Revision ID: 0041_other_category
Revises: 0040_listing_lifecycle
Create Date: 2026-05-16
"""
from alembic import op


revision = "0041_other_category"
down_revision = "0040_listing_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO categories (
            id, name, slug, shipping_eligible, local_eligible,
            imei_required, sort_order, is_active
        )
        VALUES (
            uuid_generate_v4(), 'Other', 'others', false, true,
            false, 99, true
        )
        ON CONFLICT (slug) DO UPDATE
        SET
            name = EXCLUDED.name,
            shipping_eligible = EXCLUDED.shipping_eligible,
            local_eligible = EXCLUDED.local_eligible,
            imei_required = EXCLUDED.imei_required,
            sort_order = EXCLUDED.sort_order,
            is_active = true
    """)


def downgrade() -> None:
    op.execute("DELETE FROM categories WHERE slug = 'others'")
