import base64
import json
import re
import sqlite3
from collections.abc import Sequence
from pathlib import Path

import pytest

from backend.specter_arena.store import InvalidCursor, Page, build_page, clamp_limit
from backend.specter_arena.store.paging import (
    CURSOR_PATTERN,
    DEFAULT_LIMIT,
    MAX_CURSOR_CHARS,
    MAX_LIMIT,
    PAGE_CONTRACT_VERSION,
    CursorValue,
    decode_cursor,
    encode_cursor,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
PAGE_SCHEMA = REPO_ROOT / "contracts" / "schemas" / "page.v1.schema.json"


def token_of(raw: str) -> str:
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def test_clamp_limit_defaults_and_bounds() -> None:
    assert clamp_limit(None) == DEFAULT_LIMIT == 50
    assert clamp_limit(0) == 1
    assert clamp_limit(-5) == 1
    assert clamp_limit(7) == 7
    assert clamp_limit(10_000) == MAX_LIMIT == 200
    assert clamp_limit(None, default=500) == MAX_LIMIT
    assert clamp_limit(30, maximum=20) == 20


def test_a_bool_is_not_a_limit() -> None:
    with pytest.raises(TypeError):
        clamp_limit(True)


@pytest.mark.parametrize(
    "values",
    [(12, "a-b"), ("x",), (0,), (-1, ""), (2**70, "é ☃"), tuple(range(8)), ("x" * 128,)],
)
def test_a_cursor_round_trips(values: tuple[CursorValue, ...]) -> None:
    token = encode_cursor(values)
    assert len(token) <= MAX_CURSOR_CHARS
    assert "=" not in token
    assert decode_cursor(token, len(values)) == values


@pytest.mark.parametrize(
    "values",
    [(), (True,), (1.5,), (None,), ([1],), ("x" * 129,), tuple(range(9)), ("x" * 128,) * 4],
)
def test_encode_rejects_what_a_cursor_cannot_hold(values: tuple[object, ...]) -> None:
    with pytest.raises(InvalidCursor):
        encode_cursor(values)  # type: ignore[arg-type]


GOOD = encode_cursor((12, "a-b"))


@pytest.mark.parametrize(
    "token",
    [
        "",
        "!!",
        GOOD + "=",
        GOOD[:-1] + "+",
        GOOD + "x",
        "A" * (MAX_CURSOR_CHARS + 1),
        "A",
        token_of("[1,"),
        token_of("{}"),
        token_of('"x"'),
        token_of("[1]"),
        token_of("[1,2,3]"),
        token_of("[true,1]"),
        token_of("[1.0,1]"),
        token_of("[NaN,1]"),
        token_of("[1e400,1]"),
        token_of("[null,1]"),
        token_of('[[1],"a"]'),
        token_of('[1, "a"]'),
        token_of(' [1,"a"]'),
        token_of('[1,"a"]\n'),
        token_of('[1,"\\u0061"]'),
        token_of("[" * 5000),
        base64.urlsafe_b64encode('[1,"é"]'.encode()).rstrip(b"=").decode(),
    ],
)
def test_decode_rejects_anything_encode_would_not_produce(token: str) -> None:
    with pytest.raises(InvalidCursor) as caught:
        decode_cursor(token, 2)
    assert isinstance(caught.value, ValueError)
    assert caught.value.code == "invalid-cursor"


def test_decode_checks_arity() -> None:
    with pytest.raises(InvalidCursor):
        decode_cursor(GOOD, 1)
    with pytest.raises(InvalidCursor):
        decode_cursor(token_of("[]"), 0)


def test_a_token_matches_the_published_pattern() -> None:
    assert re.fullmatch(CURSOR_PATTERN, GOOD)


def by_first(row: tuple[int, str]) -> Sequence[CursorValue]:
    return (row[0],)


def test_build_page_uses_the_surplus_row_for_the_cursor() -> None:
    rows = [(1, "a"), (2, "b"), (3, "c")]
    page = build_page(rows, 2, by_first)
    assert page.items == ((1, "a"), (2, "b"))
    assert page.next_cursor is not None
    assert decode_cursor(page.next_cursor, 1) == (2,)


@pytest.mark.parametrize("count", [0, 1, 2])
def test_build_page_without_a_surplus_row_is_the_last_page(count: int) -> None:
    page = build_page([(n, "x") for n in range(count)], 2, by_first)
    assert len(page.items) == count
    assert page.next_cursor is None


def test_build_page_refuses_a_non_positive_limit() -> None:
    with pytest.raises(ValueError):
        build_page([(1, "a")], 0, by_first)


def test_to_wire_is_the_page_v1_shape() -> None:
    page: Page[tuple[int, str]] = Page(((1, "a"), (2, "b")), encode_cursor((2,)))
    assert page.to_wire(lambda row: {"id": row[0]}) == {
        "contractVersion": PAGE_CONTRACT_VERSION,
        "items": [{"id": 1}, {"id": 2}],
        "nextCursor": page.next_cursor,
    }
    assert Page((), None).to_wire(lambda row: {}) == {
        "contractVersion": 1,
        "items": [],
        "nextCursor": None,
    }


def fetch(conn: sqlite3.Connection, limit: int, cursor: str | None) -> Page[tuple[int, int]]:
    if cursor is None:
        rows = conn.execute("SELECT ts, id FROM events ORDER BY ts, id LIMIT ?", (limit + 1,))
    else:
        ts, row_id = decode_cursor(cursor, 2)
        rows = conn.execute(
            "SELECT ts, id FROM events WHERE (ts, id) > (?, ?) ORDER BY ts, id LIMIT ?",
            (ts, row_id, limit + 1),
        )
    return build_page(rows.fetchall(), limit, lambda row: row)


def test_keyset_paging_visits_each_row_once_across_duplicate_timestamps_and_inserts(
    tmp_path: Path,
) -> None:
    conn = sqlite3.connect(tmp_path / "paging.db")
    try:
        conn.execute("CREATE TABLE events (id INTEGER PRIMARY KEY, ts INTEGER NOT NULL) STRICT")
        conn.executemany(
            "INSERT INTO events (id, ts) VALUES (?, ?)", [(n, n // 10) for n in range(1, 201)]
        )
        seen: list[tuple[int, int]] = []
        cursor: str | None = None
        pages = 0
        while True:
            page = fetch(conn, 7, cursor)
            seen.extend(page.items)
            pages += 1
            if pages == 3:
                # One row ahead of the cursor, one behind it, both with duplicate timestamps.
                conn.execute("INSERT INTO events (id, ts) VALUES (1001, 15), (1000, 0)")
            if page.next_cursor is None:
                break
            cursor = page.next_cursor
        ids = [row_id for _, row_id in seen]
        assert len(ids) == len(set(ids))
        assert set(range(1, 201)) <= set(ids)
        assert 1001 in ids
        assert 1000 not in ids
        assert seen == sorted(seen)
        assert pages == 29
    finally:
        conn.close()


@pytest.mark.skipif(not PAGE_SCHEMA.is_file(), reason="page.v1 schema lands with D-3 (WL-6)")
def test_the_page_constants_match_the_page_v1_schema() -> None:
    schema = json.loads(PAGE_SCHEMA.read_text(encoding="utf-8"))
    properties = schema["properties"]
    assert properties["contractVersion"] == {"type": "integer", "const": PAGE_CONTRACT_VERSION}
    assert properties["items"]["maxItems"] == MAX_LIMIT
    assert properties["nextCursor"]["maxLength"] == MAX_CURSOR_CHARS
    assert properties["nextCursor"]["pattern"] == CURSOR_PATTERN
