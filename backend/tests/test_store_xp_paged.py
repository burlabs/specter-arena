"""FP-18 (KL-11): `xp_summaries_page` returns every binding with an XP entry, 200 a page, where
`xp_summaries` stops at 500. Test-time only."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    MAX_BATCH_ITEMS,
    BindingSeen,
    InvalidCursor,
    Store,
    XpSummary,
    encode_cursor,
    open_store,
    start_run,
    xp_summaries,
    xp_summaries_page,
)
from backend.specter_arena.store.dmkey import build_dm_key
from backend.specter_arena.store.xp import MAX_SUMMARIES, MAX_SUMMARY_PAGE

from .work_fakes import (
    RUN,
    T0,
    Seeded,
    decide,
    dm_key_of,
    make_work,
    open_seeded,
    send,
    submit_and_accept,
    worker_attempt,
)

BINDINGS = MAX_SUMMARIES + 21  # 521: past the v1 cap, not a multiple of the page size


def seed_bindings(root: Path, bots: int, per_bot: int) -> tuple[Store, Seeded]:
    """`open_seeded` sends every BindingSeen in one batch, which `MAX_BATCH_ITEMS` forbids here."""
    store = open_store(root / "data")
    start_run(store, run_id=RUN, now_ms=T0 - 1)
    for first in range(0, bots, MAX_BATCH_ITEMS):
        send(
            store,
            *(
                BindingSeen(dm_key_of(i), T0)
                for i in range(first, min(first + MAX_BATCH_ITEMS, bots))
            ),
        )
    with store.read() as conn:
        bindings = tuple(
            str(
                conn.execute(
                    "SELECT binding_id FROM bot_binding WHERE dm_key = ?",
                    (build_dm_key(dm_key_of(i)),),
                ).fetchone()[0]
            )
            for i in range(bots)
        )
    attempts = tuple(
        tuple(worker_attempt(store, b, b * 100 + n) for n in range(per_bot)) for b in range(bots)
    )
    return store, Seeded(bindings, attempts)


@pytest.fixture(scope="module")
def big(tmp_path_factory: pytest.TempPathFactory) -> Iterator[tuple[Store, Seeded]]:
    """521 bindings, each with one accepted item; every third also holds a second, reopened one."""
    opened, seeded = seed_bindings(tmp_path_factory.mktemp("xp-paged"), BINDINGS, 2)
    for i in range(BINDINGS):
        record = make_work(opened, [seeded.attempts[i][0]], i + 1, at=T0 + 1000 + i)
        submit_and_accept(opened, record, i + 1, at=T0 + 5000 + i)
        if i % 3 == 0:
            second = make_work(opened, [seeded.attempts[i][1]], 10_000 + i, at=T0 + 2000 + i)
            accepted = submit_and_accept(opened, second, 10_000 + i, at=T0 + 6000 + i)
            decide(opened, accepted, "reopen", 10_000 + i, at=T0 + 7000 + i)
    try:
        yield opened, seeded
    finally:
        opened.close()


def walk(store: Store, size: int | None) -> list[XpSummary]:
    seen: list[XpSummary] = []
    cursor: str | None = None
    while True:
        page = xp_summaries_page(store, cursor=cursor, limit=size)
        seen.extend(page.items)
        cursor = page.next_cursor
        if cursor is None:
            return seen


def test_v1_still_stops_at_five_hundred(big: tuple[Store, Seeded]) -> None:
    store, _ = big
    assert len(xp_summaries(store)) == MAX_SUMMARIES


def test_the_paged_read_returns_every_binding_once_in_binding_order(
    big: tuple[Store, Seeded],
) -> None:
    store, seeded = big
    pages: list[int] = []
    cursor: str | None = None
    ids: list[str] = []
    while True:
        page = xp_summaries_page(store, cursor=cursor, limit=None)
        pages.append(len(page.items))
        ids.extend(s.binding_id for s in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break
    assert pages == [200, 200, 121]
    assert len(ids) == len(set(ids)) == BINDINGS
    assert ids == sorted(ids)
    assert set(ids) == set(seeded.bindings)


def test_the_paged_values_equal_the_capped_values_for_the_bindings_the_cap_keeps(
    big: tuple[Store, Seeded],
) -> None:
    store, _ = big
    capped = {s.binding_id: s for s in xp_summaries(store)}
    paged = {s.binding_id: s for s in walk(store, None)}
    assert len(paged) == BINDINGS
    for binding_id, summary in capped.items():
        assert paged[binding_id] == summary
    # one accepted item each; the reopened second item nets 0 and does not count as accepted
    assert all((s.total_xp, s.accepted_work_count) == (100, 1) for s in paged.values())


@pytest.mark.parametrize("size", [7, 199, 200, 500])
def test_any_page_size_walks_the_same_bindings(big: tuple[Store, Seeded], size: int) -> None:
    store, _ = big
    ids = [s.binding_id for s in walk(store, size)]
    assert len(ids) == len(set(ids)) == BINDINGS


def test_one_binding_per_page_still_ends(big: tuple[Store, Seeded]) -> None:
    store, _ = big
    cursor: str | None = None
    count = 0
    while True:
        page = xp_summaries_page(store, cursor=cursor, limit=1)
        assert len(page.items) == 1
        count += 1
        cursor = page.next_cursor
        if cursor is None:
            break
    assert count == BINDINGS


def test_the_limit_is_clamped_to_one_through_two_hundred(big: tuple[Store, Seeded]) -> None:
    store, _ = big
    assert len(xp_summaries_page(store, cursor=None, limit=10_000).items) == MAX_SUMMARY_PAGE
    assert len(xp_summaries_page(store, cursor=None, limit=0).items) == 1
    assert MAX_SUMMARY_PAGE == 200


def test_a_cursor_that_is_not_one_binding_id_is_refused(big: tuple[Store, Seeded]) -> None:
    store, _ = big
    for bad in (
        encode_cursor(["bnd_nothex"]),
        encode_cursor([5]),
        encode_cursor(["c", 5, "wrk_" + "0" * 24]),  # a work cursor
        encode_cursor(["bnd_" + "0" * 24, "bnd_" + "0" * 24]),
        "",
        "!!",
    ):
        with pytest.raises(InvalidCursor):
            xp_summaries_page(store, cursor=bad, limit=None)


def test_a_cursor_past_the_last_binding_is_an_empty_final_page(big: tuple[Store, Seeded]) -> None:
    store, _ = big
    page = xp_summaries_page(store, cursor=encode_cursor(["bnd_" + "f" * 24]), limit=None)
    assert page.items == () and page.next_cursor is None


def test_an_empty_ledger_is_one_empty_page(tmp_path: Path) -> None:
    opened, _ = open_seeded(tmp_path, bots=2, per_bot=1)
    try:
        page = xp_summaries_page(opened, cursor=None, limit=None)
        assert page.items == () and page.next_cursor is None
    finally:
        opened.close()
