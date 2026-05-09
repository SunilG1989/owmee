#!/usr/bin/env sh
set -eu

python -m app.db.predeploy
exec alembic upgrade head
