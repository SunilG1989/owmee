#!/usr/bin/env bash
# Owmee — daily dev startup
set -e

if [ -t 1 ]; then
    G=$'\033[32m' Y=$'\033[33m' BOLD=$'\033[1m' RESET=$'\033[0m'
else
    G= Y= BOLD= RESET=
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "${BOLD}── Starting Owmee dev stack ──${RESET}"

[ -f .env ] || { echo "${Y}!${RESET} No .env — run ./scripts/setup.sh first"; exit 1; }

docker compose up -d

echo -n "  Waiting for API"
for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/openapi.json > /dev/null 2>&1; then
        echo " ${G}✓${RESET}"
        break
    fi
    echo -n "."
    sleep 1
done

if [[ "$OSTYPE" == "darwin"* ]]; then
    LAN_IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
else
    LAN_IP=$(hostname -I | awk '{print $1}')
fi

echo ""
echo "${BOLD}Service status:${RESET}"
docker compose ps --format "table {{.Service}}\t{{.Status}}" | tail -n +2

echo ""
echo "${BOLD}URLs:${RESET}"
echo "  API docs:  http://localhost:8000/docs"
echo "  MinIO UI:  http://localhost:9001"
echo "  Temporal:  http://localhost:8088"

if [ -f mobile/src/config.ts ] && [ -n "$LAN_IP" ]; then
    if ! grep -q "$LAN_IP" mobile/src/config.ts; then
        echo ""
        echo "${Y}!${RESET} mobile/src/config.ts has stale LAN IP. Current: $LAN_IP"
    fi
fi

R429=$(docker compose logs --tail=200 api 2>&1 | grep -c "429 RESOURCE_EXHAUSTED" || true)
if [ "$R429" -gt 0 ]; then
    echo ""
    echo "${Y}!${RESET} Recent Gemini 429 errors detected. API quota may be exhausted."
    echo "  See docs/TROUBLESHOOTING.md → 'No data fetched'"
fi

echo ""
echo "${BOLD}Common commands:${RESET}"
echo "  docker compose logs -f api                          # tail backend logs"
echo "  cd mobile && npx react-native run-android           # build app"
echo "  curl -X POST http://localhost:8000/v1/dev/kyc-approve/+919876543210"
echo "  docker compose down                                 # stop everything"
