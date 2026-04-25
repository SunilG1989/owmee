#!/bin/bash
# Create MinIO buckets that mirror Cloudflare R2 production buckets
# Run after docker-compose up

set -e

MINIO_ALIAS="owmee_local"
MINIO_URL="http://localhost:9000"
MINIO_USER="owmee_minio_user"
MINIO_PASS="owmee_minio_password"

echo "Waiting for MinIO to be ready..."
sleep 3

# Configure mc alias
mc alias set "$MINIO_ALIAS" "$MINIO_URL" "$MINIO_USER" "$MINIO_PASS" 2>/dev/null || true

# Create buckets
for bucket in owmee-media owmee-evidence owmee-exports; do
  if mc ls "$MINIO_ALIAS/$bucket" >/dev/null 2>&1; then
    echo "Bucket $bucket already exists — skipping."
  else
    mc mb "$MINIO_ALIAS/$bucket"
    echo "Created bucket: $bucket"
  fi
done

# Make owmee-media public (CDN-served listing images)
mc anonymous set download "$MINIO_ALIAS/owmee-media"
echo "owmee-media set to public download."

echo ""
echo "Buckets ready. MinIO console: http://localhost:9001"
echo "  User: owmee_minio_user"
echo "  Pass: owmee_minio_password"
