"""The asset functions of `store/specters.py`; heroes and avatars are in test_store_heroes.py."""

import ast
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import Store, StoreUsageError, open_store
from backend.specter_arena.store import specters as sp

T0 = 1_800_000_000_000
STORE_DIR = Path(__file__).resolve().parents[1] / "specter_arena" / "store"
PNG = sp.PNG_SIGNATURE + b"\x00" * 24


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def rows(opened: Store, sql: str, *params: object) -> list[tuple[Any, ...]]:
    with opened.read() as conn:
        return [tuple(r) for r in conn.execute(sql, params)]


def test_insert_asset_is_content_addressed_and_idempotent(store: Store) -> None:
    first = sp.insert_asset(
        store, data=PNG, width=8, height=4, origin="bundled", label="Vell", now_ms=T0
    )
    assert first.created is True
    record = first.record
    assert re.fullmatch(r"ast_[0-9a-f]{24}", record.asset_id)
    assert record.asset_id == "ast_" + record.sha256[:24]
    assert (record.width, record.height, record.byte_length, record.origin) == (
        8,
        4,
        len(PNG),
        "bundled",
    )
    again = sp.insert_asset(
        store, data=PNG, width=9, height=9, origin="uploaded", label="other", now_ms=T0 + 5
    )
    assert (again.created, again.record) == (False, record)
    assert rows(store, "SELECT count(*) FROM asset") == [(1,)]
    full = sp.get_asset(store, record.asset_id)
    assert full is not None and full.data == PNG
    meta = sp.get_asset(store, record.asset_id, with_data=False)
    assert meta is not None and meta.data is None and meta.asset_id == record.asset_id


@pytest.mark.parametrize(
    "kwargs",
    [
        {"data": b"GIF89a" + b"\x00" * 30},
        {"data": b""},
        {"data": sp.PNG_SIGNATURE + b"\x00" * sp.MAX_ASSET_BYTES},
        {"width": 0},
        {"height": 1025},
        {"width": True},
        {"origin": "remote"},
        {"label": "x" * 81},
    ],
)
def test_insert_asset_refuses_bad_input(store: Store, kwargs: dict[str, Any]) -> None:
    args: dict[str, Any] = {
        "data": PNG,
        "width": 8,
        "height": 8,
        "origin": "uploaded",
        "label": "ok",
        "now_ms": T0,
    }
    args.update(kwargs)
    with pytest.raises(StoreUsageError):
        sp.insert_asset(store, **args)
    assert rows(store, "SELECT count(*) FROM asset") == [(0,)]


def test_list_assets_puts_bundled_first_without_bytes(store: Store) -> None:
    upload = sp.insert_asset(
        store, data=PNG + b"1", width=8, height=8, origin="uploaded", label="u", now_ms=T0
    ).record
    bundled = sp.insert_asset(
        store, data=PNG + b"2", width=8, height=8, origin="bundled", label="b", now_ms=T0 + 1
    ).record
    listed = sp.list_assets(store)
    assert [a.asset_id for a in listed] == [bundled.asset_id, upload.asset_id]
    assert all(a.data is None for a in listed)


def test_get_asset_treats_a_malformed_id_as_absent(store: Store) -> None:
    assert sp.get_asset(store, "nope") is None
    assert sp.get_asset(store, "ast_" + "0" * 24) is None


def test_the_specter_store_module_imports_no_clock_network_or_event_loop() -> None:
    forbidden = {"socket", "http", "urllib", "ssl", "asyncio", "requests", "time", "datetime"}
    tree = ast.parse((STORE_DIR / "specters.py").read_text(encoding="utf-8"))
    imported = {
        part.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for part in (alias.name for alias in node.names)
    } | {
        (node.module or "").split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.level == 0
    }
    assert imported & forbidden == set()


def test_the_specter_store_module_writes_only_its_own_tables() -> None:
    own = {"asset", "hero_assignment", "avatar_revision"}
    tree = ast.parse((STORE_DIR / "specters.py").read_text(encoding="utf-8"))
    sql = " ".join(
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    )
    targets = set(re.findall(r"\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)", sql))
    assert targets == own
    assert "DELETE FROM" not in sql and "UPDATE " not in sql
    reads = set(re.findall(r"\b(?:FROM|JOIN)\s+([a-z_]+)", sql))
    assert reads <= own
