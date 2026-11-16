import importlib
import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    MAX_BATCH_ITEMS,
    BindingSeen,
    DmKey,
    IngestBatch,
    IngestItem,
    IngestResult,
    RosterPoll,
    RosterRowIn,
    Store,
    StoreUnavailable,
    StoreUsageError,
    UnknownRun,
    ingest,
    open_store,
    start_run,
)
from backend.specter_arena.store import connection as connection_module
from backend.specter_arena.store.bindings import store_id
from backend.specter_arena.store.errors import StoreError
from backend.specter_arena.store.guard import translate_errors

ingest_module = importlib.import_module("backend.specter_arena.store.ingest")
ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
T0 = 1_800_000_000_000


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def run(opened: Store, *items: IngestItem) -> IngestResult:
    with opened.read() as conn:
        started = conn.execute("SELECT count(*) FROM collector_run").fetchone()[0]
    if not started:
        start_run(opened, run_id="run-00000001", now_ms=T0 - 1)
    with opened.read() as conn:
        installation_id = store_id(conn)
    return ingest(opened, IngestBatch("run-00000001", installation_id, items))


def bindings_count(opened: Store) -> int:
    with opened.read() as conn:
        return int(conn.execute("SELECT count(*) FROM bot_binding").fetchone()[0])


def test_counts_cover_every_item_kind_and_outcome(store: Store) -> None:
    result = run(store, BindingSeen(ALPHA, T0), BindingSeen(ALPHA, T0 + 1))
    assert set(result.counts) == {"binding", "roster", "observation", "coverage", "quarantine"}
    assert (result.counts["binding"].persisted, result.counts["binding"].deduplicated) == (1, 1)
    assert result.counts["roster"].persisted == 0
    assert result.last_seq is None
    assert [ref.created for ref in result.bindings] == [True, False]
    assert result.bindings[0].binding_id == result.bindings[1].binding_id


def test_a_binding_ref_carries_the_key_and_the_sequence(store: Store) -> None:
    (ref,) = run(store, BindingSeen(ALPHA, T0)).bindings
    assert (ref.dm_key, ref.memory_store, ref.binding_seq) == (
        "member-alpha-0123456789ab.memory-memory-alpha",
        "memory-alpha",
        1,
    )


def test_a_bad_item_is_rejected_between_two_good_ones(store: Store) -> None:
    beta = DmKey("beta-0123456789ab", "memory-beta")
    result = run(
        store,
        BindingSeen(ALPHA, T0),
        BindingSeen(DmKey("Bad Key", "x"), T0),
        BindingSeen(beta, T0),
    )
    assert [(r.index, r.kind, r.reason) for r in result.rejections] == [
        (1, "binding", "bad-dm-key")
    ]
    assert result.counts["binding"].persisted == 2
    assert result.counts["binding"].rejected == 1
    assert [ref.dm_key for ref in result.bindings] == [
        "member-alpha-0123456789ab.memory-memory-alpha",
        "member-beta-0123456789ab.memory-memory-beta",
    ]
    assert bindings_count(store) == 2


@pytest.mark.parametrize(
    "item,reason",
    [
        (BindingSeen(DmKey("alpha", ""), T0), "store-less-bot"),
        (BindingSeen(DmKey("Alpha", "s"), T0), "bad-dm-key"),
        (BindingSeen(DmKey("alpha", "bad/store"), T0), "bad-dm-key"),
        (BindingSeen(ALPHA, -1), "bad-field"),
        (BindingSeen(ALPHA, True), "bad-field"),
        (BindingSeen(ALPHA, T0, source_time_ms=-5), "bad-field"),
        (BindingSeen(DmKey(1, "s"), T0), "bad-field"),  # type: ignore[arg-type]
        (RosterPoll(success="yes", polled_at_ms=T0), "bad-field"),  # type: ignore[arg-type]
        (RosterPoll(success=True, polled_at_ms=-1), "bad-field"),
        (RosterPoll(success=False, polled_at_ms=T0, reason="Bad Reason"), "bad-field"),
        (
            RosterPoll(
                success=False, polled_at_ms=T0, rows=(RosterRowIn("s", "n", None, None, None),)
            ),
            "bad-field",
        ),
        (RosterPoll(success=True, polled_at_ms=T0, rows=[]), "bad-field"),  # type: ignore[arg-type]
        (
            RosterPoll(
                True, T0, tuple(RosterRowIn(f"s{i}", "n", None, None, None) for i in range(201))
            ),
            "bad-field",
        ),
        (
            RosterPoll(True, T0, (RosterRowIn("bad/store", "n", None, None, None),)),
            "bad-roster-row",
        ),
        (RosterPoll(True, T0, (RosterRowIn("s", 5, None, None, None),)), "bad-roster-row"),  # type: ignore[arg-type]
        (RosterPoll(True, T0, (RosterRowIn("s", "n", 5, None, None),)), "bad-roster-row"),  # type: ignore[arg-type]
        (RosterPoll(True, T0, (RosterRowIn("s", "n", None, 5, None),)), "bad-roster-row"),  # type: ignore[arg-type]
        (RosterPoll(True, T0, (RosterRowIn("s", "n", None, None, 5),)), "bad-roster-row"),  # type: ignore[arg-type]
        (
            RosterPoll(
                True,
                T0,
                (
                    RosterRowIn("s", "n", None, None, None),
                    RosterRowIn("s", "m", None, None, None),
                ),
            ),
            "bad-roster-row",
        ),
    ],
)
def test_malformed_items_are_rejected_with_a_stable_reason(
    store: Store, item: IngestItem, reason: str
) -> None:
    result = run(store, item)
    assert [r.reason for r in result.rejections] == [reason]
    assert bindings_count(store) == 0
    with store.read() as conn:
        assert conn.execute("SELECT count(*) FROM bot_display_revision").fetchone() == (0,)


def test_a_rejected_roster_poll_leaves_no_partial_write(store: Store) -> None:
    run(store, BindingSeen(ALPHA, T0))
    good = RosterRowIn("memory-alpha", "Alpha", None, None, None)
    bad = RosterRowIn("memory-beta", "n" * 129, None, None, None)
    result = run(store, RosterPoll(True, T0 + 1, (good, bad)))
    assert [r.reason for r in result.rejections] == ["bad-roster-row"]
    with store.read() as conn:
        assert conn.execute("SELECT count(*) FROM bot_presence").fetchone() == (0,)


def test_a_constraint_failure_rolls_back_only_that_item(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = ingest_module.insert_binding
    calls: list[int] = []

    def flaky(
        conn: sqlite3.Connection, installation_id: str, key: DmKey, seen_at_ms: int
    ) -> object:
        calls.append(1)
        made = real(conn, installation_id, key, seen_at_ms)
        if len(calls) == 2:
            conn.execute(
                "INSERT INTO bot_presence (binding_id, state, since_ms) VALUES ('x', 'present', 0)"
            )
        return made

    monkeypatch.setattr(ingest_module, "insert_binding", flaky)
    beta = DmKey("beta-0123456789ab", "memory-beta")
    gamma = DmKey("gamma-0123456789ab", "memory-gamma")
    result = run(store, BindingSeen(ALPHA, T0), BindingSeen(beta, T0), BindingSeen(gamma, T0))
    assert [(r.index, r.reason) for r in result.rejections] == [(1, "constraint")]
    assert result.counts["binding"].persisted == 2
    assert bindings_count(store) == 2


@pytest.mark.parametrize("size", [0, MAX_BATCH_ITEMS + 1])
def test_a_batch_outside_one_to_the_limit_is_a_usage_error(store: Store, size: int) -> None:
    items = tuple(BindingSeen(ALPHA, T0) for _ in range(size))
    with pytest.raises(StoreUsageError):
        run(store, *items)


def test_a_full_batch_is_accepted(store: Store) -> None:
    result = run(store, *(BindingSeen(ALPHA, T0) for _ in range(MAX_BATCH_ITEMS)))
    assert result.counts["binding"].persisted == 1
    assert result.counts["binding"].deduplicated == MAX_BATCH_ITEMS - 1


def test_a_driver_failure_rolls_the_batch_back_and_is_store_unavailable(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = ingest_module.insert_binding
    seen: list[int] = []

    def failing(
        conn: sqlite3.Connection, installation_id: str, key: DmKey, seen_at_ms: int
    ) -> object:
        seen.append(1)
        if len(seen) == 2:
            raise sqlite3.OperationalError("disk I/O error at /secret/path")
        return real(conn, installation_id, key, seen_at_ms)

    monkeypatch.setattr(ingest_module, "insert_binding", failing)
    beta = DmKey("beta-0123456789ab", "memory-beta")
    with pytest.raises(StoreUnavailable) as caught:
        run(store, BindingSeen(ALPHA, T0), BindingSeen(beta, T0))
    assert "secret" not in str(caught.value)
    assert isinstance(caught.value.__cause__, sqlite3.OperationalError)
    assert bindings_count(store) == 0
    monkeypatch.setattr(ingest_module, "insert_binding", real)
    retried = run(store, BindingSeen(ALPHA, T0), BindingSeen(beta, T0))
    assert retried.counts["binding"].persisted == 2


def test_a_held_write_lock_is_store_unavailable_and_the_retry_is_safe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(connection_module, "BUSY_TIMEOUT_S", 0.05)
    data_dir = tmp_path / "data"
    opened = open_store(data_dir)
    blocker = sqlite3.connect(opened.db_path, isolation_level=None)
    try:
        blocker.execute("BEGIN IMMEDIATE")
        with pytest.raises(StoreUnavailable):
            run(opened, BindingSeen(ALPHA, T0))
        blocker.execute("ROLLBACK")
        assert run(opened, BindingSeen(ALPHA, T0)).counts["binding"].persisted == 1
    finally:
        blocker.close()
        opened.close()


def test_translate_errors_passes_store_errors_through_and_wraps_driver_errors() -> None:
    with pytest.raises(UnknownRun), translate_errors():
        raise UnknownRun
    with pytest.raises(StoreUnavailable) as caught, translate_errors():
        raise sqlite3.IntegrityError("x")
    assert isinstance(caught.value.__cause__, sqlite3.IntegrityError)
    with pytest.raises(ValueError), translate_errors():
        raise ValueError("not a driver error")


def test_unknown_run_is_a_store_error_with_its_own_code() -> None:
    assert issubclass(UnknownRun, StoreError)
    assert UnknownRun.code == "unknown-run"
    assert str(UnknownRun()) == "unknown-run"
