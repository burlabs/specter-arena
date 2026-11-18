import asyncio
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.config import Grants
from backend.specter_arena.specters.service import SpecterService
from backend.specter_arena.store import Store, open_store
from backend.specter_arena.summoner import UnavailableSummoner
from backend.specter_arena.summoner import boot as boot_module
from backend.specter_arena.summoner.boot import boot_specters
from backend.specter_arena.summoner.client import CrewChatSummoner

GATEWAY_ENV = {
    "KIROCREW_GATEWAY_ORIGIN": "http://127.0.0.1:1",
    "KIROCREW_PROXY_SECRET": "test-app-secret",
    "KIROCREW_APP_NAME": "specter-arena",
}


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def boot(store: Store, environment: dict[str, str]) -> SpecterService:
    async def scenario() -> SpecterService:
        service = await boot_specters(store, environment=environment)
        assert service is not None
        await service.close()
        return service

    return asyncio.run(scenario())


def test_without_gateway_environment_manual_entry_still_starts_with_an_unavailable_summoner(
    store: Store,
) -> None:
    assert isinstance(boot(store, {})._summoner, UnavailableSummoner)


def test_gateway_environment_without_the_chat_grant_is_unavailable(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(boot_module, "read_grants", lambda: Grants.none("test"))
    assert isinstance(boot(store, GATEWAY_ENV)._summoner, UnavailableSummoner)


def test_gateway_environment_and_the_chat_grant_use_the_real_client(store: Store) -> None:
    assert isinstance(boot(store, GATEWAY_ENV)._summoner, CrewChatSummoner)


def test_a_service_that_cannot_start_returns_none_and_logs_the_type_only(
    store: Store, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def broken(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("secret-path /Users/x")

    monkeypatch.setattr(SpecterService, "start", broken)
    with caplog.at_level(logging.WARNING, logger="specter_arena.summoner.boot"):
        assert asyncio.run(boot_specters(store, environment={})) is None
    assert "RuntimeError" in caplog.text and "/Users/x" not in caplog.text
