from starlette.applications import Starlette
from starlette.routing import Route

# Package-relative on purpose: Crew never installs this repo, so `specter_arena` is only
# importable as `backend.specter_arena` from the repo root that uvicorn puts on sys.path.
from .specter_arena.routes import health, ping

app = Starlette(
    routes=[
        Route("/health", health, methods=["GET"]),
        Route("/api/ping", ping, methods=["GET"]),
    ]
)
