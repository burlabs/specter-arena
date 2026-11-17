import asyncio
import importlib
import time
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


def _error(code: str, status: int) -> JSONResponse:
    return JSONResponse({"contractVersion": CONTRACT_VERSION, "error": code}, status_code=status)


@signed
async def roster(request: Request) -> JSONResponse:
    """Signed roster page for the UI: bindings, condition and coverage, never a slot key or Crew id.

    The revision is read before the page, so the page is at least as new as the revision and a
    reader that polls on the revision never skips a change.
    """
    runtime = request.app.state.store_runtime
    store = None if runtime.probe_on else runtime.store
    if store is None:
        return _error("store_not_ready", 503)
    # Lazy: keeps `import backend.app` free of sqlite3 and the store package.
    store_api = importlib.import_module(".store", __package__)
    view = importlib.import_module(".roster_view", __package__)
    raw_limit = request.query_params.get("limit")
    try:
        limit = store_api.clamp_limit(int(raw_limit) if raw_limit is not None else None)
    except ValueError:
        return _error("invalid_limit", 400)
    as_of_ms = int(time.time() * 1000)
    try:
        revision = await asyncio.to_thread(store_api.roster_revision, store)
        page = await asyncio.to_thread(
            store_api.roster_page,
            store,
            cursor=request.query_params.get("cursor"),
            limit=limit,
            as_of_ms=as_of_ms,
        )
    except store_api.InvalidCursor:
        return _error("invalid_cursor", 400)
    except store_api.StoreError:
        return _error("store_unavailable", 503)
    return JSONResponse(view.roster_body(page, revision, request.app.state.collector, as_of_ms))
