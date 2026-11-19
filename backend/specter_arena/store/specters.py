from __future__ import annotations

import hashlib
import re
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from .errors import (
    StoreUsageError,
    UnknownAsset,
    UnknownBinding,
    VersionConflict,
)
from .guard import translate_errors
from .store import Store
from .validate import is_time_ms

AssetOrigin = Literal["bundled", "uploaded"]

# The roster order of `backend/specter_arena/specters/heroes.json` and of the CHECK and backfill
# in migration 0007. `test_store_heroes.py` pins all three to each other.
HERO_IDS: tuple[str, ...] = (
    "vell",
    "stitch",
    "reeve",
    "rattle",
    "ember",
    "shard",
    "poly",
    "tide",
    "lume",
    "moss",
    "bur",
)
ROSTER_SIZE = len(HERO_IDS)
MAX_LISTED_HEROES = 500
MAX_LISTED_ASSETS = 200
MAX_ASSET_BYTES = 1_048_576
MAX_ASSET_SIDE = 1024
MAX_ASSET_LABEL_CHARS = 80
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

_BINDING_ID = re.compile(r"bnd_[0-9a-f]{24}")
_ASSET_ID = re.compile(r"ast_[0-9a-f]{24}")
_ORIGINS = ("bundled", "uploaded")


@dataclass(frozen=True, slots=True)
class AssetRecord:
    """Asset metadata; `data` is the PNG bytes only when the caller asked for them."""

    asset_id: str
    sha256: str
    media_type: str
    width: int
    height: int
    byte_length: int
    origin: AssetOrigin
    label: str
    created_ms: int
    data: bytes | None


@dataclass(frozen=True, slots=True)
class HeroRecord:
    """The hero of one binding and its current avatar choice (metadata only).

    `version` is the newest `avatar_revision.revision_no` (0 when the user never chose one) and is
    the caller's `expected_version` for `set_avatar`. `asset_id` is None while the hero's own
    bundled portrait is the avatar; the caller reads the asset with `get_asset`.
    """

    binding_id: str
    assignment_no: int
    hero_id: str
    ordinal: int
    assigned_ms: int
    version: int
    asset_id: str | None
    updated_ms: int


@dataclass(frozen=True, slots=True)
class InsertedAsset:
    record: AssetRecord
    created: bool


def _need_id(pattern: re.Pattern[str], value: object, what: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise StoreUsageError(what)
    return value


def _need_time(value: object) -> int:
    if not is_time_ms(value):
        raise StoreUsageError("time")
    assert isinstance(value, int)
    return value


def _need_version(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise StoreUsageError("expected version")
    return value


_ASSET_COLUMNS = (
    "a.asset_id, a.sha256, a.media_type, a.width, a.height, a.byte_length, a.origin, a.label,"
    " a.created_ms"
)


def _asset(row: Sequence[object], data: bytes | None = None) -> AssetRecord:
    return AssetRecord(
        asset_id=str(row[0]),
        sha256=str(row[1]),
        media_type=str(row[2]),
        width=int(row[3]),  # type: ignore[call-overload]
        height=int(row[4]),  # type: ignore[call-overload]
        byte_length=int(row[5]),  # type: ignore[call-overload]
        origin="bundled" if row[6] == "bundled" else "uploaded",
        label=str(row[7]),
        created_ms=int(row[8]),  # type: ignore[call-overload]
        data=data,
    )


_HERO_SELECT = (
    "SELECT h.binding_id, h.assignment_no, h.hero_id, h.ordinal, h.assigned_ms,"
    " v.revision_no, v.created_ms, v.asset_id"
    " FROM hero_assignment h"
    " LEFT JOIN avatar_revision v ON v.binding_id = h.binding_id AND v.revision_no = ("
    "SELECT max(revision_no) FROM avatar_revision WHERE binding_id = h.binding_id)"
)


def _hero(row: Sequence[object]) -> HeroRecord:
    chosen = row[5] is not None
    return HeroRecord(
        binding_id=str(row[0]),
        assignment_no=int(row[1]),  # type: ignore[call-overload]
        hero_id=str(row[2]),
        ordinal=int(row[3]),  # type: ignore[call-overload]
        assigned_ms=int(row[4]),  # type: ignore[call-overload]
        version=int(row[5]) if chosen else 0,  # type: ignore[call-overload]
        asset_id=None if row[7] is None else str(row[7]),
        updated_ms=int(row[6] if chosen else row[4]),  # type: ignore[call-overload]
    )


def assign_hero(conn: sqlite3.Connection, binding_id: str, assigned_ms: int) -> None:
    """Give a just-created binding its hero: assignment number n gets hero n % 11 at ordinal
    n // 11 + 1. Runs inside the transaction that inserted the binding (the writer lock makes the
    count exact; the table's own UNIQUE, CHECKs and sequence trigger are the backstop). Reads
    nothing about the bot except its id."""
    number = int(conn.execute("SELECT count(*) FROM hero_assignment").fetchone()[0])
    conn.execute(
        "INSERT INTO hero_assignment (binding_id, assignment_no, hero_id, ordinal, assigned_ms)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            binding_id,
            number,
            HERO_IDS[number % ROSTER_SIZE],
            number // ROSTER_SIZE + 1,
            assigned_ms,
        ),
    )


def list_heroes(store: Store) -> tuple[HeroRecord, ...]:
    """Every binding's hero in assignment order, at most `MAX_LISTED_HEROES`."""
    with translate_errors(), store.read() as conn:
        rows = conn.execute(
            _HERO_SELECT + " ORDER BY h.assignment_no LIMIT ?", (MAX_LISTED_HEROES,)
        ).fetchall()
        return tuple(_hero(row) for row in rows)


def get_hero(store: Store, binding_id: str) -> HeroRecord:
    """The hero of one binding. Raises `UnknownBinding` for an unknown or malformed id."""
    if not isinstance(binding_id, str) or _BINDING_ID.fullmatch(binding_id) is None:
        raise UnknownBinding
    with translate_errors(), store.read() as conn:
        row = conn.execute(_HERO_SELECT + " WHERE h.binding_id = ?", (binding_id,)).fetchone()
        if row is None:
            raise UnknownBinding
        return _hero(row)


def set_avatar(
    store: Store,
    binding_id: str,
    expected_version: int,
    asset_id: str | None,
    now_ms: int,
) -> HeroRecord:
    """Point the avatar at `asset_id`; None means the hero's own portrait. Appends one
    `avatar_revision` unless the choice is already current. Nothing else is written: not the hero,
    not the binding, not XP. Raises `UnknownBinding`, `VersionConflict`, `UnknownAsset`."""
    _need_id(_BINDING_ID, binding_id, "binding id")
    _need_time(now_ms)
    expected = _need_version(expected_version)
    if asset_id is not None:
        _need_id(_ASSET_ID, asset_id, "asset id")
    with translate_errors(), store.write() as conn:
        row = conn.execute(_HERO_SELECT + " WHERE h.binding_id = ?", (binding_id,)).fetchone()
        if row is None:
            raise UnknownBinding
        current = _hero(row)
        if current.version != expected:
            raise VersionConflict(current.version)
        if (
            asset_id is not None
            and not conn.execute("SELECT 1 FROM asset WHERE asset_id = ?", (asset_id,)).fetchone()
        ):
            raise UnknownAsset
        if asset_id == current.asset_id:
            return current
        conn.execute(
            "INSERT INTO avatar_revision (binding_id, revision_no, asset_id, created_ms)"
            " VALUES (?, ?, ?, ?)",
            (binding_id, current.version + 1, asset_id, now_ms),
        )
        again = conn.execute(_HERO_SELECT + " WHERE h.binding_id = ?", (binding_id,)).fetchone()
        return _hero(again)


def insert_asset(
    store: Store,
    *,
    data: bytes,
    width: int,
    height: int,
    origin: AssetOrigin,
    label: str,
    now_ms: int,
) -> InsertedAsset:
    """Store re-encoded PNG bytes once. The id is `ast_` + the first 24 hex of the sha256 of
    `data`, computed here. The same bytes again return the existing row (first writer's label and
    origin win) with `created=False`."""
    _need_time(now_ms)
    if not isinstance(data, bytes) or not 1 <= len(data) <= MAX_ASSET_BYTES:
        raise StoreUsageError("asset size")
    if not data.startswith(PNG_SIGNATURE):
        raise StoreUsageError("asset is not a PNG")
    for side in (width, height):
        if isinstance(side, bool) or not isinstance(side, int) or not 1 <= side <= MAX_ASSET_SIDE:
            raise StoreUsageError("asset dimensions")
    if origin not in _ORIGINS:
        raise StoreUsageError("asset origin")
    if not isinstance(label, str) or len(label) > MAX_ASSET_LABEL_CHARS:
        raise StoreUsageError("asset label")
    digest = hashlib.sha256(data).hexdigest()
    asset_id = "ast_" + digest[:24]
    with translate_errors(), store.write() as conn:
        inserted = conn.execute(
            "INSERT INTO asset (asset_id, sha256, media_type, width, height, byte_length, origin,"
            " label, bytes, created_ms) VALUES (?, ?, 'image/png', ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT (sha256) DO NOTHING",
            (asset_id, digest, width, height, len(data), origin, label, data, now_ms),
        )
        row = conn.execute(
            "SELECT " + _ASSET_COLUMNS + " FROM asset a WHERE a.asset_id = ?", (asset_id,)
        ).fetchone()
        return InsertedAsset(_asset(row), inserted.rowcount == 1)


def get_asset(store: Store, asset_id: str, *, with_data: bool = True) -> AssetRecord | None:
    if not isinstance(asset_id, str) or _ASSET_ID.fullmatch(asset_id) is None:
        return None
    with translate_errors(), store.read() as conn:
        row = conn.execute(
            "SELECT " + _ASSET_COLUMNS + ", a.bytes FROM asset a WHERE a.asset_id = ?", (asset_id,)
        ).fetchone()
        if row is None:
            return None
        return _asset(row[:9], bytes(row[9]) if with_data else None)


def list_assets(store: Store) -> tuple[AssetRecord, ...]:
    """Bundled assets first, then uploads, oldest first; metadata only, at most
    `MAX_LISTED_ASSETS`."""
    with translate_errors(), store.read() as conn:
        rows = conn.execute(
            "SELECT " + _ASSET_COLUMNS + " FROM asset a"
            " ORDER BY CASE a.origin WHEN 'bundled' THEN 0 ELSE 1 END, a.created_ms, a.asset_id"
            " LIMIT ?",
            (MAX_LISTED_ASSETS,),
        ).fetchall()
        return tuple(_asset(row) for row in rows)
