# Owmee — Backend

Trust-first C2C resale platform for India.

## Stack

| Layer | Local dev | Production |
|-------|-----------|------------|
| API | FastAPI (Docker) | Railway |
| Database | Postgres + PostGIS (Docker) | Supabase |
| Cache | Redis (Docker) | Upstash |
| Workflows | Temporal (Docker) | Temporal Cloud |
| Storage | MinIO (Docker) | Cloudflare R2 |
| CI/CD | — | GitHub Actions |

## Quick start

```bash
# 1. Clone and enter
git clone https://github.com/your-org/owmee
cd owmee

# 2. Install Docker Desktop if not already installed
# https://docs.docker.com/desktop/

# 3. Run the bootstrap script (does everything)
bash scripts/dev_setup.sh
```

That's it. The script:
- Generates RS256 JWT key pair
- Copies `.env.example` → `.env`
- Starts all Docker services
- Runs Alembic migrations
- Creates R2-compatible MinIO buckets

## Services after setup

| Service | URL |
|---------|-----|
| API | http://localhost:8000 |
| Swagger docs | http://localhost:8000/docs |
| Temporal UI | http://localhost:8080 |
| MinIO console | http://localhost:9001 |
| Postgres | localhost:5432 |

## Manual commands

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View API logs
docker compose logs -f api

# View worker logs
docker compose logs -f worker

# Run migrations
docker compose exec api alembic upgrade head

# Create a new migration
docker compose exec api alembic revision --autogenerate -m "description"

# Open a Postgres shell
docker compose exec postgres psql -U owmee -d owmee

# Open an API shell
docker compose exec api python
```

## Project structure

```
owmee/
├── docker-compose.yml
├── .env.example
├── keys/                   # JWT keys — never commit
├── scripts/
│   ├── dev_setup.sh        # one-command bootstrap
│   ├── setup_keys.sh       # RSA key generation
│   ├── create_buckets.sh   # MinIO bucket setup
│   ├── init_db.sql         # Postgres extensions
│   └── temporal_dynamic_config.yaml
└── backend/
    ├── Dockerfile.dev
    ├── Dockerfile
    ├── requirements.txt
    ├── alembic.ini
    └── app/
        ├── main.py             # FastAPI app factory
        ├── core/
        │   ├── settings.py     # pydantic-settings
        │   ├── dependencies.py # tier guards, DB session
        │   ├── jwt.py          # RS256 sign/verify
        │   ├── redis.py        # Redis singleton
        │   └── storage.py      # Cloudflare R2 client
        ├── db/
        │   ├── session.py      # SQLAlchemy engine + Base
        │   └── migrations/     # Alembic
        ├── modules/
        │   ├── identity_auth/  # Epic 1 — OTP, JWT, sessions
        │   ├── kyc/            # Epic 2 — Aadhaar, PAN, liveness
        │   ├── listings/       # Epic 3 — listings, images
        │   ├── offers/         # Epic 4 — offers, reservations
        │   ├── transactions/   # Epic 5 — local transactions
        │   ├── payments/       # Razorpay PA integration
        │   ├── chat/           # Stream chat adapter
        │   ├── disputes/       # Dispute workflow
        │   ├── risk/           # Trust score, fraud signals
        │   ├── notifications/  # SMS, push
        │   ├── admin/          # Admin console APIs
        │   └── compliance/     # TDS, GST, DPDP
        └── workers/
            └── main.py         # Temporal worker entrypoint
```

## Tier model

| Tier | How | What |
|------|-----|------|
| Guest | No login | Browse only |
| Basic | Mobile OTP | Browse + chat + wishlist + listing drafts |
| Verified | OTP + Aadhaar + PAN + liveness + payout | Full transacting |

## Environment variables

All variables are documented in `.env.example`.
Copy to `.env` and fill in real values for KYC partner, Razorpay, and SMS.

## Production deployment (Railway)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and init
railway login
railway init

# Set environment variables
railway variables set DATABASE_URL=...
railway variables set REDIS_URL=...
railway variables set TEMPORAL_HOST=...
railway variables set R2_ENDPOINT=...
# (set all variables from .env.example)

# Deploy
railway up
```

## Phase 1 exit gate checklist

- [ ] All Epic 1 stories (OWM-101–110) pass acceptance criteria
- [ ] All Epic 2 stories (OWM-201–212) pass acceptance criteria
- [ ] RBAC test matrix (13 cases) all pass in CI
- [ ] Aadhaar audit query returns zero rows on staging DB
- [ ] KYC gate middleware returns correct 403 for all tier × endpoint combinations
- [ ] Post-KYC action resume works end-to-end
- [ ] JWT `tier` claim present and correct for all test users
- [ ] No KYC prompt shown at signup — user reaches home feed after mobile OTP only
- [ ] CA sign-off on TDS questions T1–T6
- [ ] Legal sign-off on Aadhaar-derived field allowlist
- [ ] DLT registration initiated
