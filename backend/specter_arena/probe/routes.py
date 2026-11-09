# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import asyncio
import importlib
import json
import re
import secrets
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import BaseRoute, Route

from ..config import gateway_env
from ..proxy_auth import Handler, signed
from .matrix import (
    CREDENTIALS,
    InvalidEvidence,
    Run,
    annotate,
    to_host_facts_json,
    to_matrix_json,
)
from .questions import question_ids
from .snapshot import build_snapshot
from .steps import (
    GatewayPort,
    StepContext,
    UnknownStep,
    run_steps,
    select_steps,
)

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

MAX_BODY_BYTES = 64 * 1024
SLUG_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
DEFAULT_OUT_DIR = Path(__file__).resolve().parents[3] / ".probe-out"

PortFactory = Callable[[], GatewayPort]


class LiveDriverUnavailable(RuntimeError):
    """The live gateway driver is not importable in this install."""


class RunInProgress(RuntimeError):
    pass


class BadRequest(ValueError):
    def __init__(self, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.status = status


def default_port_factory() -> GatewayPort:
    try:
        live = importlib.import_module(".live", __package__)
    except ImportError as error:
        raise LiveDriverUnavailable from error
    return cast(GatewayPort, live.LiveGateway(gateway_env()))


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _new_run(probe_slug: str = "") -> Run:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return Run(run_id=f"{stamp}-{secrets.token_hex(3)}", started_at=_now(), probe_slug=probe_slug)


class ProbeService:
    """One probe run held in memory, driven through a `GatewayPort` the caller supplies."""

    def __init__(
        self,
        port_factory: PortFactory = default_port_factory,
        *,
        out_dir: Path | None = DEFAULT_OUT_DIR,
        gateway_available: Callable[[], bool] | None = None,
        capture_seconds: float = 30.0,
    ) -> None:
        self._port_factory = port_factory
        self._out_dir = out_dir
        self._gateway_available = gateway_available or (lambda: bool(gateway_env().origin))
        self._capture_seconds = capture_seconds
        self._task: asyncio.Task[None] | None = None
        self._write_denied = False
        self.status = "idle"
        self.error: str | None = None
        self.other_app = "specter-other"
        self.cli_slot_key = ""
        self.grants_declared = True
        self.run = self._fresh_run()

    def _fresh_run(self, probe_slug: str = "") -> Run:
        run = _new_run(probe_slug)
        run.frame_sink = self._write_frame
        return run

    def _write_frame(self, frame: dict[str, object]) -> None:
        if self._out_dir is None or self._write_denied:
            return
        try:
            folder = self._out_dir / self.run.run_id
            folder.mkdir(parents=True, exist_ok=True)
            with (folder / "frames.jsonl").open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(frame) + "\n")
        except OSError:
            self._write_denied = True

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def state(self) -> dict[str, object]:
        return {
            "runId": self.run.run_id,
            "status": self.status,
            "error": self.error,
            "probeSlug": self.run.probe_slug,
            "grantsDeclared": self.grants_declared,
            "decidedCells": len(self.run.cells),
            "droppedFrames": self.run.stats.dropped,
            "bufferedFrames": len(self.run.frames),
            "evidenceFile": (
                "off" if self._out_dir is None else "denied" if self._write_denied else "writing"
            ),
            "steps": [step.id for step in select_steps(None)],
        }

    def configure(self, body: dict[str, object]) -> None:
        if self.running:
            raise RunInProgress
        slug = body.get("probeSlug")
        if not isinstance(slug, str) or (slug and not SLUG_PATTERN.fullmatch(slug)):
            raise BadRequest("probeSlug must be a short slug string")
        for name in ("otherApp", "cliSlotKey"):
            if name in body and not isinstance(body[name], str):
                raise BadRequest(f"{name} must be a string")
        if "grantsDeclared" in body and not isinstance(body["grantsDeclared"], bool):
            raise BadRequest("grantsDeclared must be a boolean")
        other_app = body.get("otherApp", self.other_app)
        if not isinstance(other_app, str) or (other_app and not SLUG_PATTERN.fullmatch(other_app)):
            raise BadRequest("otherApp must be a short slug string")
        self.run.probe_slug = slug
        self.other_app = other_app or self.other_app
        self.cli_slot_key = cast(str, body.get("cliSlotKey", self.cli_slot_key))
        self.grants_declared = cast(bool, body.get("grantsDeclared", self.grants_declared))

    def start(self, step_ids: list[str] | None) -> str:
        if self.running:
            raise RunInProgress
        select_steps(step_ids)
        port = self._port_factory()
        ctx = StepContext(
            run=self.run,
            now=_now,
            grants_declared=self.grants_declared,
            gateway_available=self._gateway_available(),
            other_app=self.other_app,
            cli_slot_key=self.cli_slot_key,
            capture_seconds=self._capture_seconds,
        )
        self.status = "running"
        self.error = None
        self._task = asyncio.get_running_loop().create_task(self._execute(port, ctx, step_ids))
        return self.run.run_id

    async def _execute(
        self, port: GatewayPort, ctx: StepContext, step_ids: list[str] | None
    ) -> None:
        try:
            await run_steps(port, ctx, step_ids)
            self.status = "done"
        except Exception as error:
            self.status = "failed"
            self.error = type(error).__name__

    async def wait(self) -> None:
        if self._task is not None:
            await self._task

    def annotate(self, body: dict[str, object]) -> None:
        cell_id, state, note, credential = (
            body.get("cellId"),
            body.get("state"),
            body.get("note"),
            body.get("credential"),
        )
        if not (isinstance(cell_id, str) and isinstance(state, str) and isinstance(note, str)):
            raise BadRequest("cellId, state and note must be strings")
        if credential not in CREDENTIALS:
            raise BadRequest("credential must be OWNER-SESSION or APP-TOKEN")
        if cell_id not in question_ids():
            raise BadRequest(f"unknown cell {cell_id}")
        try:
            annotate(self.run, cell_id, state, note, credential, at=_now())
        except InvalidEvidence as error:
            raise BadRequest(str(error)) from error

    def snapshot(self) -> dict[str, object]:
        return build_snapshot(self.run)

    def export(self) -> dict[str, object]:
        return {
            "snapshot": self.snapshot(),
            "matrix": to_matrix_json(self.run),
            "hostFacts": to_host_facts_json(self.run),
        }


SERVICE = ProbeService()


def capped(handler: Handler) -> Handler:
    """Refuse a declared body over the cap before anything reads it."""

    async def wrapper(request: Request) -> Response:
        try:
            declared = int(request.headers.get("content-length", "0"))
        except ValueError:
            declared = 0
        if declared > MAX_BODY_BYTES:
            return JSONResponse({"error": "body_too_large"}, status_code=413)
        return await handler(request)

    return wrapper


async def _json_object(request: Request, *, optional: bool = False) -> dict[str, object]:
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise BadRequest("body too large", 413)
    if optional and not raw:
        return {}
    if not request.headers.get("content-type", "").startswith("application/json"):
        raise BadRequest("content type must be application/json", 415)
    try:
        parsed = json.loads(raw)
    except ValueError as error:
        raise BadRequest("body is not valid JSON") from error
    if not isinstance(parsed, dict):
        raise BadRequest("body must be a JSON object")
    return parsed


def _error(error: BadRequest) -> JSONResponse:
    return JSONResponse({"error": str(error)}, status_code=error.status)


def probe_routes(service: ProbeService | None = None) -> list[BaseRoute]:
    """The dev-only `/api/probe/*` routes. Every one requires the gateway signature."""
    svc = service or SERVICE

    async def state(_request: Request) -> Response:
        return JSONResponse(svc.state())

    async def config(request: Request) -> Response:
        try:
            svc.configure(await _json_object(request))
        except BadRequest as error:
            return _error(error)
        except RunInProgress:
            return JSONResponse({"error": "run_in_progress"}, status_code=409)
        return Response(status_code=204)

    async def run(request: Request) -> Response:
        try:
            body = await _json_object(request, optional=True)
            steps = body.get("steps")
            if steps is not None and not (
                isinstance(steps, list) and all(isinstance(item, str) for item in steps)
            ):
                raise BadRequest("steps must be a list of step ids")
            run_id = svc.start(cast("list[str] | None", steps))
        except BadRequest as error:
            return _error(error)
        except UnknownStep as error:
            return JSONResponse({"error": f"unknown step {error.args[0]}"}, status_code=422)
        except RunInProgress:
            return JSONResponse({"error": "run_in_progress"}, status_code=409)
        except LiveDriverUnavailable:
            return JSONResponse({"error": "live_driver_unavailable"}, status_code=503)
        return JSONResponse({"runId": run_id}, status_code=202)

    async def annotate_cell(request: Request) -> Response:
        try:
            svc.annotate(await _json_object(request))
        except BadRequest as error:
            return _error(error)
        return Response(status_code=204)

    async def snapshot(_request: Request) -> Response:
        return JSONResponse(svc.snapshot())

    async def export(_request: Request) -> Response:
        return JSONResponse(svc.export())

    def guarded(handler: Handler) -> Handler:
        return capped(signed(handler))

    return [
        Route("/api/probe/state", guarded(state), methods=["GET"]),
        Route("/api/probe/config", guarded(config), methods=["POST"]),
        Route("/api/probe/run", guarded(run), methods=["POST"]),
        Route("/api/probe/annotate", guarded(annotate_cell), methods=["POST"]),
        Route("/api/probe/snapshot", guarded(snapshot), methods=["GET"]),
        Route("/api/probe/export", guarded(export), methods=["GET"]),
    ]
