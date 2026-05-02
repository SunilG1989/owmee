#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Owmee design-system drift lint
#
# Fails if a file outside the allow-list (lint-design.allow.txt)
# introduces drift. As Phase 2/3 migrations land, files are removed
# from the allow-list — once empty, the lint becomes a permanent
# gate that prevents future drift.
#
# Drift signals checked:
#   1. <TouchableOpacity in screens — should use <Button> / <IconButton>
#   2. fontSize: <number> literals in screens — should use T.size.*
#   3. hex literals in screens — should pull from C.* / theme tokens
#
# Run locally:  pnpm lint:design   (or: bash scripts/lint-design.sh)
# CI:           same script, exit non-zero on new drift.
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALLOW="$ROOT/scripts/lint-design.allow.txt"
TMP_OFFENDERS="$(mktemp)"
TMP_NEW="$(mktemp)"
trap 'rm -f "$TMP_OFFENDERS" "$TMP_NEW"' EXIT

# Only check live source — skip backups, generated dirs.
SCREEN_DIRS=("$ROOT/src/screens")
COMPONENT_DIRS=("$ROOT/src/components")
# Files that ARE the design system — they legitimately use raw RN
# primitives + token-driven fontSize values; we don't lint them.
EXCLUDE_REGEX='\.(bak|v4)\.(tsx|ts)$|/components/ui/|/utils/tokens\.ts$'

# Patterns to flag (extended-regex)
TO_PATTERN='<TouchableOpacity'
FS_PATTERN='fontSize:[[:space:]]*[0-9]'
HEX_PATTERN='#[0-9a-fA-F]{6}'

# Gather offending files into a sorted, unique list.
{
  for dir in "${SCREEN_DIRS[@]}" "${COMPONENT_DIRS[@]}"; do
    grep -rlE "$TO_PATTERN" "$dir" --include='*.tsx' 2>/dev/null || true
    grep -rlE "$FS_PATTERN" "$dir" --include='*.tsx' 2>/dev/null || true
    grep -rlE "$HEX_PATTERN" "$dir" --include='*.tsx' 2>/dev/null || true
  done
} | grep -vE "$EXCLUDE_REGEX" | sed "s|^$ROOT/||" | sort -u > "$TMP_OFFENDERS"

# Compare against allow-list; flag any new offenders.
if [[ -f "$ALLOW" ]]; then
  comm -23 "$TMP_OFFENDERS" <(grep -vE '^\s*#|^\s*$' "$ALLOW" | sort -u) > "$TMP_NEW"
else
  cp "$TMP_OFFENDERS" "$TMP_NEW"
fi

NEW_COUNT="$(wc -l < "$TMP_NEW" | tr -d ' ')"
TOTAL_COUNT="$(wc -l < "$TMP_OFFENDERS" | tr -d ' ')"
ALLOW_COUNT="$([[ -f "$ALLOW" ]] && grep -cvE '^\s*#|^\s*$' "$ALLOW" || echo 0)"

echo "design-lint: ${TOTAL_COUNT} drifting files (${ALLOW_COUNT} on allow-list, ${NEW_COUNT} NEW)"

if [[ "$NEW_COUNT" -gt 0 ]]; then
  echo
  echo "✘ Design-system drift introduced in files NOT on the allow-list:"
  echo
  while IFS= read -r f; do
    echo "  • $f"
  done < "$TMP_NEW"
  echo
  echo "Use the shared primitives instead:"
  echo "  <TouchableOpacity>      → <Button> or <IconButton> from components/ui"
  echo "  fontSize: 14            → fontSize: T.size.base  (from utils/tokens)"
  echo "  '#1E5F5C'               → C.petrol               (from utils/tokens)"
  echo
  echo "If this drift is genuinely unavoidable, add the file path to:"
  echo "  $ALLOW"
  echo "(but please open a follow-up to migrate it.)"
  exit 1
fi

echo "design-lint: OK"
