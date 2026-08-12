import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context
from app.db.session import Base

# Import EVERY model module so Base.metadata is complete. If any are missing,
# `alembic revision --autogenerate` is blind to those tables and will propose
# spurious DROPs (or miss real drift). Keep this list in sync with the modules
# that define models (mirrors tests/conftest._preload_all_models).
import app.modules.admin.models  # noqa
import app.modules.community.models  # noqa
import app.modules.compliance.models  # noqa
import app.modules.disputes.models  # noqa
import app.modules.direct_acquisition.models  # noqa
import app.modules.field_executive.models  # noqa
import app.modules.identity_auth.models  # noqa
import app.modules.kyc.models  # noqa
import app.modules.listings.models  # noqa
import app.modules.media.models  # noqa
import app.modules.notifications.models  # noqa
import app.modules.offers.models  # noqa
import app.modules.payments.models  # noqa
import app.modules.risk.models  # noqa
import app.modules.settlement.models  # noqa
import app.modules.transactions.models  # noqa
import app.modules.verification.models  # noqa

config = context.config

sync_url = os.environ.get("SYNC_DATABASE_URL") or os.environ["DATABASE_URL"]
if "+asyncpg" in sync_url:
    sync_url = sync_url.replace("+asyncpg", "")
config.set_main_option("sqlalchemy.url", sync_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url, target_metadata=target_metadata,
        literal_binds=True, dialect_opts={"paramstyle": "named"}, compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.", poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        connection.exec_driver_sql('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
        connection.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS postgis")
        # Alembic creates version_num as VARCHAR(32) by default. Owmee uses
        # descriptive revision ids (0044_transaction_readiness_snapshots is
        # 36 chars), so the version table must be wide BEFORE any migration
        # records a long id. Two cases:
        #   1. Fresh database: pre-create the table wide, using Alembic's
        #      canonical DDL — Alembic's own ensure-version-table is
        #      checkfirst, so it leaves ours in place. Without this, a fresh
        #      `alembic upgrade head` creates VARCHAR(32), fails at 0044,
        #      and rolls back the whole run — permanently, on every retry.
        #   2. Existing database with the narrow column: widen it.
        connection.exec_driver_sql("""
            CREATE TABLE IF NOT EXISTS alembic_version (
                version_num VARCHAR(255) NOT NULL,
                CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
            )
        """)
        connection.exec_driver_sql("""
            ALTER TABLE alembic_version
            ALTER COLUMN version_num TYPE VARCHAR(255)
        """)
        connection.commit()
        context.configure(
            connection=connection, target_metadata=target_metadata, compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
        connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
