import ast
import re
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    BindingSeen,
    BudgetExhausted,
    DmKey,
    GenerationInFlight,
    IngestBatch,
    InvalidCursor,
    NotReady,
    RosterPoll,
    RosterRowIn,
    Store,
    StoreUsageError,
    UnknownAsset,
    UnknownBinding,
    UnknownRequest,
    UnknownSpecter,
    VersionConflict,
    ingest,
    open_store,
    start_run,
)
from backend.specter_arena.store import specters as sp
from backend.specter_arena.store.bindings import store_id

ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
BETA = DmKey("beta-0123456789ab", "memory-beta")
T0 = 1_800_000_000_000
DAY = 86_400_000
LIMITS: dict[str, Any] = {"binding_limit": 5, "install_limit": 20, "window_ms": DAY}
STORE_DIR = Path(__file__).resolve().parents[1] / "specter_arena" / "store"
PNG = sp.PNG_SIGNATURE + b"\x00" * 24


def req(n: int) -> str:
    return f"req_{n:024x}"


def profile(name: str = "Vesper", **changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "contractVersion": 1,
        "name": name,
        "epithet": None,
        "personality": "Dry and watchful.",
        "appearance": "A lantern-bearer in a patched grey coat.",
        "mannerism": "Taps the lantern twice before speaking.",
        "signatureAction": None,
        "assignmentRationale": "Chosen from the bot's display name only.",
        "artBrief": "Grey coat, brass lantern, soft rim light.",
    }
    base.update(changes)
    return base


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def bind(opened: Store, key: DmKey = ALPHA, store_name: str = "memory-alpha") -> str:
    with opened.read() as conn:
        started = conn.execute("SELECT count(*) FROM collector_run").fetchone()[0]
        installation = store_id(conn)
    if not started:
        start_run(opened, run_id="run-00000001", now_ms=T0 - 1)
    poll = RosterPoll(True, T0 + 1, (RosterRowIn(store_name, "Alpha", "Alpha Bot", None, None),))
    result = ingest(
        opened,
        IngestBatch("run-00000001", installation, (BindingSeen(key, T0), poll)),
    )
    return result.bindings[0].binding_id


def rows(opened: Store, sql: str, *params: object) -> list[tuple[Any, ...]]:
    with opened.read() as conn:
        return [tuple(r) for r in conn.execute(sql, params)]


def create(opened: Store, binding: str, n: int, at: int = T0, keep: tuple[str, ...] = ()) -> Any:
    return sp.create_request(
        opened,
        request_id=req(n),
        binding_id=binding,
        keep=keep,
        prompt_version="summon-1",
        now_ms=at,
        **LIMITS,
    )


def ready(opened: Store, binding: str, n: int, at: int = T0, **kw: Any) -> str:
    """Create, start and complete request `n`; returns its id."""
    create(opened, binding, n, at, kw.pop("keep", ()))
    assert sp.mark_running(opened, req(n), at + 1)
    candidate = kw.pop("candidate", profile())
    assert sp.complete_request(
        opened, req(n), candidate=candidate, model_label="auto", attempts=1, now_ms=at + 2
    )
    return req(n)


# --- requests ----------------------------------------------------------------------------------


def test_create_request_queues_a_tagged_request_and_a_repeat_returns_it(store: Store) -> None:
    binding = bind(store)
    first = create(store, binding, 1, keep=("name", "appearance", "name"))
    assert first.created is True
    record = first.record
    assert (record.status, record.keep, record.attempts) == ("queued", ("appearance", "name"), 0)
    assert (record.prompt_version, record.started_ms, record.candidate) == ("summon-1", None, None)
    assert rows(store, "SELECT internal_tag FROM generation_request") == [("summoning",)]
    again = create(store, binding, 1, at=T0 + 5)
    assert (again.created, again.record) == (False, record)
    assert rows(store, "SELECT count(*) FROM generation_request") == [(1,)]


def test_a_request_id_cannot_move_to_another_binding(store: Store) -> None:
    alpha = bind(store)
    beta = bind(store, BETA, "memory-beta")
    create(store, alpha, 1)
    with pytest.raises(StoreUsageError):
        create(store, beta, 1)


def test_create_request_refuses_an_unknown_binding_and_bad_input(store: Store) -> None:
    with pytest.raises(UnknownBinding):
        create(store, "bnd_" + "0" * 24, 1)
    binding = bind(store)
    for bad in ({"keep": ("class",)}, {"keep": "name"}, {"request_id": "req_short"}):
        args: dict[str, Any] = {
            "request_id": req(1),
            "binding_id": binding,
            "keep": (),
            "prompt_version": "summon-1",
            "now_ms": T0,
            **LIMITS,
        }
        args.update(bad)
        with pytest.raises(StoreUsageError):
            sp.create_request(store, **args)
    assert rows(store, "SELECT count(*) FROM generation_request") == [(0,)]


def test_one_request_in_flight_per_install(store: Store) -> None:
    alpha = bind(store)
    beta = bind(store, BETA, "memory-beta")
    create(store, alpha, 1)
    with pytest.raises(GenerationInFlight):
        create(store, beta, 2)
    assert sp.mark_running(store, req(1), T0 + 1)
    with pytest.raises(GenerationInFlight):
        create(store, alpha, 2)
    assert sp.fail_request(store, req(1), error_code="timeout", attempts=1, now_ms=T0 + 2)
    assert create(store, beta, 2).created is True


def test_lifecycle_transitions_are_conditional(store: Store) -> None:
    binding = bind(store)
    create(store, binding, 1)
    assert sp.mark_running(store, req(1), T0 + 1) is True
    assert sp.mark_running(store, req(1), T0 + 2) is False
    record = sp.get_request(store, req(1))
    assert record is not None and (record.status, record.started_ms) == ("running", T0 + 1)
    assert sp.complete_request(
        store, req(1), candidate=profile(), model_label="m" * 99, attempts=2, now_ms=T0 + 3
    )
    record = sp.get_request(store, req(1))
    assert record is not None
    assert (record.status, record.attempts, record.finished_ms) == ("ready", 2, T0 + 3)
    assert record.model_label == "m" * 64
    assert record.candidate == profile()
    assert sp.fail_request(store, req(1), error_code="late", attempts=1, now_ms=T0 + 4) is False
    assert (
        sp.complete_request(
            store, req(1), candidate=profile("Other"), model_label="x", attempts=1, now_ms=T0 + 5
        )
        is False
    )
    after = sp.get_request(store, req(1))
    assert after is not None and after.candidate == profile()


def test_a_late_result_for_a_cancelled_request_is_dropped(store: Store) -> None:
    binding = bind(store)
    create(store, binding, 1)
    assert sp.mark_running(store, req(1), T0 + 1)
    cancelled = sp.cancel_request(store, req(1), T0 + 2)
    assert (cancelled.status, cancelled.finished_ms) == ("cancelled", T0 + 2)
    assert (
        sp.complete_request(
            store, req(1), candidate=profile(), model_label="a", attempts=1, now_ms=T0 + 3
        )
        is False
    )
    final = sp.get_request(store, req(1))
    assert final is not None and (final.status, final.candidate) == ("cancelled", None)
    assert sp.cancel_request(store, req(1), T0 + 9) == final
    with pytest.raises(NotReady):
        sp.accept_request(store, req(1), expected_version=0, now_ms=T0 + 4)


def test_cancel_before_running_blocks_the_start_and_discarding_a_ready_candidate_clears_it(
    store: Store,
) -> None:
    binding = bind(store)
    create(store, binding, 1)
    sp.cancel_request(store, req(1), T0 + 1)
    assert sp.mark_running(store, req(1), T0 + 2) is False
    done = ready(store, binding, 2, at=T0 + 10)
    discarded = sp.cancel_request(store, done, T0 + 20)
    assert (discarded.status, discarded.candidate) == ("cancelled", None)
    with pytest.raises(NotReady):
        sp.accept_request(store, done, expected_version=0, now_ms=T0 + 21)


def test_unknown_requests(store: Store) -> None:
    assert sp.get_request(store, req(9)) is None
    assert sp.get_request(store, "../etc/passwd") is None
    for call in (
        lambda: sp.mark_running(store, req(9), T0),
        lambda: sp.cancel_request(store, req(9), T0),
        lambda: sp.accept_request(store, req(9), expected_version=0, now_ms=T0),
        lambda: sp.fail_request(store, req(9), error_code="x", attempts=0, now_ms=T0),
    ):
        with pytest.raises(UnknownRequest):
            call()


def test_sweep_fails_what_a_previous_process_left_in_flight(store: Store) -> None:
    alpha = bind(store)
    ready(store, alpha, 1, at=T0)
    create(store, alpha, 2, at=T0 + 100)
    assert sp.sweep_interrupted(store, T0 + 200) == 1
    swept = sp.get_request(store, req(2))
    assert swept is not None
    assert (swept.status, swept.error_code, swept.finished_ms) == (
        "failed",
        "interrupted",
        T0 + 200,
    )
    create(store, alpha, 3, at=T0 + 300)
    sp.mark_running(store, req(3), T0 + 301)
    assert sp.sweep_interrupted(store, T0 + 400, older_than_ms=1_000) == 0
    assert sp.sweep_interrupted(store, T0 + 400) == 1
    running = sp.get_request(store, req(3))
    assert running is not None and running.status == "failed" and running.started_ms == T0 + 301
    first = sp.get_request(store, req(1))
    assert first is not None and first.status == "ready"


# --- budget ------------------------------------------------------------------------------------


def test_budget_counts_requests_that_reached_running_in_a_rolling_window(store: Store) -> None:
    binding = bind(store)
    budget = sp.get_budget(store, binding, T0, **LIMITS)
    assert (budget.binding_remaining, budget.install_remaining) == (5, 20)
    create(store, binding, 1)
    sp.cancel_request(store, req(1), T0 + 1)  # cancelled before running: not counted
    assert sp.get_budget(store, binding, T0 + 2, **LIMITS).binding_remaining == 5
    create(store, binding, 2, at=T0 + 3)
    sp.mark_running(store, req(2), T0 + 4)
    sp.fail_request(store, req(2), error_code="timeout", attempts=1, now_ms=T0 + 5)  # counts
    assert sp.get_budget(store, binding, T0 + 6, **LIMITS).binding_remaining == 4
    edge = T0 + 4 + DAY
    assert sp.get_budget(store, binding, edge - 1, **LIMITS).binding_remaining == 4
    assert sp.get_budget(store, binding, edge, **LIMITS).binding_remaining == 5  # exclusive edge


def test_window_usage_lists_every_binding_that_has_run_in_the_window(store: Store) -> None:
    alpha = bind(store)
    beta = bind(store, BETA, "memory-beta")
    assert sp.window_usage(store, T0, window_ms=DAY) == sp.WindowUsage(0, {})
    ready(store, alpha, 1, at=T0)
    ready(store, alpha, 2, at=T0 + 10)
    ready(store, beta, 3, at=T0 + 20)
    create(store, beta, 4, at=T0 + 30)  # queued, never ran: not counted
    sp.cancel_request(store, req(4), T0 + 31)
    assert sp.window_usage(store, T0 + 40, window_ms=DAY) == sp.WindowUsage(3, {alpha: 2, beta: 1})
    assert sp.window_usage(store, T0 + 12 + DAY, window_ms=DAY) == sp.WindowUsage(1, {beta: 1})


def test_the_binding_budget_stops_the_sixth_request_and_other_bots_are_unaffected(
    store: Store,
) -> None:
    alpha = bind(store)
    beta = bind(store, BETA, "memory-beta")
    for n in range(1, 6):
        ready(store, alpha, n, at=T0 + n * 10)
    with pytest.raises(BudgetExhausted):
        create(store, alpha, 6, at=T0 + 100)
    assert rows(store, "SELECT count(*) FROM generation_request WHERE request_id = ?", req(6)) == [
        (0,)
    ]
    assert create(store, beta, 7, at=T0 + 100).created is True
    sp.cancel_request(store, req(7), T0 + 101)
    assert sp.get_budget(store, alpha, T0 + 100, **LIMITS).binding_remaining == 0
    later = T0 + 50 + DAY
    assert create(store, alpha, 8, at=later).created is True


def test_the_install_budget_stops_every_bot(store: Store) -> None:
    alpha = bind(store)
    beta = bind(store, BETA, "memory-beta")
    limits = {"binding_limit": 5, "install_limit": 3, "window_ms": DAY}
    for n, binding in ((1, alpha), (2, beta), (3, alpha)):
        sp.create_request(
            store,
            request_id=req(n),
            binding_id=binding,
            keep=(),
            prompt_version="summon-1",
            now_ms=T0 + n,
            **limits,
        )
        sp.mark_running(store, req(n), T0 + n)
        sp.fail_request(store, req(n), error_code="timeout", attempts=1, now_ms=T0 + n)
    with pytest.raises(BudgetExhausted):
        sp.create_request(
            store,
            request_id=req(4),
            binding_id=beta,
            keep=(),
            prompt_version="summon-1",
            now_ms=T0 + 10,
            **limits,
        )


def test_a_repeat_of_a_spent_request_is_still_idempotent(store: Store) -> None:
    binding = bind(store)
    for n in range(1, 6):
        ready(store, binding, n, at=T0 + n * 10)
    assert create(store, binding, 5, at=T0 + 100).created is False


# --- accept ------------------------------------------------------------------------------------


def test_accept_creates_the_first_specter_and_marks_the_request(store: Store) -> None:
    binding = bind(store)
    done = ready(store, binding, 1)
    with pytest.raises(VersionConflict) as stale:
        sp.accept_request(store, done, expected_version=3, now_ms=T0 + 10)
    assert stale.value.current_version == 0
    made = sp.accept_request(store, done, expected_version=0, now_ms=T0 + 10)
    assert (made.binding_id, made.version, made.source) == (binding, 1, "generated")
    assert (made.prompt_version, made.portrait, made.profile) == ("summon-1", None, profile())
    assert re.fullmatch(r"spc_[0-9a-f]{24}", made.specter_id)
    assert sp.get_specter(store, binding) == made
    assert sp.list_specters(store) == (made,)
    record = sp.get_request(store, done)
    assert record is not None and record.status == "accepted"
    assert rows(store, "SELECT revision_no, change, request_id, source FROM specter_revision") == [
        (1, "generated", done, "generated")
    ]
    with pytest.raises(NotReady):
        sp.accept_request(store, done, expected_version=1, now_ms=T0 + 11)


def test_accept_survives_a_restart(tmp_path: Path) -> None:
    opened = open_store(tmp_path / "data")
    binding = bind(opened)
    made = sp.accept_request(opened, ready(opened, binding, 1), expected_version=0, now_ms=T0 + 10)
    opened.close()
    again = open_store(tmp_path / "data")
    try:
        assert sp.get_specter(again, binding) == made
    finally:
        again.close()


def test_accept_with_a_stale_version_leaves_the_active_specter_and_the_request(
    store: Store,
) -> None:
    binding = bind(store)
    first = sp.accept_request(store, ready(store, binding, 1), expected_version=0, now_ms=T0 + 10)
    second = ready(store, binding, 2, at=T0 + 20, candidate=profile("Other"))
    with pytest.raises(VersionConflict) as stale:
        sp.accept_request(store, second, expected_version=0, now_ms=T0 + 30)
    assert stale.value.current_version == 1
    assert sp.get_specter(store, binding) == first
    kept = sp.get_request(store, second)
    assert kept is not None and kept.status == "ready"
    renamed = sp.save_rename(
        store, binding, expected_version=1, profile=profile("Wren"), now_ms=T0 + 40
    )
    with pytest.raises(VersionConflict):
        sp.accept_request(store, second, expected_version=1, now_ms=T0 + 50)
    assert sp.get_specter(store, binding) == renamed


def test_accepting_one_candidate_supersedes_the_other_ready_candidates(store: Store) -> None:
    binding = bind(store)
    one = ready(store, binding, 1, at=T0)
    two = ready(store, binding, 2, at=T0 + 10, candidate=profile("Second"))
    sp.accept_request(store, two, expected_version=0, now_ms=T0 + 20)
    first = sp.get_request(store, one)
    assert first is not None and first.status == "superseded"
    with pytest.raises(NotReady):
        sp.accept_request(store, one, expected_version=1, now_ms=T0 + 21)
    active = sp.get_specter(store, binding)
    assert active is not None and active.profile["name"] == "Second"


def test_a_reroll_keeps_the_current_value_of_a_kept_field_and_the_portrait(store: Store) -> None:
    binding = bind(store)
    sp.accept_request(store, ready(store, binding, 1), expected_version=0, now_ms=T0 + 10)
    asset = sp.insert_asset(
        store, data=PNG, width=8, height=8, origin="uploaded", label="mine", now_ms=T0 + 11
    ).record
    sp.set_portrait(store, binding, expected_version=1, asset_id=asset.asset_id, now_ms=T0 + 12)
    follow = ready(
        store,
        binding,
        2,
        at=T0 + 20,
        keep=("name", "mannerism"),
        candidate=profile("Model Name", appearance="Entirely new look.", mannerism="New tic."),
    )
    # A rename after the request was made must survive: kept values are read at accept time.
    sp.save_rename(store, binding, expected_version=2, profile=profile("Wren"), now_ms=T0 + 25)
    made = sp.accept_request(store, follow, expected_version=3, now_ms=T0 + 30)
    assert made.version == 4
    assert made.profile["name"] == "Wren"
    assert made.profile["mannerism"] == profile()["mannerism"]
    assert made.profile["appearance"] == "Entirely new look."
    assert made.portrait is not None and made.portrait.asset_id == asset.asset_id
    assert made.created_ms == T0 + 10


def test_the_first_accept_ignores_keep_because_there_is_nothing_to_keep(store: Store) -> None:
    binding = bind(store)
    done = ready(store, binding, 1, keep=("name",), candidate=profile("Fresh"))
    made = sp.accept_request(store, done, expected_version=0, now_ms=T0 + 10)
    assert made.profile["name"] == "Fresh"


# --- manual, rename, portrait, archive ---------------------------------------------------------


def test_manual_save_is_labelled_manual_and_never_generation(store: Store) -> None:
    binding = bind(store)
    with pytest.raises(VersionConflict):
        sp.save_manual(store, binding, expected_version=1, profile=profile(), now_ms=T0)
    made = sp.save_manual(store, binding, expected_version=0, profile=profile("Typed"), now_ms=T0)
    assert (made.source, made.prompt_version, made.version) == ("manual", None, 1)
    again = sp.save_manual(store, binding, expected_version=1, profile=profile("Typed2"), now_ms=T0)
    assert (again.version, again.profile["name"]) == (2, "Typed2")
    assert rows(store, "SELECT change, source, request_id FROM specter_revision ORDER BY 1") == [
        ("manual", "manual", None),
        ("manual", "manual", None),
    ]
    with pytest.raises(UnknownBinding):
        sp.save_manual(store, "bnd_" + "1" * 24, expected_version=0, profile=profile(), now_ms=T0)


def test_rename_changes_the_name_only_and_keeps_provenance(store: Store) -> None:
    binding = bind(store)
    sp.accept_request(store, ready(store, binding, 1), expected_version=0, now_ms=T0 + 10)
    renamed = sp.save_rename(
        store,
        binding,
        expected_version=1,
        profile=profile("Wren", epithet="the Late"),
        now_ms=T0 + 20,
    )
    assert (renamed.version, renamed.profile["name"], renamed.profile["epithet"]) == (
        2,
        "Wren",
        "the Late",
    )
    assert (renamed.source, renamed.prompt_version) == ("generated", "summon-1")
    assert rows(store, "SELECT change, request_id FROM specter_revision WHERE revision_no = 2") == [
        ("renamed", None)
    ]
    same = sp.save_rename(
        store,
        binding,
        expected_version=2,
        profile=profile("Wren", epithet="the Late"),
        now_ms=T0 + 30,
    )
    assert same.version == 2
    with pytest.raises(StoreUsageError):
        sp.save_rename(
            store,
            binding,
            expected_version=2,
            profile=profile("Wren", epithet="the Late", appearance="changed"),
            now_ms=T0 + 40,
        )
    with pytest.raises(VersionConflict):
        sp.save_rename(store, binding, expected_version=1, profile=profile("X"), now_ms=T0 + 50)
    with pytest.raises(UnknownSpecter):
        sp.save_rename(
            store, "bnd_" + "2" * 24, expected_version=1, profile=profile("X"), now_ms=T0 + 50
        )


def test_set_portrait_validates_the_asset_and_never_touches_the_profile(store: Store) -> None:
    binding = bind(store)
    made = sp.accept_request(store, ready(store, binding, 1), expected_version=0, now_ms=T0 + 10)
    with pytest.raises(UnknownAsset):
        sp.set_portrait(
            store, binding, expected_version=1, asset_id="ast_" + "a" * 24, now_ms=T0 + 11
        )
    asset = sp.insert_asset(
        store, data=PNG, width=8, height=8, origin="bundled", label="Vell", now_ms=T0 + 12
    ).record
    shown = sp.set_portrait(
        store, binding, expected_version=1, asset_id=asset.asset_id, now_ms=T0 + 13
    )
    assert shown.version == 2 and shown.portrait is not None
    assert shown.portrait.asset_id == asset.asset_id and shown.portrait.data is None
    assert shown.profile == made.profile
    same = sp.set_portrait(
        store, binding, expected_version=2, asset_id=asset.asset_id, now_ms=T0 + 14
    )
    assert same.version == 2
    cleared = sp.set_portrait(store, binding, expected_version=2, asset_id=None, now_ms=T0 + 15)
    assert (cleared.version, cleared.portrait) == (3, None)
    with pytest.raises(VersionConflict):
        sp.set_portrait(store, binding, expected_version=2, asset_id=None, now_ms=T0 + 16)


def test_archive_keeps_history_and_a_later_accept_makes_a_new_specter(store: Store) -> None:
    binding = bind(store)
    old = sp.accept_request(store, ready(store, binding, 1), expected_version=0, now_ms=T0 + 10)
    pending = ready(store, binding, 2, at=T0 + 20, candidate=profile("Next"))
    with pytest.raises(VersionConflict):
        sp.archive_specter(store, binding, expected_version=5, now_ms=T0 + 30)
    sp.archive_specter(store, binding, expected_version=1, now_ms=T0 + 30)
    assert sp.get_specter(store, binding) is None
    assert sp.list_specters(store) == ()
    gone = sp.get_request(store, pending)
    assert gone is not None and gone.status == "superseded"
    with pytest.raises(UnknownSpecter):
        sp.archive_specter(store, binding, expected_version=2, now_ms=T0 + 31)
    assert rows(
        store,
        "SELECT revision_no, change FROM specter_revision WHERE specter_id = ?",
        old.specter_id,
    ) == [(1, "generated"), (2, "archived")]
    fresh = ready(store, binding, 3, at=T0 + 40, candidate=profile("Reborn"))
    made = sp.accept_request(store, fresh, expected_version=0, now_ms=T0 + 50)
    assert made.specter_id != old.specter_id and made.version == 1
    assert rows(store, "SELECT count(*) FROM specter WHERE binding_id = ?", binding) == [(2,)]


def test_every_write_bumps_the_version_by_one_with_a_matching_revision(store: Store) -> None:
    binding = bind(store)
    made = sp.accept_request(store, ready(store, binding, 1), expected_version=0, now_ms=T0 + 10)
    asset = sp.insert_asset(
        store, data=PNG, width=8, height=8, origin="uploaded", label="a", now_ms=T0 + 11
    ).record
    sp.save_rename(store, binding, expected_version=1, profile=profile("B"), now_ms=T0 + 12)
    sp.set_portrait(store, binding, expected_version=2, asset_id=asset.asset_id, now_ms=T0 + 13)
    sp.save_manual(store, binding, expected_version=3, profile=profile("C"), now_ms=T0 + 14)
    sp.archive_specter(store, binding, expected_version=4, now_ms=T0 + 15)
    page = sp.list_revisions(store, made.specter_id)
    assert [r.revision_no for r in page.items] == [5, 4, 3, 2, 1]
    assert [r.change for r in page.items] == [
        "archived",
        "manual",
        "portrait",
        "renamed",
        "generated",
    ]
    assert rows(store, "SELECT version FROM specter") == [(5,)]


# --- reads and paging --------------------------------------------------------------------------


def test_list_specters_orders_oldest_first_and_is_capped(
    store: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    alpha = bind(store)
    beta = bind(store, BETA, "memory-beta")
    second = sp.save_manual(store, beta, expected_version=0, profile=profile("B"), now_ms=T0 + 5)
    first = sp.save_manual(store, alpha, expected_version=0, profile=profile("A"), now_ms=T0 + 1)
    assert sp.list_specters(store) == (first, second)
    monkeypatch.setattr(sp, "MAX_LISTED_SPECTERS", 1)
    assert sp.list_specters(store) == (first,)


def test_list_revisions_pages_newest_first_without_gaps_or_repeats(store: Store) -> None:
    binding = bind(store)
    made = sp.save_manual(store, binding, expected_version=0, profile=profile("N0"), now_ms=T0)
    for n in range(1, 7):
        sp.save_manual(store, binding, expected_version=n, profile=profile(f"N{n}"), now_ms=T0 + n)
    seen: list[int] = []
    cursor = None
    while True:
        page = sp.list_revisions(store, made.specter_id, limit=3, cursor=cursor)
        seen += [r.revision_no for r in page.items]
        cursor = page.next_cursor
        if cursor is None:
            break
    assert seen == [7, 6, 5, 4, 3, 2, 1]
    with pytest.raises(InvalidCursor):
        sp.list_revisions(store, made.specter_id, cursor="not-a-cursor")
    with pytest.raises(UnknownSpecter):
        sp.list_revisions(store, "spc_" + "9" * 24)
    with pytest.raises(StoreUsageError):
        sp.list_revisions(store, "nope")


def test_reads_treat_malformed_ids_as_absent(store: Store) -> None:
    assert sp.get_specter(store, "bnd_x") is None
    assert sp.get_specter(store, "bnd_" + "0" * 24) is None
    assert sp.get_asset(store, "../x") is None
    assert sp.get_asset(store, "ast_" + "0" * 24) is None


def test_bot_display_name_reads_the_newest_display_revision(store: Store) -> None:
    binding = bind(store)
    assert sp.bot_display_name(store, binding) == "Alpha Bot"
    with store.write() as conn:
        conn.execute(
            "INSERT INTO bot_display_revision (binding_id, revision_no, name, display_name,"
            " observed_ms) VALUES (?, 2, 'plain-name', NULL, ?)",
            (binding, T0 + 9),
        )
    assert sp.bot_display_name(store, binding) == "plain-name"
    with pytest.raises(UnknownBinding):
        sp.bot_display_name(store, "bnd_" + "0" * 24)


# --- assets ------------------------------------------------------------------------------------


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


# --- shape checks ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        {**profile(), "extra": "x"},
        {k: v for k, v in profile().items() if k != "artBrief"},
        {**profile(), "name": None},
        profile(personality=3),
        profile(epithet=5),
        profile(contractVersion=2),
        profile(contractVersion=True),
        profile(appearance="x" * 20_000),
        profile(name="\ud800"),
    ],
)
def test_a_profile_of_the_wrong_shape_is_refused_everywhere(store: Store, bad: Any) -> None:
    binding = bind(store)
    with pytest.raises(StoreUsageError):
        sp.save_manual(store, binding, expected_version=0, profile=bad, now_ms=T0)
    create(store, binding, 1)
    sp.mark_running(store, req(1), T0 + 1)
    with pytest.raises(StoreUsageError):
        sp.complete_request(
            store, req(1), candidate=bad, model_label="m", attempts=1, now_ms=T0 + 2
        )
    assert rows(store, "SELECT count(*) FROM specter") == [(0,)]


@pytest.mark.parametrize(
    "call",
    [
        lambda s: sp.fail_request(s, req(1), error_code="Bad Code", attempts=1, now_ms=T0),
        lambda s: sp.fail_request(s, req(1), error_code="x", attempts=9, now_ms=T0),
        lambda s: sp.mark_running(s, req(1), -1),
        lambda s: sp.mark_running(s, req(1), True),
        lambda s: sp.get_budget(
            s, "bnd_" + "0" * 24, T0, binding_limit=-1, install_limit=1, window_ms=1
        ),
        lambda s: sp.get_budget(
            s, "bnd_" + "0" * 24, T0, binding_limit=1, install_limit=1, window_ms=0
        ),
        lambda s: sp.accept_request(s, req(1), expected_version=-1, now_ms=T0),
        lambda s: sp.accept_request(s, req(1), expected_version=True, now_ms=T0),
    ],
)
def test_bad_arguments_are_usage_errors_not_data_errors(store: Store, call: Any) -> None:
    with pytest.raises(StoreUsageError):
        call(store)


# --- concurrency -------------------------------------------------------------------------------


def run_threads(*targets: Any) -> list[Any]:
    results: list[Any] = [None] * len(targets)
    barrier = threading.Barrier(len(targets))

    def wrap(index: int, target: Any) -> None:
        barrier.wait()
        try:
            results[index] = target()
        except Exception as error:  # noqa: BLE001 - the test inspects the type
            results[index] = error

    threads = [threading.Thread(target=wrap, args=(i, t)) for i, t in enumerate(targets)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return results


def test_two_accepts_of_one_request_produce_exactly_one_specter(store: Store) -> None:
    binding = bind(store)
    done = ready(store, binding, 1)
    results = run_threads(
        lambda: sp.accept_request(store, done, expected_version=0, now_ms=T0 + 10),
        lambda: sp.accept_request(store, done, expected_version=0, now_ms=T0 + 10),
    )
    kinds = sorted(type(r).__name__ for r in results)
    assert kinds in (["NotReady", "SpecterRecord"], ["SpecterRecord", "VersionConflict"])
    assert rows(store, "SELECT count(*) FROM specter") == [(1,)]
    assert rows(store, "SELECT count(*) FROM specter_revision") == [(1,)]


def test_two_racing_creates_leave_one_request_in_flight(store: Store) -> None:
    binding = bind(store)
    results = run_threads(
        lambda: create(store, binding, 1),
        lambda: create(store, binding, 2),
    )
    kinds = sorted(type(r).__name__ for r in results)
    assert kinds == ["CreatedRequest", "GenerationInFlight"]
    assert rows(store, "SELECT count(*) FROM generation_request") == [(1,)]


def test_a_rename_and_an_accept_race_on_one_version(store: Store) -> None:
    binding = bind(store)
    sp.accept_request(store, ready(store, binding, 1), expected_version=0, now_ms=T0 + 10)
    follow = ready(store, binding, 2, at=T0 + 20, candidate=profile("Model"))
    results = run_threads(
        lambda: sp.save_rename(
            store, binding, expected_version=1, profile=profile("Wren"), now_ms=T0 + 30
        ),
        lambda: sp.accept_request(store, follow, expected_version=1, now_ms=T0 + 30),
    )
    assert sorted(type(r).__name__ for r in results) == ["SpecterRecord", "VersionConflict"]
    active = sp.get_specter(store, binding)
    assert active is not None and active.version == 2


# --- module hygiene ----------------------------------------------------------------------------


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
    own = {"asset", "generation_request", "specter", "specter_revision"}
    tree = ast.parse((STORE_DIR / "specters.py").read_text(encoding="utf-8"))
    sql = " ".join(
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    )
    targets = set(re.findall(r"\b(?:INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_]+)", sql))
    assert targets == own
    assert "DELETE FROM" not in sql
    reads = set(re.findall(r"\b(?:FROM|JOIN)\s+([a-z_]+)", sql))
    assert reads <= own | {"bot_binding", "bot_display_revision"}
