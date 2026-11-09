from datetime import UTC, datetime

from starlette.requests import Request
from starlette.responses import JSONResponse

from .proxy_auth import signed


async def health(_request: Request) -> JSONResponse:
    """Liveness probe for the Crew health check: unauthenticated, no redirect, always 200."""
    return JSONResponse({"status": "ok"}, status_code=200)


@signed
async def ping(_request: Request) -> JSONResponse:
    """Gateway-signed round-trip check. Reveals nothing about the caller or the secret."""
    return JSONResponse({"ok": True, "app": "specter-arena", "at": datetime.now(UTC).isoformat()})
