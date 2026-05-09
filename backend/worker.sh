#!/usr/bin/env sh
set -eu

if [ "${RUN_MIGRATIONS_ON_STARTUP:-true}" = "true" ]; then
  sh /app/predeploy.sh
fi

exec python -m app.workers.main
