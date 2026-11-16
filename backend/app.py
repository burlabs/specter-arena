from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from starlette.applications import Starlette
from starlette.routing import BaseRoute, Route

# Package-relative on purpose: Crew never installs this repo, so `specter_arena` is only
# importable as `backend.specter_arena` from the repo root that uvicorn puts on sys.path.
from .specter_arena.config import probe_enabled
from .specter_arena.routes import health, ping, ready
from .specter_arena.store_runtime import StoreRuntime

PROBE_ON = probe_enabled()
runtime = StoreRuntime(probe_on=PROBE_ON)


@asynccontextmanager
async def lifespan(started: Starlette) -> AsyncIterator[None]:
    store_runtime: StoreRuntime = started.state.store_runtime
    await store_runtime.open()
    try:
        yield
    finally:
        await store_runtime.close()


routes: list[BaseRoute] = [
    Route("/health", health, methods=["GET"]),
    Route("/api/ping", ping, methods=["GET"]),
    Route("/api/ready", ready, methods=["GET"]),
]
if PROBE_ON:
    # Lazy: the release import graph must not contain the diagnostic-only probe package.
    from .specter_arena.probe.routes import probe_routes

    routes.extend(probe_routes())

app = Starlette(routes=routes, lifespan=lifespan)
app.state.store_runtime = runtime
