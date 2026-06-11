"""Schema-drift gate: every index the ORM models declare must exist in the DB.

This catches the "phantom index" class — a column marked `index=True` (or an
`Index(...)` in `__table_args__`) that the hand-written migration never actually
created. Those silently cause sequential scans on hot paths and are invisible
until production is slow. The audit found 7 such phantoms; this test fails loudly
on the next one. Runs in CI against the migrated test database.
"""
import pytest
from sqlalchemy import create_engine, inspect

from app.core.settings import settings
from app.db.session import Base


def _db_index_names(insp, table_name: str) -> set[str]:
    names: set[str] = set()
    try:
        names |= {ix["name"] for ix in insp.get_indexes(table_name) if ix.get("name")}
    except Exception:
        pass
    # Unique constraints back their uniqueness with an index but are reported
    # separately by the inspector.
    try:
        names |= {u["name"] for u in insp.get_unique_constraints(table_name) if u.get("name")}
    except Exception:
        pass
    return names


def test_every_declared_index_exists_in_db():
    engine = create_engine(settings.sync_db_url)
    try:
        insp = inspect(engine)
        db_tables = set(insp.get_table_names())
        missing: list[str] = []
        for table in Base.metadata.tables.values():
            declared = {ix.name for ix in table.indexes if ix.name}
            if not declared:
                continue
            if table.name not in db_tables:
                missing.append(f"{table.name}: table missing from DB")
                continue
            existing = _db_index_names(insp, table.name)
            for name in sorted(declared):
                if name not in existing:
                    missing.append(f"{table.name}.{name}")
    finally:
        engine.dispose()

    assert not missing, (
        "Phantom indexes — declared on the models but missing from the database "
        "(schema drift). Either add a migration to CREATE them, or remove the "
        "model declaration:\n  " + "\n  ".join(missing)
    )
