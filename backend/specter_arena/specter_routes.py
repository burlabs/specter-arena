from __future__ import annotations

import asyncio
import functools
import importlib
import json
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import BaseRoute, Route

from .proxy_auth import CONTRACT_VERSION, signed

MAX_BODY_BYTES = 1_572_864
NOSNIFF = {"X-Content-Type-Options": "nosniff"}
_ASSETS_PATH = "/api/assets"
UNKNOWN_SCENE_ASSET = "unknown_scene_asset"
Handler = Callable[[Request], Awaitable[Response]]


def _error(code: str, status: int) -> JSONResponse:
    body = {"contractVersion": CONTRACT_VERSION, "error": code}
    return JSONResponse(body, status_code=status, headers=NOSNIFF)


def capped(handler: Handler) -> Handler:
    """Refuse an oversized or unsized body before `@signed` reads it."""

    @functools.wraps(handler)
    async def wrapper(request: Request) -> Response:
        too_big = "asset_too_large" if request.url.path == _ASSETS_PATH else "body_too_large"
        raw = request.headers.get("content-length", "")
        if not raw.isdigit() or int(raw) > MAX_BODY_BYTES:
            return _error(too_big, 413)
        return await handler(request)

    return wrapper


def _domain() -> Any:
    return importlib.import_module(".specters.service", __package__)


async def _call(request: Request, method: str, *args: Any, status: int = 200) -> Response:
    service = getattr(request.app.state, "specters", None)
    if service is None:
        return _error("store_not_ready", 503)
    domain = _domain()
    try:
        result = await getattr(service, method)(*args)
    except domain.SpecterError as error:
        return _error(error.code, error.status)
    if method == "start_summoning":
        status, result = result
    return JSONResponse(result, status_code=status, headers=NOSNIFF)


async def _object(
    request: Request, allowed: frozenset[str], required: frozenset[str]
) -> dict[str, Any] | None:
    try:
        body = json.loads(await request.body())
    except ValueError:
        return None
    if not isinstance(body, dict) or not required <= set(body) <= allowed:
        return None
    return body


def _p(request: Request, name: str) -> str:
    return str(request.path_params[name])


@signed
async def list_specters(request: Request) -> Response:
    return await _call(request, "list_specters")


@signed
async def get_specter(request: Request) -> Response:
    return await _call(request, "get_specter", _p(request, "binding_id"))


@capped
@signed
async def start_summoning(request: Request) -> Response:
    try:
        body: object = json.loads(await request.body())
    except ValueError:
        return _error("invalid_body", 400)
    return await _call(request, "start_summoning", _p(request, "binding_id"), body)


@signed
async def get_summoning(request: Request) -> Response:
    return await _call(request, "get_summoning", _p(request, "request_id"))


@capped
@signed
async def cancel_summoning(request: Request) -> Response:
    if await _object(request, frozenset(), frozenset()) is None:
        return _error("invalid_body", 400)
    return await _call(request, "cancel_summoning", _p(request, "request_id"))


@capped
@signed
async def accept(request: Request) -> Response:
    keys = frozenset({"expectedVersion"})
    body = await _object(request, keys, keys)
    if body is None:
        return _error("invalid_body", 400)
    return await _call(request, "accept", _p(request, "request_id"), body["expectedVersion"])


@capped
@signed
async def save_manual(request: Request) -> Response:
    keys = frozenset({"expectedVersion", "profile"})
    body = await _object(request, keys, keys)
    if body is None:
        return _error("invalid_body", 400)
    return await _call(
        request, "save_manual", _p(request, "binding_id"), body["expectedVersion"], body["profile"]
    )


@capped
@signed
async def rename(request: Request) -> Response:
    body = await _object(
        request,
        frozenset({"expectedVersion", "name", "epithet"}),
        frozenset({"expectedVersion", "name"}),
    )
    if body is None:
        return _error("invalid_body", 400)
    return await _call(
        request,
        "rename",
        _p(request, "binding_id"),
        body["expectedVersion"],
        body["name"],
        body.get("epithet", _domain().UNSET),
    )


@capped
@signed
async def set_portrait(request: Request) -> Response:
    keys = frozenset({"expectedVersion", "assetId"})
    body = await _object(request, keys, keys)
    if body is None:
        return _error("invalid_body", 400)
    return await _call(
        request, "set_portrait", _p(request, "binding_id"), body["expectedVersion"], body["assetId"]
    )


@capped
@signed
async def archive(request: Request) -> Response:
    keys = frozenset({"expectedVersion"})
    body = await _object(request, keys, keys)
    if body is None:
        return _error("invalid_body", 400)
    return await _call(request, "archive", _p(request, "binding_id"), body["expectedVersion"])


@signed
async def list_portraits(request: Request) -> Response:
    return await _call(request, "list_portraits")


@capped
@signed
async def upload_asset(request: Request) -> Response:
    try:
        body: object = json.loads(await request.body())
    except ValueError:
        return _error("invalid_body", 400)
    return await _call(request, "upload_asset", body, status=201)


@signed
async def get_asset(request: Request) -> Response:
    return await _call(request, "get_asset", _p(request, "asset_id"))


def _scene_art() -> Any:
    return importlib.import_module(".specters.scene_art", __package__)


@signed
async def get_scene_asset(request: Request) -> Response:
    """A bundled scene raster as `scene-asset.v1`. Static bytes: no store, no service, no write."""
    key = _p(request, "key")
    body = await asyncio.to_thread(_scene_art().get_scene_asset, key)
    if body is None:
        return _error(UNKNOWN_SCENE_ASSET, 404)
    return JSONResponse(body, headers=NOSNIFF)


def specter_routes() -> list[BaseRoute]:
    return [
        Route("/api/specters", list_specters, methods=["GET"]),
        Route("/api/specters/{binding_id}", get_specter, methods=["GET"]),
        Route("/api/specters/{binding_id}/summonings", start_summoning, methods=["POST"]),
        Route("/api/specters/{binding_id}/manual", save_manual, methods=["POST"]),
        Route("/api/specters/{binding_id}/name", rename, methods=["POST"]),
        Route("/api/specters/{binding_id}/portrait", set_portrait, methods=["POST"]),
        Route("/api/specters/{binding_id}/archive", archive, methods=["POST"]),
        Route("/api/summonings/{request_id}", get_summoning, methods=["GET"]),
        Route("/api/summonings/{request_id}/cancel", cancel_summoning, methods=["POST"]),
        Route("/api/summonings/{request_id}/accept", accept, methods=["POST"]),
        Route("/api/portraits", list_portraits, methods=["GET"]),
        Route("/api/assets", upload_asset, methods=["POST"]),
        Route("/api/assets/{asset_id}", get_asset, methods=["GET"]),
        Route("/api/scene-assets/{key}", get_scene_asset, methods=["GET"]),
    ]
