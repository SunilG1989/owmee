#!/usr/bin/env bash
# Owmee — automated dev setup
set -e

if [ -t 1 ]; then
    G=$'\033[32m' R=$'\033[31m' Y=$'\033[33m' B=$'\033[34m' BOLD=$'\033[1m' RESET=$'\033[0m'
else
    G= R= Y= B= BOLD= RESET=
fi

ok()   { echo "  ${G}✓${RESET} $1"; }
warn() { echo "  ${Y}!${RESET} $1"; }
fail() { echo "  ${R}✗${RESET} $1" >&2; exit 1; }
info() { echo "  ${B}·${RESET} $1"; }
hdr()  { echo ""; echo "${BOLD}── $1 ──${RESET}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "${BOLD}════════════════════════════════════════════════════════════"
echo "  Owmee — Automated Setup"
echo "════════════════════════════════════════════════════════════${RESET}"

hdr "Checking prerequisites"
MISSING=0
for cmd in docker node npm; do
    if command -v "$cmd" > /dev/null 2>&1; then
        ok "$cmd present"
    else
        warn "$cmd NOT found — install per docs/SETUP.md"
        MISSING=$((MISSING+1))
    fi
done

if docker compose version > /dev/null 2>&1; then
    ok "docker compose plugin present"
else
    warn "docker compose NOT available"
    MISSING=$((MISSING+1))
fi

if command -v java > /dev/null 2>&1; then
    JV=$(java -version 2>&1 | head -1)
    if echo "$JV" | grep -q "17\."; then
        ok "java 17 present"
    else
        warn "java is not 17.x ($JV) — RN 0.73 requires JDK 17"
    fi
else
    warn "java NOT found — needed only for Android builds"
fi

[ "$MISSING" -gt 0 ] && fail "Install missing prerequisites and re-run."

if ! docker info > /dev/null 2>&1; then
    fail "Docker daemon is not running. Start Docker Desktop."
fi
ok "Docker daemon running"

hdr ".env file"
if [ -f .env ]; then
    ok ".env exists — leaving alone"
else
    [ -f .env.example ] || fail ".env.example not found"
    cp .env.example .env
    ok "Created .env from template"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        LAN_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
    else
        LAN_IP=$(hostname -I | awk '{print $1}')
    fi
    if [ -n "$LAN_IP" ]; then
        sed -i.bak "s|YOUR_LAN_IP|$LAN_IP|g" .env && rm -f .env.bak
        ok "Set LAN IP to $LAN_IP"
    else
        warn "Could not detect LAN IP — edit .env manually"
    fi

    echo ""
    warn "IMPORTANT: edit .env and set GEMINI_API_KEY"
    warn "Get a free key at https://aistudio.google.com/apikey"
fi

if grep -q "GEMINI_API_KEY=YOUR_GEMINI_API_KEY\|^GEMINI_API_KEY=$" .env; then
    warn "GEMINI_API_KEY not set — AI features will fail"
    read -p "  Continue without Gemini key? [y/N] " yn
    [[ "$yn" =~ ^[Yy] ]] || exit 1
fi

hdr "Starting Docker stack"
docker compose up -d
info "Waiting for API..."
for i in $(seq 1 60); do
    if curl -sf http://localhost:8000/openapi.json > /dev/null 2>&1; then
        ok "API up at http://localhost:8000 (took ${i}s)"
        break
    fi
    sleep 1
    [ "$i" = "60" ] && { docker compose logs --tail=30 api; fail "API didn't start"; }
done

hdr "Migrations"
docker compose exec -T api alembic upgrade head 2>&1 | tail -3
ok "Migrations applied"

hdr "Seed data"
docker compose exec -T api python -m app.modules.admin.seed 2>&1 | tail -3 || warn "Seed had issues — non-fatal"

hdr "Mobile dependencies"
if [ -d mobile ]; then
    cd mobile
    if [ -d node_modules ]; then
        ok "node_modules present (skipping install)"
    else
        info "Running npm install (takes 2-5 min)..."
        npm install 2>&1 | tail -5
        ok "Mobile dependencies installed"
    fi

    if [ -n "$LAN_IP" ] && [ -f src/config.ts ]; then
        sed -i.bak "s|OVERRIDE_URL = '[^']*'|OVERRIDE_URL = 'http://${LAN_IP}:8000'|" src/config.ts
        rm -f src/config.ts.bak
        ok "Updated mobile/src/config.ts to use $LAN_IP"
    fi
    cd "$ROOT"
fi

echo ""
echo "${G}${BOLD}═══════════════════════════════════════════════════════════"
echo "  Setup complete."
echo "═══════════════════════════════════════════════════════════${RESET}"
echo ""
echo "${BOLD}Backend:${RESET}  http://localhost:8000/docs"
echo "${BOLD}MinIO:${RESET}    http://localhost:9001"
echo "${BOLD}Temporal:${RESET} http://localhost:8088"
echo ""
echo "${BOLD}Next:${RESET}"
echo "  cd mobile"
echo "  adb devices                       # confirm device connected"
echo "  npx react-native run-android      # build + install"
echo ""
echo "${BOLD}Daily workflow:${RESET}"
echo "  ./scripts/dev.sh                  # start backend"
echo "  docker compose down               # stop"
