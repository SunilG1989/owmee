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
        # descriptive revision ids, so widen the column before any pending
        # migration tries to record a longer revision string.
        connection.exec_driver_sql("""
            DO $$
            BEGIN
                IF to_regclass('alembic_version') IS NOT NULL THEN
                    ALTER TABLE alembic_version
                    ALTER COLUMN version_num TYPE VARCHAR(255);
                END IF;
            END $$;
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
