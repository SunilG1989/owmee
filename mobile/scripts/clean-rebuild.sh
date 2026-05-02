#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Owmee mobile — clean rebuild
#
# Nuke-from-orbit cache clean + rebuild for the RN dev loop. Use when:
#   • You changed Tailwind/tokens and the colors aren't reflecting
#   • A dependency was bumped and Metro is serving stale bytes
#   • The Android build is doing weird things and `gradlew clean`
#     alone isn't enough
#
# Run from anywhere; the script cd's into mobile/ on its own.
# Stops any running Metro before clearing caches so they can't be
# re-populated mid-clean.
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { echo; echo "▶  $1"; }

step "1. Stopping Metro / RN servers if running"
pkill -f 'react-native start' 2>/dev/null && echo "   killed react-native start" || echo "   (none running)"
pkill -f 'node.*metro' 2>/dev/null && echo "   killed metro process" || true
# Anything bound to 8081 (Metro's default port)
PORT_PID="$(lsof -ti :8081 2>/dev/null || true)"
if [[ -n "$PORT_PID" ]]; then
  echo "   killing PID $PORT_PID on :8081"
  kill -9 "$PORT_PID" 2>/dev/null || true
fi

step "2. Clearing watchman state"
if command -v watchman >/dev/null; then
  watchman watch-del-all >/dev/null 2>&1 && echo "   watchman watch-del-all OK"
  watchman shutdown-server >/dev/null 2>&1 || true
else
  echo "   (watchman not installed — skipping)"
fi

step "3. Removing Metro / Haste caches in TMPDIR"
TMPDIR_REAL="${TMPDIR:-/tmp}"
rm -rf "$TMPDIR_REAL"/metro-* \
       "$TMPDIR_REAL"/react-* \
       "$TMPDIR_REAL"/haste-map-* \
       "$TMPDIR_REAL"/react-native-packager-cache-* \
       "$TMPDIR_REAL"/metro-bundler-cache-* 2>/dev/null || true
echo "   cleared $TMPDIR_REAL/{metro,react,haste,react-native-packager}-* caches"

step "4. Removing local node_modules cache (.cache only — not node_modules itself)"
rm -rf node_modules/.cache 2>/dev/null || true
echo "   cleared node_modules/.cache"

step "5. Android: gradle clean + wipe build dirs"
if [[ -d android ]]; then
  cd android
  ./gradlew --quiet clean 2>&1 | tail -3 || true
  cd ..
  rm -rf android/app/build android/build android/.gradle 2>/dev/null || true
  echo "   gradle clean done; build dirs wiped"
else
  echo "   (no android/ dir — skipping)"
fi

step "6. iOS: pod cache (only if iOS dir + Pods present)"
if [[ -d ios/Pods ]]; then
  cd ios
  rm -rf Pods build "$HOME/Library/Developer/Xcode/DerivedData/Owmee-*" 2>/dev/null || true
  cd ..
  echo "   wiped ios/Pods, ios/build, Xcode DerivedData"
else
  echo "   (no ios/Pods — skipping iOS clean)"
fi

step "7. Done. Next: start Metro fresh + run android"
echo
echo "   Run these in two terminals:"
echo "   "
echo "   # terminal 1 — Metro with reset cache"
echo "   cd $ROOT && npx react-native start --reset-cache"
echo "   "
echo "   # terminal 2 — install + run on device/emulator"
echo "   cd $ROOT && npx react-native run-android"
echo
echo "   (or for iOS, after running 'cd ios && pod install':"
echo "   npx react-native run-ios)"
