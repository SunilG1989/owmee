import uuid
from sqlalchemy import Column, DateTime, ForeignKey, Integer, SmallInteger, Numeric, String, Text, Boolean, text
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY, TSVECTOR
from geoalchemy2 import Geography
from sqlalchemy.orm import relationship
from app.db.session import Base, TimestampMixin


class Category(Base, TimestampMixin):
    __tablename__ = "categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(100), nullable=False, unique=True)
    slug = Column(String(100), nullable=False, unique=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    imei_required = Column(Boolean, nullable=False, default=False)
    shipping_eligible = Column(Boolean, nullable=False, default=False)
    local_eligible = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)

    listings = relationship("Listing", back_populates="category")


class Listing(Base, TimestampMixin):
    __tablename__ = "listings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    seller_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id = Column(UUID(as_uuid=True), ForeignKey("categories.id"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text)
    price = Column(Numeric(10, 2), nullable=False)
    condition = Column(String(20), nullable=False)
    status = Column(String(30), nullable=False, default="draft")
    moderation_status = Column(String(30), nullable=False, default="pending")
    moderation_flag = Column(String(100))
    image_urls = Column(ARRAY(String), nullable=False, default=list)
    thumbnail_url = Column(String(500))
    imei_hash = Column(String(128))
    # Sprint 8 AI-assisted flow. Raw IMEIs are captured for CEIR checks and
    # seller ops, but public serializers expose only verification state.
    imei_1 = Column(String(20))
    imei_2 = Column(String(20))
    verification_status = Column(String(20))
    listing_state = Column(String(32))
    video_url = Column(String(500))
    ai_draft_id = Column(UUID(as_uuid=True), nullable=True)
    ml_price_suggestion = Column(Numeric(10, 2))
    ml_price_range_low = Column(Numeric(10, 2))
    ml_price_range_high = Column(Numeric(10, 2))
    geo_point = Column(Geography(geometry_type="POINT", srid=4326))
    locality = Column(String(200))
    city = Column(String(100))
    state = Column(String(100))
    expires_at = Column(DateTime(timezone=True))
    published_at = Column(DateTime(timezone=True))
    view_count = Column(Integer, nullable=False, default=0)
    search_vector = Column(TSVECTOR, nullable=True)

    # Sprint 2: Product detail columns (category-specific)
    brand = Column(String(100))
    model = Column(String(200))
    storage = Column(String(20))           # e.g. "128GB"
    ram = Column(String(20))               # e.g. "8GB"
    color = Column(String(50))
    processor = Column(String(100))        # laptops
    screen_size = Column(String(20))       # e.g. "15.6 inch"
    purchase_year = Column(Integer)
    screen_condition = Column(String(30))  # flawless | minor_scratches | cracked
    body_condition = Column(String(30))    # flawless | minor_dents | major_damage
    defects = Column(JSONB)                # ["dead_pixels", "speaker_issue"]
    original_price = Column(Numeric(12, 2))
    serial_number = Column(String(50))

    # ── UI v3 fields ──────────────────────────────────────────────────────────
    accessories = Column(String(300))        # "Box, charger, warranty card"
    warranty_info = Column(String(200))      # "4 months left", "No warranty", "Under warranty"
    battery_health = Column(SmallInteger)    # 0–100, phones and laptops only
    age_suitability = Column(String(50))     # "3–6 years", null if not kids
    hygiene_status = Column(String(50))      # "Cleaned", "Sanitised", "Not cleaned"
    is_kids_item = Column(Boolean, nullable=False, default=False)
    is_negotiable = Column(Boolean, nullable=False, default=True)  # Indian bargaining culture — default open
    # Sprint 6a: snapshot seller KYC state at listing creation
    seller_kyc_verified_at_listing_time = Column(
        Boolean, nullable=False, server_default='false', default=False
    )

    # ── Sprint 4 / Pass 2: FE-assisted listings ──────────────────────────────
    listing_source = Column(String(32), nullable=False, default="self_prep")
    # self_prep | fe_assisted
    fe_visit_id = Column(
        UUID(as_uuid=True),
        ForeignKey("fe_visits.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Concierge Phase 4: clearer-named pointer used by the timeline view.
    # Backfilled from fe_visit_id by migration 0036; new submit-listing
    # writes both columns so legacy code that still reads fe_visit_id
    # keeps working.
    created_via_fe_visit_id = Column(
        UUID(as_uuid=True),
        ForeignKey("fe_visits.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_by = Column(String(32), nullable=False, default="none")
    # none | fe | ops | fe_and_ops
    ops_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    ops_reviewer_id = Column(UUID(as_uuid=True), nullable=True)

    # ── Sprint 7 / Phase 1: community scoping ─────────────────────────────────
    community_id = Column(
        UUID(as_uuid=True),
        ForeignKey("communities.id", ondelete="SET NULL"),
        nullable=True,
    )

    # ── Sprint 4 / Pass 3: kids safety checklist ─────────────────────────────
    # JSONB of { item_key: bool }. Canonical keys (see docs/QA_CHECKLIST.md):
    #   cleaned, no_small_parts, no_loose_batteries, no_sharp_edges,
    #   original_packaging, working_condition, no_recalled_model, age_label_correct
    kids_safety_checklist = Column(JSONB, nullable=True)

    # ── P1 (2026-05-03): listing-quality floor for re-commerce trust ─────────
    # Structured "what's in the box" — replaces free-text accessories for
    # phones/laptops/appliances where charger and bill are top return-causes.
    has_box = Column(Boolean, nullable=True)
    has_bill = Column(Boolean, nullable=True)
    has_charger = Column(Boolean, nullable=True)
    has_earphones = Column(Boolean, nullable=True)
    # Hidden reserve floor for negotiable listings; offers below auto-decline
    # so seller isn't pinged for spam ₹1 lowballs. Buyer never sees the value.
    min_acceptable_price = Column(Numeric(10, 2), nullable=True)
    # Cashify-floor disclosures — required to publish electronics, see
    # CreateListingScreen.tsx submit guard.
    water_damage_history = Column(Boolean, nullable=True)
    seller_functional_attestation = Column(Boolean, nullable=True)
    # Immutable AI-review lineage captured when an AI draft becomes a listing:
    # AI detected values, seller-edited values, MRP source, photo choices.
    seller_review_snapshot = Column(JSONB, nullable=True)

    # ── Seller lifecycle (migration 0040) ─────────────────────────────────────
    # Soft-delete metadata. status='removed' is the canonical "gone" signal;
    # these two columns add structured analytics + a wall-clock timestamp
    # distinct from updated_at so the publish/remove trail stays intact.
    deletion_reason = Column(String(50), nullable=True)
    # 'sold_elsewhere' | 'changed_mind' | 'wrong_price' | 'no_buyers' |
    # 'item_damaged' | 'other'
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    category = relationship("Category", back_populates="listings")
    images = relationship("ListingImage", back_populates="listing", cascade="all, delete-orphan")
    snapshots = relationship("ListingSnapshot", back_populates="listing")


class ListingImage(Base, TimestampMixin):
    __tablename__ = "listing_images"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(UUID(as_uuid=True), ForeignKey("listings.id", ondelete="CASCADE"), nullable=False, index=True)
    r2_key = Column(String(500), nullable=False)
    r2_key_thumb = Column(String(500))
    r2_key_medium = Column(String(500))
    sort_order = Column(Integer, nullable=False, default=0)
    is_primary = Column(Boolean, nullable=False, default=False)
    uploaded_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    moderation_status = Column(String(20), nullable=False, default="pending")

    listing = relationship("Listing", back_populates="images")


class ListingSnapshot(Base):
    __tablename__ = "listing_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    listing_id = Column(UUID(as_uuid=True), ForeignKey("listings.id"), nullable=False, index=True)
    reservation_id = Column(UUID(as_uuid=True), nullable=False, unique=True, index=True)
    snapshot_data = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    listing = relationship("Listing", back_populates="snapshots")
