#!/usr/bin/env sh
set -eu

exec python -m app.db.predeploy
