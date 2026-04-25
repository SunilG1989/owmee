# Owmee

Trust-first C2C resale platform for India. Photo-first listing flow powered by Gemini Vision. Built with React Native + FastAPI.

## What this is

Take photos of something to sell. AI fills in brand, model, condition, and price. You confirm and list. For phones, scan the IMEI for theft protection. Buyers transact through escrow with KYC verified at the gate.

## Stack

- Mobile: React Native 0.73 + TypeScript
- Backend: FastAPI + Python 3.12
- Database: PostgreSQL 15 + PostGIS
- Cache: Redis 7
- Workflows: Temporal
- Object store: MinIO (dev), Cloudflare R2 (prod)
- AI: Google Gemini (Vision + Text)
- Infra: Docker Compose

## Quick start

```bash
git clone https://github.com/<your-username>/owmee.git
cd owmee
./scripts/setup.sh
```

Setup takes 15-20 minutes (most of it is npm install and gradle).

For step-by-step details, read [docs/SETUP.md](docs/SETUP.md).

## Prerequisites

- macOS or Linux (Windows works via WSL2 but untested)
- Docker Desktop (4GB+ allocated)
- Node.js 18+ and npm
- Java JDK 17 (RN 0.73 requires this exact version)
- Android Studio with SDK 33+ (for mobile builds)
- A Gemini API key — get a free one at https://aistudio.google.com/apikey

For installation commands, see [docs/SETUP.md](docs/SETUP.md).

## Repo layout

```
owmee/
├── backend/        FastAPI app, migrations, tests
├── mobile/         React Native app
├── docs/           setup, architecture, troubleshooting
├── scripts/        dev automation
├── docker-compose.yml
└── .env.example    copy to .env, fill in your values
```

## Daily dev

After setup, start the backend stack:

```bash
./scripts/dev.sh
```

To stop:

```bash
docker compose down
```

## Things to know before changing core code

- Postgres is the source of truth. Partner systems (KYC vendors, payment aggregator) are external sources for verification events.
- UUID primary keys use `uuid.uuid4()` as Python defaults; migrations use `uuid_generate_v4()` (NOT `gen_random_uuid()`).
- Async SQLAlchemy via `AsyncSession` — get the session from the `DBSession` type alias.
- `metadata_` is the Python attribute name mapped to the `metadata` column.
- `CurrentUser` is built from JWT claims, not DB rows.
- `TimestampMixin` is imported from `app.db.session`.

More in [docs/DEV_NOTES.md](docs/DEV_NOTES.md).

## Troubleshooting

If something's not working, [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) covers the issues we've actually hit — Docker port conflicts, MinIO presigned URL hostname, Metro cache, Java version, IP changes, Gemini API quota.

## License

[Your choice]
