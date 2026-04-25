# Dev Notes

Non-obvious things about the codebase. Read before changing core modules.

## Conventions

### Async SQLAlchemy

```python
from app.db.session import DBSession

@router.get("/something")
async def get_something(db: DBSession):
    result = await db.execute(text("SELECT 1"))
    return result.scalar()
```

Don't mix sync and async session APIs.

### UUID primary keys

```python
# Models — Python default
import uuid
id: Mapped[UUID] = mapped_column(default=uuid.uuid4, primary_key=True)

# Migrations — Postgres default
sa.Column('id', UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True)
```

NOT `gen_random_uuid()`. Use `uuid_generate_v4()` from `uuid-ossp`.

### `metadata_` Python attribute

SQLAlchemy reserves `metadata` on Base. If a column is called `metadata` in DB, the Python attribute is `metadata_`:

```python
metadata_: Mapped[dict] = mapped_column("metadata", JSONB, default={})
```

Use `model.metadata_`, not `model.metadata`.

### `CurrentUser` vs DB lookup

JWT claims are exposed via `CurrentUser`. Don't query users table just to verify auth.

```python
from app.modules.identity_auth.deps import CurrentUser

@router.get("/me/x")
async def x(user: CurrentUser):
    # user.user_id, user.role, user.kyc_status, etc.
    ...
```

### TimestampMixin

```python
from app.db.session import TimestampMixin

class MyModel(Base, TimestampMixin):
    ...  # gets created_at, updated_at
```

NOT from `app.db.mixins`. From `app.db.session`.

### KYC tri-state model (Sprint 4)

| Field | Type | Meaning |
|---|---|---|
| `auth_state` | enum | `none → otp_verified → fully_verified` |
| `buyer_eligible` | bool | Has minimum verification to buy |
| `seller_tier` | enum | `lite → standard → premium` |

After ANY KYC step succeeds, call `derive_tri_state_from_kyc(user_id)` from `app.modules.kyc.tri_state`. Forgetting this is a real bug we've hit.

JWT claims include all three — they're in `CurrentUser`.

### Temporal workflow versioning

```python
@workflow.defn
class MyWorkflow:
    @workflow.run
    async def run(self):
        v = workflow.get_version("my_change", workflow.DEFAULT_VERSION, 1)
        if v == workflow.DEFAULT_VERSION:
            await old_step()
        else:
            await new_step()
```

Skipping versioning breaks in-flight customer transactions on deploy.

## Module map

| Module | What it owns |
|---|---|
| identity_auth | OTP, JWT, session, CurrentUser |
| kyc | Aadhaar OTP, PAN, liveness, payout account, tri-state |
| listings | Listing CRUD, image upload, search |
| ai_assistant | Phase 2 photo-first flow, Gemini, drafts, IMEI |
| offers | Offer/counter-offer state machine |
| transactions | Local meetup + managed shipped flows |
| payments | UPI, payment partner adapter, TDS |
| disputes | Dispute state machine, evidence preservation |
| notifications | Push + SMS fallback |
| admin | RBAC, audit log, KYC review queue |
| field_executive | FE pickup workflow |

## Gotchas we've actually hit

### `jq` boolean handling

Wrong:
```bash
jq '.field // "MISSING"'   # triggers on `false`, not just missing
```

Right:
```bash
jq 'if has("field") then (.field | tostring) else "MISSING" end'
```

### `sed -i` differences

```bash
# macOS: sed -i '' 's/old/new/' file
# Linux: sed -i 's/old/new/' file
# Cross-platform:
sed -i.bak 's/old/new/' file && rm file.bak
```

### macOS bash 3.2

`declare -A` (associative arrays) doesn't work. Use parallel indexed arrays.

### React Native debug APKs don't contain JS

JS loads from Metro at runtime. Grep the Metro bundle (`mobile/android/app/src/main/assets/index.android.bundle` after `npx react-native bundle`), not the APK.

### MinIO presigned URL hostname

Two-endpoint setup. `R2_INTERNAL_ENDPOINT` for server-side calls inside Docker, `R2_PUBLIC_ENDPOINT` baked into presigned URLs that the phone uses.

## Testing

```bash
cd backend
pytest                       # all
pytest tests/test_kyc.py     # specific file
pytest -k "test_aadhaar"     # match name
```

Mobile tests aren't set up yet. Manual testing on a real device is the current approach.
