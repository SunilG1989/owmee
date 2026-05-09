from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, DateTime, text
from datetime import datetime, timezone


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """Create the app engine lazily so Alembic can import models without app secrets."""
    global _engine
    if _engine is None:
        from app.core.settings import settings

        _engine = create_async_engine(
            settings.async_database_url,
            echo=settings.env == "development",
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            pool_pre_ping=True,
            pool_recycle=settings.db_pool_recycle_seconds,
        )
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
            autocommit=False,
        )
    return _sessionmaker


class _AsyncSessionLocalProxy:
    def __call__(self, *args, **kwargs) -> AsyncSession:
        return get_sessionmaker()(*args, **kwargs)


class _EngineProxy:
    def __getattr__(self, name: str):
        return getattr(get_engine(), name)

    async def dispose(self) -> None:
        await get_engine().dispose()


# Keep existing import sites working while avoiding settings validation at import time.
engine = _EngineProxy()
AsyncSessionLocal = _AsyncSessionLocalProxy()


# ── Base model ─────────────────────────────────────────────────────────────────
class Base(DeclarativeBase):
    pass


class TimestampMixin:
    """Adds created_at and updated_at to any model."""

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=lambda: datetime.now(timezone.utc),
    )


# ── Dependency ─────────────────────────────────────────────────────────────────
async def get_db() -> AsyncSession:
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
