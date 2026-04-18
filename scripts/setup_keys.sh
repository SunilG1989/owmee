#!/bin/bash
# Generate RSA-2048 key pair for JWT RS256 signing
# Run once before first docker-compose up

set -e

KEYS_DIR="$(dirname "$0")/../keys"
mkdir -p "$KEYS_DIR"

if [ -f "$KEYS_DIR/private.pem" ]; then
  echo "Keys already exist at $KEYS_DIR — skipping generation."
  echo "Delete them manually if you want to rotate."
  exit 0
fi

echo "Generating RSA-2048 key pair..."
openssl genrsa -out "$KEYS_DIR/private.pem" 2048
openssl rsa -in "$KEYS_DIR/private.pem" -pubout -out "$KEYS_DIR/public.pem"
chmod 600 "$KEYS_DIR/private.pem"
chmod 644 "$KEYS_DIR/public.pem"

echo "Done. Keys written to $KEYS_DIR/"
echo ""
echo "  private.pem — keep secret, never commit, never log"
echo "  public.pem  — safe to share, used for JWT verification"
echo ""
echo "For production (Railway): set JWT_PRIVATE_KEY and JWT_PUBLIC_KEY"
echo "as environment variables containing the key file contents."
