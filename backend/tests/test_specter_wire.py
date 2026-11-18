"""FP-02-AC04 producer test: real `SpecterService` bodies validated against the five Specter
contracts with the same validator the case runner uses, over the real store."""

import asyncio
import base64
from collections.abc import Callable, Coroutine, Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.specters.service import SpecterService
from backend.specter_arena.store import Store, open_store

from .contract_support import compile_schema, load_registry
from .png_support import png
from .specter_fakes import ALPHA, FakeClock, ScriptedSummoner, bind, good_reply

REGISTRY = load_registry()


IDS = {
    "specter-profile": "urn:specter-arena:contract:specter-profile:v1",
    "portrait-asset": "urn:specter-arena:contract:portrait-asset:v1",
    "specter": "urn:specter-arena:contract:specter:v1",
    "specters": "urn:specter-arena:contract:specters:v1",
    "summoning": "urn:specter-arena:contract:summoning:v1",
}


def check(schema: str, body: Any) -> None:
    compile_schema(IDS[schema], REGISTRY)(body)


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def run[T](scenario: Callable[[], Coroutine[Any, Any, T]]) -> T:
    return asyncio.run(scenario())


def test_every_body_the_service_produces_matches_its_contract(store: Store) -> None:
    async def scenario() -> None:
        binding = bind(store, ALPHA, "Probe Bot")
        service = SpecterService(store, ScriptedSummoner(good_reply()), clock=FakeClock())
        await service.start()
        empty = await service.list_specters()
        check("specters", empty)
        request = "req_" + "1" * 24
        _status, queued = await service.start_summoning(binding, {"requestId": request})
        check("summoning", queued)
        for _ in range(400):
            ready = await service.get_summoning(request)
            if ready["status"] == "ready":
                break
            await asyncio.sleep(0.005)
        check("summoning", ready)
        assert ready["candidate"] is not None
        check("specter-profile", ready["candidate"])
        specter = await service.accept(request, 0)
        check("specter", specter)
        check("summoning", await service.get_summoning(request))
        gallery = (await service.list_portraits())["items"]
        for item in gallery:
            check("portrait-asset", item)
        uploaded = await service.upload_asset(
            {"mediaType": "image/png", "dataBase64": base64.b64encode(png()).decode()}
        )
        check("portrait-asset", uploaded)
        served = await service.get_asset(uploaded["assetId"])
        check("portrait-asset", served)
        assert isinstance(served["dataBase64"], str)
        with_portrait = await service.set_portrait(binding, 1, uploaded["assetId"])
        check("specter", with_portrait)
        listed = await service.list_specters()
        check("specters", listed)
        assert listed["items"][0]["portrait"]["dataBase64"] is None

    run(scenario)
