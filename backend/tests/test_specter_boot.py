"""`boot_specters` builds a started service, or logs the exception type and returns None."""

import asyncio
import logging
from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.specter_arena.specters import heroes
from backend.specter_arena.specters import service as service_module
from backend.specter_arena.specters.boot import boot_specters
from backend.specter_arena.specters.service import SpecterService
from backend.specter_arena.store import Store, open_store


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def test_boot_returns_a_started_service(store: Store) -> None:
    async def scenario() -> None:
        service = await boot_specters(store)
        assert isinstance(service, SpecterService)
        assert len((await service.list_portraits())["items"]) == 11
        await service.close()

    asyncio.run(scenario())


def test_boot_returns_none_when_the_roster_is_invalid(
    store: Store,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    bad = tmp_path / "heroes.json"
    bad.write_text('{"heroes": []}', encoding="utf-8")
    monkeypatch.setattr(heroes, "HEROES_PATH", bad)
    heroes.load_heroes.cache_clear()
    try:
        with caplog.at_level(logging.WARNING, logger="specter_arena.specters.boot"):
            assert asyncio.run(boot_specters(store)) is None
    finally:
        monkeypatch.undo()
        heroes.load_heroes.cache_clear()
    assert "HeroRosterError" in caplog.text
    assert str(tmp_path) not in caplog.text


def test_boot_returns_none_when_start_fails(
    store: Store, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def broken(self: SpecterService) -> None:
        raise RuntimeError("secret-path /Users/someone/data")

    monkeypatch.setattr(service_module.SpecterService, "start", broken)
    with caplog.at_level(logging.WARNING, logger="specter_arena.specters.boot"):
        assert asyncio.run(boot_specters(store)) is None
    assert "RuntimeError" in caplog.text
    assert "/Users/" not in caplog.text and "secret-path" not in caplog.text
