"""Small Render pre-deploy database guardrails.

This file intentionally avoids importing app settings or models. Render runs it
before Alembic, so it must only depend on raw environment variables and the DB.
"""

from __future__ import annotations

import os

import psycopg2
from alembic import command
from alembic.config import Config


_MIGRATION_LOCK_ID = 917590401


def _sync_database_url() -> str:
    raw_url = os.environ.get("SYNC_DATABASE_URL") or os.environ["DATABASE_URL"]
    return raw_url.replace("postgresql+asyncpg://", "postgresql://", 1)


def _apply_guardrails(connection) -> None:
    with connection.cursor() as cursor:
        cursor.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
        cursor.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        cursor.execute(
            """
            DO $$
            BEGIN
                IF to_regclass('public.listings') IS NOT NULL THEN
                    ALTER TABLE listings ADD COLUMN IF NOT EXISTS imei_1 VARCHAR(20);
                    ALTER TABLE listings ADD COLUMN IF NOT EXISTS imei_2 VARCHAR(20);
                END IF;
            END $$;
            """
        )


def _run_alembic() -> None:
    config = Config("alembic.ini")
    command.upgrade(config, "head")


def main() -> None:
    with psycopg2.connect(_sync_database_url()) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_lock(%s)", (_MIGRATION_LOCK_ID,))
        try:
            _apply_guardrails(connection)
            connection.commit()
            print("predeploy database guardrails applied")
            _run_alembic()
            print("database migrations are up to date")
        finally:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_unlock(%s)", (_MIGRATION_LOCK_ID,))


if __name__ == "__main__":
    main()
