from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from starlette.applications import Starlette
from starlette.routing import BaseRoute, Route

# Package-relative on purpose: Crew never installs this repo, so `specter_arena` is only
# importable as `backend.specter_arena` from the repo root that uvicorn puts on sys.path.
from .specter_arena.config import probe_enabled
from .specter_arena.routes import attempts, health, ping, ready, roster
from .specter_arena.store_runtime import StoreRuntime

PROBE_ON = probe_enabled()
runtime = StoreRuntime(probe_on=PROBE_ON)


@asynccontextmanager
async def lifespan(started: Starlette) -> AsyncIterator[None]:
    store_runtime: StoreRuntime = started.state.store_runtime
    await store_runtime.open()
    started.state.collector = None
    if not store_runtime.probe_on and store_runtime.store is not None:
        # Lazy: `import backend.app` loads neither the collector nor `websockets`.
        from .specter_arena.collector.boot import boot_collector

        started.state.collector = await boot_collector(store_runtime.store)
    try:
        yield
    finally:
        if started.state.collector is not None:
            await started.state.collector.stop()
        await store_runtime.close()


routes: list[BaseRoute] = [
    Route("/health", health, methods=["GET"]),
    Route("/api/ping", ping, methods=["GET"]),
    Route("/api/ready", ready, methods=["GET"]),
    Route("/api/roster", roster, methods=["GET"]),
    Route("/api/roster/{binding_id}/attempts", attempts, methods=["GET"]),
]
if PROBE_ON:
    # Lazy: the release import graph must not contain the diagnostic-only probe package.
    from .specter_arena.probe.routes import probe_routes

    routes.extend(probe_routes())

app = Starlette(routes=routes, lifespan=lifespan)
app.state.store_runtime = runtime
app.state.collector = None
