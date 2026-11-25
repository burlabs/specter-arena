"""FP-18: the work list projection (`list_work_view`): update order, the order-tagged cursor,
the fields it carries and the queries it does not run. Test-time only."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    InvalidCursor,
    Store,
    StoreUsageError,
    UnknownBinding,
    WorkListRecord,
    encode_cursor,
    get_work,
    list_work,
    list_work_view,
)

from .work_fakes import (
    T0,
    Seeded,
    decide,
    make_work,
    open_seeded,
    submit_and_accept,
)


@pytest.fixture
def ledger(tmp_path: Path) -> Iterator[tuple[Store, Seeded]]:
    opened, seeded = open_seeded(tmp_path, bots=4, per_bot=8)
    try:
        yield opened, seeded
    finally:
        opened.close()


def view(
    store: Store,
    *,
    order: str = "created",
    state: str | None = None,
    binding_id: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> tuple[WorkListRecord, ...]:
    return list_work_view(
        store, state=state, binding_id=binding_id, order=order, cursor=cursor, limit=limit
    ).items


def walk(store: Store, order: str, size: int, **filters: str | None) -> list[str]:
    seen: list[str] = []
    cursor: str | None = None
    while True:
        page = list_work_view(
            store,
            state=filters.get("state"),
            binding_id=filters.get("binding_id"),
            order=order,
            cursor=cursor,
            limit=size,
        )
        seen.extend(r.work_id for r in page.items)
        cursor = page.next_cursor
        if cursor is None:
            return seen


# --- order and the KL-09 regression -------------------------------------------------------------


def test_an_old_item_accepted_today_is_on_the_first_updated_page_but_not_the_first_created_page(
    ledger: tuple[Store, Seeded],
) -> None:
    """KL-09: with 30 accepted items the oldest, accepted last, falls off created page 1."""
    store, seeded = ledger
    records = [
        make_work(store, [seeded.attempts[i % 4][i // 4]], i + 1, at=T0 + 1000 + i)
        for i in range(30)
    ]
    for n, record in enumerate(records[1:], start=1):
        submit_and_accept(store, record, n + 1, at=T0 + 5000 + n * 3)
    oldest = records[0]
    submit_and_accept(store, oldest, 1, at=T0 + 900_000)
    created_ids = [r.work_id for r in view(store, order="created", state="accepted")]
    updated_ids = [r.work_id for r in view(store, order="updated", state="accepted")]
    assert len(created_ids) == len(updated_ids) == 25
    assert oldest.work_id not in created_ids
    assert updated_ids[0] == oldest.work_id
    v1_ids = [
        r.work_id
        for r in list_work(store, state="accepted", binding_id=None, cursor=None, limit=None).items
    ]
    assert v1_ids == created_ids  # the created order of the projection is the v1 order


def test_updated_order_is_last_update_descending_with_work_id_breaking_ties(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    records = [make_work(store, [seeded.attempts[0][i]], i + 1, at=T0 + 1000 + i) for i in range(6)]
    decide(store, records[2], "block", 1, at=T0 + 9000)
    decide(store, records[4], "block", 2, at=T0 + 9000)  # same updated_ms as records[2]
    decide(store, records[0], "block", 3, at=T0 + 9500)
    items = view(store, order="updated")
    keys = [(r.updated_ms, r.work_id) for r in items]
    assert keys == sorted(keys, reverse=True)
    assert [r.work_id for r in items[:3]] == [
        records[0].work_id,
        *sorted((records[2].work_id, records[4].work_id), reverse=True),
    ]


@pytest.mark.parametrize("order", ["created", "updated"])
@pytest.mark.parametrize("size", [1, 4, 7, 25])
def test_walking_every_page_returns_each_item_once_in_order(
    ledger: tuple[Store, Seeded], order: str, size: int
) -> None:
    store, seeded = ledger
    records = [
        make_work(store, [seeded.attempts[i % 4][i // 4]], i + 1, at=T0 + 1000 + i)
        for i in range(30)
    ]
    for n, record in enumerate(records[::3], start=1):
        decide(store, record, "block", n, at=T0 + 8000 - n * 11)
    seen = walk(store, order, size)
    assert len(seen) == len(set(seen)) == 30
    everything = {r.work_id: r for r in view(store, order=order, limit=25)}
    assert len(everything) == 25
    column = "created_ms" if order == "created" else "updated_ms"
    stored = list_work_view(store, state=None, binding_id=None, order=order, cursor=None, limit=25)
    keys = [(getattr(r, column), r.work_id) for r in stored.items]
    assert keys == sorted(keys, reverse=True)
    assert seen[:25] == [r.work_id for r in stored.items]


def test_the_state_and_binding_filters_apply_in_both_orders(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    a = make_work(store, [seeded.attempts[0][0]], 1, at=T0 + 1000)
    b = make_work(store, [seeded.attempts[1][0]], 2, at=T0 + 1001)
    c = make_work(store, [seeded.attempts[0][1]], 3, at=T0 + 1002)
    decide(store, b, "block", 1, at=T0 + 2000)
    for order in ("created", "updated"):
        assert [r.work_id for r in view(store, order=order, state="blocked")] == [b.work_id]
        mine = view(store, order=order, binding_id=seeded.bindings[0])
        assert {r.work_id for r in mine} == {a.work_id, c.work_id}
        both = view(store, order=order, state="open", binding_id=seeded.bindings[0])
        assert {r.work_id for r in both} == {a.work_id, c.work_id}
        assert view(store, order=order, state="accepted") == ()


def test_an_empty_ledger_is_one_empty_page(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    for order in ("created", "updated"):
        page = list_work_view(
            store, state=None, binding_id=None, order=order, cursor=None, limit=None
        )
        assert page.items == () and page.next_cursor is None


def test_the_limit_is_clamped_to_one_through_twenty_five(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    for i in range(30):
        make_work(store, [seeded.attempts[i % 4][i // 4]], i + 1, at=T0 + 1000 + i)
    assert len(view(store, limit=100)) == 25
    assert len(view(store, limit=0)) == 1
    assert len(view(store, limit=None)) == 25


# --- cursors ------------------------------------------------------------------------------------


def test_a_cursor_from_one_order_is_refused_by_the_other_and_by_v1(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    for i in range(30):
        make_work(store, [seeded.attempts[i % 4][i // 4]], i + 1, at=T0 + 1000 + i)
    created = list_work_view(
        store, state=None, binding_id=None, order="created", cursor=None, limit=5
    )
    updated = list_work_view(
        store, state=None, binding_id=None, order="updated", cursor=None, limit=5
    )
    v1 = list_work(store, state=None, binding_id=None, cursor=None, limit=5)
    assert created.next_cursor and updated.next_cursor and v1.next_cursor
    with pytest.raises(InvalidCursor):
        view(store, order="updated", cursor=created.next_cursor)
    with pytest.raises(InvalidCursor):
        view(store, order="created", cursor=updated.next_cursor)
    with pytest.raises(InvalidCursor):  # a work-items.v1 cursor has two values, not three
        view(store, order="created", cursor=v1.next_cursor)
    with pytest.raises(InvalidCursor):  # and the other way round
        list_work(store, state=None, binding_id=None, cursor=created.next_cursor, limit=5)
    assert view(store, order="created", cursor=created.next_cursor, limit=5)
    assert view(store, order="updated", cursor=updated.next_cursor, limit=5)


@pytest.mark.parametrize(
    "values",
    [
        ("c", -1, "wrk_" + "0" * 24),
        ("c", 5, "wrk_nothex"),
        ("c", 5, 7),
        ("x", 5, "wrk_" + "0" * 24),
        ("c", "5", "wrk_" + "0" * 24),
    ],
)
def test_a_cursor_with_a_bad_value_is_refused(
    ledger: tuple[Store, Seeded], values: tuple[object, ...]
) -> None:
    store, _ = ledger
    with pytest.raises(InvalidCursor):
        view(store, order="created", cursor=encode_cursor(values))  # type: ignore[arg-type]


@pytest.mark.parametrize("token", ["", "!!", "abc", "A" * 600])
def test_a_malformed_cursor_is_refused(ledger: tuple[Store, Seeded], token: str) -> None:
    store, _ = ledger
    with pytest.raises(InvalidCursor):
        view(store, order="updated", cursor=token)


def test_bad_arguments_are_refused(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    with pytest.raises(StoreUsageError):
        view(store, order="newest")
    with pytest.raises(StoreUsageError):
        view(store, state="done")
    with pytest.raises(StoreUsageError):
        view(store, binding_id="nope")
    with pytest.raises(UnknownBinding):
        view(store, binding_id="bnd_" + "0" * 24)


# --- what the projection carries -----------------------------------------------------------------


def test_every_shared_field_equals_the_full_read_of_the_same_item(
    ledger: tuple[Store, Seeded],
) -> None:
    """Parity: the projection is the full read minus the dropped fields, never a second opinion."""
    store, seeded = ledger
    plain = make_work(store, [seeded.attempts[0][0]], 1, at=T0 + 1000)
    two_bots = make_work(
        store,
        [seeded.attempts[0][1], seeded.attempts[1][0]],
        2,
        at=T0 + 1001,
        milestones=["a", "b", "c"],
    )
    accepted = submit_and_accept(
        store, make_work(store, [seeded.attempts[2][0]], 3, at=T0 + 1002), 3, at=T0 + 3000
    )
    reopened = decide(store, accepted, "reopen", 4, at=T0 + 4000)
    parent = make_work(store, [], 5, at=T0 + 1003, rewardable=False)
    child = make_work(store, [seeded.attempts[3][0]], 6, at=T0 + 1004, parent_id=parent.work_id)
    submit_and_accept(store, child, 6, at=T0 + 3100)
    no_attempts = make_work(store, [], 7, at=T0 + 1005)
    rejected = decide(
        store,
        decide(
            store,
            make_work(store, [seeded.attempts[2][1]], 8, at=T0 + 1006),
            "submit",
            8,
            at=T0 + 3200,
        ),
        "reject",
        8,
        at=T0 + 3201,
    )
    for order in ("created", "updated"):
        listed = {r.work_id: r for r in view(store, order=order)}
        assert len(listed) == 7
        for original in (plain, two_bots, reopened, parent, child, no_attempts, rejected):
            full = get_work(store, original.work_id)
            row = listed[original.work_id]
            for name in (
                "work_id",
                "parent_id",
                "title",
                "rewardable",
                "bounty_xp",
                "state",
                "version",
                "created_ms",
                "updated_ms",
                "attempts",
                "contributors",
                "progress",
                "child_count",
                "children_accepted",
            ):
                assert getattr(row, name) == getattr(full, name), name


def test_ever_accepted_follows_the_decision_history_not_the_state(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    never = make_work(store, [seeded.attempts[0][0]], 1, at=T0 + 1000)
    waiting = decide(
        store, make_work(store, [seeded.attempts[0][1]], 2, at=T0 + 1001), "submit", 2, at=T0 + 2000
    )
    rejected = decide(
        store,
        decide(
            store,
            make_work(store, [seeded.attempts[0][2]], 3, at=T0 + 1002),
            "submit",
            3,
            at=T0 + 2000,
        ),
        "reject",
        3,
        at=T0 + 2001,
    )
    accepted = submit_and_accept(
        store, make_work(store, [seeded.attempts[1][0]], 4, at=T0 + 1003), 4, at=T0 + 2000
    )
    reopened = decide(
        store,
        submit_and_accept(
            store, make_work(store, [seeded.attempts[1][1]], 5, at=T0 + 1004), 5, at=T0 + 2000
        ),
        "reopen",
        5,
        at=T0 + 3000,
    )
    cancelled = decide(
        store, make_work(store, [seeded.attempts[1][2]], 6, at=T0 + 1005), "cancel", 6, at=T0 + 2000
    )
    rows = {r.work_id: r for r in view(store, order="updated")}
    assert [
        rows[x.work_id].ever_accepted
        for x in (never, waiting, rejected, accepted, reopened, cancelled)
    ] == [
        False,
        False,
        False,
        True,
        True,
        False,
    ]
    assert rows[reopened.work_id].state == "reopened"
    # the same answer the full read gives: some decision has action 'accept'
    for original in (never, waiting, rejected, accepted, reopened, cancelled):
        full = get_work(store, original.work_id)
        assert rows[original.work_id].ever_accepted == any(
            d.action == "accept" for d in full.decisions
        )


def test_the_record_has_no_field_for_what_a_list_does_not_read() -> None:
    names = set(WorkListRecord.__slots__)
    assert names.isdisjoint(
        {
            "acceptance_condition",
            "policy_version",
            "milestones",
            "evidence_revision",
            "review",
            "decisions",
        }
    )
    assert "ever_accepted" in names


# --- the queries it does not run ------------------------------------------------------------------


@contextmanager
def traced(monkeypatch: pytest.MonkeyPatch, statements: list[str]) -> Iterator[None]:
    original = Store.read

    @contextmanager
    def read(self: Store) -> Iterator[object]:
        with original(self) as conn:
            conn.set_trace_callback(statements.append)
            try:
                yield conn
            finally:
                conn.set_trace_callback(None)

    monkeypatch.setattr(Store, "read", read)
    yield


def test_the_projection_runs_three_statements_however_many_items_and_none_for_decisions_or_evidence(
    ledger: tuple[Store, Seeded], monkeypatch: pytest.MonkeyPatch
) -> None:
    store, seeded = ledger
    records = [
        make_work(
            store, [seeded.attempts[i % 4][i // 4]], i + 1, at=T0 + 1000 + i, milestones=["a"]
        )
        for i in range(25)
    ]
    for n, record in enumerate(records[:10]):
        submit_and_accept(store, record, n + 1, at=T0 + 5000 + n * 3)
    counts: dict[str, int] = {}
    for label, limit in (("one", 1), ("full", 25)):
        statements: list[str] = []
        with traced(monkeypatch, statements):
            page = list_work_view(
                store, state=None, binding_id=None, order="updated", cursor=None, limit=limit
            )
        assert len(page.items) == limit
        counts[label] = len(statements)
        text = "\n".join(statements)
        for forbidden in (
            "decision_id",
            "evidence_revision",
            "note",
            "acceptance_condition",
            "label",
            "policy_version",
        ):
            assert forbidden not in text, forbidden
    assert counts["one"] == counts["full"] == 3  # items, attempts for the page, XP net for the page
    statements = []
    with traced(monkeypatch, statements):
        list_work(store, state=None, binding_id=None, cursor=None, limit=None)
    assert len(statements) > 25 * 5  # the v1 read is the six queries per item the projection avoids


def test_the_projection_never_calls_the_full_loader(
    ledger: tuple[Store, Seeded], monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.specter_arena.store import work as work_module

    store, seeded = ledger
    make_work(store, [seeded.attempts[0][0]], 1, at=T0 + 1000)

    def boom(*args: object, **kwargs: object) -> None:
        raise AssertionError("the list projection must not run the full loader")

    monkeypatch.setattr(work_module, "_load", boom)
    monkeypatch.setattr(work_module, "evidence_rows", boom)
    assert len(view(store, order="updated")) == 1


def test_a_page_asdict_is_plain_data(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    make_work(store, [seeded.attempts[0][0]], 1, at=T0 + 1000)
    (row,) = view(store)
    assert asdict(row)["work_id"] == row.work_id
