from __future__ import annotations

import importlib
import json
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import BaseRoute, Route

from .proxy_auth import CONTRACT_VERSION, signed
from .specter_routes import NOSNIFF, capped


def _error(code: str, status: int) -> JSONResponse:
    body = {"contractVersion": CONTRACT_VERSION, "error": code}
    return JSONResponse(body, status_code=status, headers=NOSNIFF)


def _domain() -> Any:
    return importlib.import_module(".work.service", __package__)


async def _call(request: Request, method: str, *args: Any, **kwargs: Any) -> Response:
    service = getattr(request.app.state, "work", None)
    if service is None:
        return _error("store_not_ready", 503)
    domain = _domain()
    try:
        result = await getattr(service, method)(*args, **kwargs)
    except domain.WorkError as error:
        return _error(error.code, error.status)
    status, body = result if method == "create_work" else (200, result)
    return JSONResponse(body, status_code=status, headers=NOSNIFF)


def _pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
    keys = [key for key, _ in items]
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate key")
    return dict(items)


def _constant(literal: str) -> Any:
    raise ValueError(literal)


async def _post(request: Request, method: str, *args: Any) -> Response:
    try:
        body = json.loads(await request.body(), object_pairs_hook=_pairs, parse_constant=_constant)
    except (ValueError, RecursionError):
        return _error("invalid_body", 400)
    return await _call(request, method, *args, body)


def _p(request: Request, name: str) -> str:
    return str(request.path_params[name])


@signed
async def list_work(request: Request) -> Response:
    query = request.query_params
    extra = {name: query[name] for name in ("view", "order") if name in query}
    return await _call(
        request,
        "list_work",
        state=query.get("state"),
        binding_id=query.get("bindingId"),
        cursor=query.get("cursor"),
        limit=query.get("limit"),
        **extra,
    )


@capped
@signed
async def create_work(request: Request) -> Response:
    return await _post(request, "create_work")


@signed
async def get_work(request: Request) -> Response:
    return await _call(request, "get_work", _p(request, "work_id"))


@capped
@signed
async def link_attempt(request: Request) -> Response:
    return await _post(request, "link_attempt", _p(request, "work_id"))


@capped
@signed
async def set_milestone(request: Request) -> Response:
    return await _post(request, "set_milestone", _p(request, "work_id"))


@capped
@signed
async def decide(request: Request) -> Response:
    return await _post(request, "decide", _p(request, "work_id"))


@signed
async def list_tasks(request: Request) -> Response:
    query = request.query_params
    return await _call(
        request,
        "list_tasks",
        state=query.get("state"),
        binding_id=query.get("bindingId"),
        cursor=query.get("cursor"),
        limit=query.get("limit"),
    )


@signed
async def get_task(request: Request) -> Response:
    return await _call(request, "get_task", _p(request, "task_id"))


@signed
async def get_xp(request: Request) -> Response:
    query = request.query_params
    if "view" not in query:
        return await _call(request, "xp_summaries")
    return await _call(
        request,
        "xp_summaries",
        view=query["view"],
        cursor=query.get("cursor"),
        limit=query.get("limit"),
    )


@signed
async def get_xp_history(request: Request) -> Response:
    query = request.query_params
    return await _call(
        request,
        "xp_history",
        _p(request, "binding_id"),
        cursor=query.get("cursor"),
        limit=query.get("limit"),
    )


def work_routes() -> list[BaseRoute]:
    return [
        Route("/api/work", list_work, methods=["GET"]),
        Route("/api/work", create_work, methods=["POST"]),
        Route("/api/work/{work_id}", get_work, methods=["GET"]),
        Route("/api/work/{work_id}/attempts", link_attempt, methods=["POST"]),
        Route("/api/work/{work_id}/milestones", set_milestone, methods=["POST"]),
        Route("/api/work/{work_id}/decisions", decide, methods=["POST"]),
        Route("/api/tasks", list_tasks, methods=["GET"]),
        Route("/api/tasks/{task_id}", get_task, methods=["GET"]),
        Route("/api/xp", get_xp, methods=["GET"]),
        Route("/api/roster/{binding_id}/xp", get_xp_history, methods=["GET"]),
    ]
