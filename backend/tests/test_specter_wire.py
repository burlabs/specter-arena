"""FP-02-AC04 producer test: real `SpecterService` bodies validated against the Specter
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
from .specter_fakes import ALPHA, FakeClock, bind

REGISTRY = load_registry()


IDS = {
    "portrait-asset": "urn:specter-arena:contract:portrait-asset:v1",
    "specter": "urn:specter-arena:contract:specter:v2",
    "specters": "urn:specter-arena:contract:specters:v2",
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
        service = SpecterService(store, clock=FakeClock())
        await service.start()
        check("specters", await service.list_specters())
        binding = bind(store, ALPHA, "Probe Bot")
        listed = await service.list_specters()
        check("specters", listed)
        check("specter", await service.get_specter(binding))
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
        chosen = await service.set_portrait(binding, 0, uploaded["assetId"])
        check("specter", chosen)
        check("specter", await service.set_portrait(binding, 1, None))
        listed = await service.list_specters()
        check("specters", listed)
        assert listed["items"][0]["portrait"]["dataBase64"] is None

    run(scenario)
