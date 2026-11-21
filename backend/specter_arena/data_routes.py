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
    return importlib.import_module(".lifecycle.service", __package__)


def _pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
    keys = [key for key, _ in items]
    if len(set(keys)) != len(keys):
        raise ValueError("duplicate key")
    return dict(items)


def _constant(literal: str) -> Any:
    raise ValueError(literal)


async def _body(request: Request) -> Any:
    return json.loads(await request.body(), object_pairs_hook=_pairs, parse_constant=_constant)


async def _call(request: Request, method: str, *args: Any, body: bool = True) -> Response:
    service = getattr(request.app.state, "lifecycle", None)
    if service is None:
        return _error("store_not_ready", 503)
    try:
        payload = [await _body(request)] if body else []
    except (ValueError, RecursionError):
        return _error("invalid_body", 400)
    domain = _domain()
    try:
        result = await getattr(service, method)(*args, *payload)
    except domain.DataError as error:
        return _error(error.code, error.status)
    return JSONResponse(result, headers=NOSNIFF)


@signed
async def get_data(request: Request) -> Response:
    return await _call(request, "status", body=False)


@capped
@signed
async def post_retention(request: Request) -> Response:
    return await _call(request, "set_retention")


@capped
@signed
async def post_purge(request: Request) -> Response:
    return await _call(request, "purge")


@capped
@signed
async def post_export(request: Request) -> Response:
    return await _call(request, "export")


@capped
@signed
async def post_asset_cleanup(request: Request) -> Response:
    return await _call(request, "asset_cleanup")


@capped
@signed
async def post_collector(request: Request) -> Response:
    return await _call(request, "set_collector", getattr(request.app.state, "collector", None))


def data_routes() -> list[BaseRoute]:
    return [
        Route("/api/data", get_data, methods=["GET"]),
        Route("/api/data/retention", post_retention, methods=["POST"]),
        Route("/api/data/purge", post_purge, methods=["POST"]),
        Route("/api/data/export", post_export, methods=["POST"]),
        Route("/api/data/asset-cleanup", post_asset_cleanup, methods=["POST"]),
        Route("/api/collector", post_collector, methods=["POST"]),
    ]
