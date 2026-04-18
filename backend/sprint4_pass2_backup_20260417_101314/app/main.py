from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse

from app.core.settings import settings
from app.core.redis import get_redis, close_redis
from app.db.session import engine

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("owmee.startup", env=settings.env)
    await get_redis()
    yield
    await close_redis()
    await engine.dispose()
    logger.info("owmee.shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Owmee API",
        version="0.1.0",
        description="Owmee — trust-first C2C resale platform for India",
        default_response_class=ORJSONResponse,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.modules.identity_auth.router import router as auth_router
    from app.modules.kyc.router import router as kyc_router
    from app.modules.listings.router import router as listings_router
    from app.modules.offers.router import router as offers_router
    from app.modules.transactions.shipped import router as shipped_router
    from app.modules.compliance.router import router as compliance_router
    from app.modules.admin.kyc_queue import router as admin_kyc_router
    from app.modules.admin.listings_queue import router as admin_listings_router
    from app.modules.admin.reports_disputes import router as reports_router
    from app.modules.admin.seed import router as seed_router
    # ── Sprint 4 / v3 ─────────────────────────────────────────────────────
    from app.modules.seller_tier.router import router as seller_tier_router

    app.include_router(auth_router, prefix="/v1/auth", tags=["auth"])
    app.include_router(kyc_router, prefix="/v1/kyc", tags=["kyc"])
    app.include_router(listings_router, prefix="/v1/listings", tags=["listings"])
    app.include_router(offers_router, prefix="/v1", tags=["offers"])
    app.include_router(shipped_router, prefix="/v1", tags=["shipped"])
    app.include_router(compliance_router, prefix="/v1", tags=["compliance"])
    app.include_router(reports_router, prefix="/v1", tags=["reports-disputes"])
    app.include_router(seed_router, prefix="/v1", tags=["admin-seed"])
    app.include_router(admin_kyc_router, prefix="/v1/admin/kyc", tags=["admin-kyc"])
    app.include_router(admin_listings_router, prefix="/v1/admin/listings", tags=["admin-listings"])
    # ── Sprint 4 / v3 ─────────────────────────────────────────────────────
    app.include_router(seller_tier_router, prefix="/v1/sellers/me", tags=["seller-tier"])

    @app.get("/health", include_in_schema=False)
    async def health():
        return {"status": "ok", "env": settings.env}

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.error("unhandled_exception", path=request.url.path, error=str(exc))
        return ORJSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "INTERNAL_ERROR", "message": "Something went wrong. Please try again."},
        )

    return app


app = create_app()
