from starlette.applications import Starlette
from starlette.routing import BaseRoute, Route

# Package-relative on purpose: Crew never installs this repo, so `specter_arena` is only
# importable as `backend.specter_arena` from the repo root that uvicorn puts on sys.path.
from .specter_arena.config import probe_enabled
from .specter_arena.routes import health, ping

routes: list[BaseRoute] = [
    Route("/health", health, methods=["GET"]),
    Route("/api/ping", ping, methods=["GET"]),
]
if probe_enabled():
    # Lazy: the release import graph must not contain the diagnostic-only probe package.
    from .specter_arena.probe.routes import probe_routes

    routes.extend(probe_routes())

app = Starlette(routes=routes)
