#!/bin/bash
# Owmee dev environment bootstrap
# Usage: ./scripts/dev_setup.sh

set -e
ROOT="$(dirname "$0")/.."
cd "$ROOT"

echo "========================================"
echo "  Owmee — dev environment setup"
echo "========================================"
echo ""

# 1. Generate JWT keys
echo "[1/5] Generating JWT keys..."
bash scripts/setup_keys.sh

# 2. Copy .env if not present
echo "[2/5] Setting up .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  .env created from .env.example — edit as needed."
else
  echo "  .env already exists — skipping."
fi

# Detect docker compose command (v2 plugin vs v1 standalone)
if docker compose version > /dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose > /dev/null 2>&1; then
  DC="docker-compose"
else
  echo "ERROR: docker compose not found."
  exit 1
fi
echo "  Using: $DC"

# 3. Docker Compose up (detached)
echo "[3/5] Starting Docker services..."
$DC up -d --build

# 4. Wait for Postgres
echo "[4/5] Waiting for Postgres to be healthy..."
until $DC exec postgres pg_isready -U owmee -d owmee > /dev/null 2>&1; do
  sleep 1
done
echo "  Postgres ready."

# 5. Create MinIO buckets
echo "[5/5] Creating R2-compatible buckets..."
if command -v mc > /dev/null 2>&1; then
  bash scripts/create_buckets.sh
else
  echo "  mc not found — skipping. Install with: brew install minio/stable/mc"
fi

# 6. Run Alembic migrations
echo ""
echo "[6/6] Running database migrations..."
$DC exec api alembic upgrade head

echo ""
echo "========================================"
echo "  Owmee dev environment is running!"
echo ""
echo "  API:          http://localhost:8000"
echo "  API docs:     http://localhost:8000/docs"
echo "  Temporal UI:  http://localhost:8080"
echo "  MinIO:        http://localhost:9001"
echo "  Postgres:     localhost:5432  db=owmee"
echo "========================================"
