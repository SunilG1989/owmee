#!/usr/bin/env sh
set -eu

if [ "${RUN_MIGRATIONS_ON_STARTUP:-true}" = "true" ]; then
  sh /app/predeploy.sh
fi

exec uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-2}"
