from starlette.requests import Request
from starlette.responses import JSONResponse


async def health(_request: Request) -> JSONResponse:
    """Liveness probe for the Crew health check: unauthenticated, no redirect, always 200."""
    return JSONResponse({"status": "ok"}, status_code=200)
