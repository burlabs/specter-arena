from datetime import UTC, datetime

from starlette.requests import Request
from starlette.responses import JSONResponse

from .proxy_auth import CONTRACT_VERSION, signed


async def health(_request: Request) -> JSONResponse:
    """Liveness probe for the Crew health check: unauthenticated, no redirect, always 200."""
    return JSONResponse({"status": "ok"}, status_code=200)


@signed
async def ping(_request: Request) -> JSONResponse:
    """Gateway-signed round-trip check. Reveals nothing about the caller or the secret."""
    return JSONResponse({"ok": True, "app": "specter-arena", "at": datetime.now(UTC).isoformat()})


# Under the probe switch the store package is never imported, so this body is built from literals.
PROBE_READY_BODY = {
    "contractVersion": CONTRACT_VERSION,
    "status": "not-ready",
    "store": "disabled",
    "storeVersion": None,
    "latestVersion": None,
}


@signed
async def ready(request: Request) -> JSONResponse:
    """Signed readiness: the store state and schema versions only, never a path or error text.
    Separate from `/health`, so a store fault can never trip Crew's health-restart loop."""
    runtime = request.app.state.store_runtime
    if runtime.probe_on:
        return JSONResponse(PROBE_READY_BODY, status_code=503)
    status = await runtime.refresh()
    is_ready = status.state == "ready"
    body = {
        "contractVersion": CONTRACT_VERSION,
        "status": "ready" if is_ready else "not-ready",
        "store": status.state,
        "storeVersion": status.store_version,
        "latestVersion": status.latest_version,
    }
    return JSONResponse(body, status_code=200 if is_ready else 503)
