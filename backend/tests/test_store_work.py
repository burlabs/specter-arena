import inspect
import json
import unicodedata
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, cast

import pytest

from backend.specter_arena.store import (
    AttemptAlreadyLinked,
    AttemptNotEligible,
    AttemptsNotEnded,
    ChildrenNotAccepted,
    ContributorsFrozen,
    InvalidCursor,
    InvalidTransition,
    LimitReached,
    NoEvidence,
    ParentLocked,
    RequestReused,
    StaleEvidence,
    Store,
    StoreUsageError,
    UnknownAttempt,
    UnknownBinding,
    UnknownWork,
    VersionConflict,
    WorkProgress,
    WorkRecord,
    create_work,
    decide_work,
    encode_cursor,
    get_work,
    link_attempt,
    list_work,
    rebuild_projection,
    set_milestone,
    xp_summaries,
)
from backend.specter_arena.store import work as work_module
from backend.specter_arena.store import xp as xp_module
from backend.specter_arena.store.work import (
    ACTIONS,
    STATES,
    TRANSITIONS,
    canonical_evidence,
    evidence_revision_of,
)

from .work_fakes import (
    LEDGER_TABLES,
    T0,
    Seeded,
    bot_turn_attempt,
    decide,
    ledger_hash,
    make_work,
    observe,
    open_seeded,
    query,
    send,
    submit_and_accept,
    token,
    worker_attempt,
)

EMPTY_REVISION = "4f53cda18c2baa0c0354bb5f"
MISSING_REVISION = "e6718347b2a7b4014f462a98"


@pytest.fixture
def ledger(tmp_path: Path) -> Iterator[tuple[Store, Seeded]]:
    opened, seeded = open_seeded(tmp_path, bots=9, per_bot=4)
    try:
        yield opened, seeded
    finally:
        opened.close()


def counts(store: Store) -> dict[str, int]:
    return {t: query(store, f"SELECT count(*) FROM {t}")[0][0] for t in LEDGER_TABLES}


def raw_create(store: Store, **changes: Any) -> Any:
    arguments: dict[str, Any] = {
        "request_token": token("create", 99),
        "title": "A title",
        "acceptance_condition": "A condition",
        "rewardable": True,
        "parent_id": None,
        "attempt_ids": [],
        "milestones": [],
        "now_ms": T0 + 100,
    }
    arguments.update(changes)
    return create_work(store, **arguments)


def test_create_work_links_attempts_and_fixes_the_bounty(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    chosen = [seeded.attempts[0][0], seeded.attempts[0][1], seeded.attempts[1][0]]
    result = raw_create(store, attempt_ids=chosen, milestones=["Outline", "Draft"])
    record = result.record
    assert result.created is True
    assert (record.state, record.version, record.rewardable) == ("open", 1, True)
    assert (record.bounty_xp, record.policy_version) == (100, "xp-policy-1")
    assert (record.created_ms, record.updated_ms, record.parent_id) == (T0 + 100, T0 + 100, None)
    assert [a.attempt_id for a in record.attempts] == chosen
    assert all(a.ended and a.present and a.kind == "worker" for a in record.attempts)
    assert [(c.binding_id, c.attempt_count, c.xp_net) for c in record.contributors] == sorted(
        [(seeded.bindings[0], 2, 0), (seeded.bindings[1], 1, 0)]
    )
    assert [(m.position, m.label, m.done_ms) for m in record.milestones] == [
        (1, "Outline", None),
        (2, "Draft", None),
    ]
    assert record.progress == WorkProgress(0, 2)
    assert (record.child_count, record.children_accepted, record.decisions) == (0, 0, ())
    assert len(record.evidence_revision) == 24
    assert record.review.can_accept is False
    assert record.review.blockers == ("wrong-state",)
    assert counts(store) == {
        "work_item": 1,
        "work_attempt": 3,
        "work_milestone": 2,
        "work_decision": 0,
        "xp_entry": 0,
    }


def test_create_work_not_rewardable_has_a_zero_bounty(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = raw_create(store, rewardable=False, attempt_ids=[seeded.attempts[0][0]]).record
    assert (record.rewardable, record.bounty_xp) == (False, 0)


def test_create_work_replays_one_token(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    fields: dict[str, Any] = {
        "attempt_ids": [seeded.attempts[0][0]],
        "milestones": ["One", "Two"],
        "title": "Same",
    }
    first = raw_create(store, **fields)
    again = raw_create(store, **{**fields, "now_ms": T0 + 5000})
    assert (first.created, again.created) == (True, False)
    assert again.record == first.record
    assert counts(store)["work_item"] == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "Different"},
        {"acceptance_condition": "Different"},
        {"rewardable": False},
        {"milestones": ["Other"]},
        {"attempt_ids": []},
    ],
)
def test_create_work_with_one_token_and_other_fields_raises(
    ledger: tuple[Store, Seeded], changes: dict[str, Any]
) -> None:
    store, seeded = ledger
    base: dict[str, Any] = {"attempt_ids": [seeded.attempts[0][0]], "milestones": ["One"]}
    raw_create(store, **base)
    with pytest.raises(RequestReused):
        raw_create(store, **{**base, **changes})
    assert counts(store)["work_item"] == 1


def test_create_work_with_one_token_and_another_parent_raises(
    ledger: tuple[Store, Seeded],
) -> None:
    store, _ = ledger
    parent = raw_create(store, request_token=token("parent", 1)).record
    other = raw_create(store, request_token=token("parent", 2)).record
    raw_create(store, parent_id=parent.work_id)
    with pytest.raises(RequestReused):
        raw_create(store, parent_id=other.work_id)


def test_create_work_refuses_unknown_wrongly_typed_and_already_linked_attempts(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    summoning = "att_" + "9" * 24
    with store.write() as conn:
        conn.execute(
            "INSERT INTO attempt (attempt_id, binding_id, kind, slot_key, started_ms, started_seq,"
            " running) VALUES (?, ?, 'summoning', 'slot', 1, 1, 0)",
            (summoning, seeded.bindings[0]),
        )
    taken = seeded.attempts[0][0]
    raw_create(store, request_token=token("first", 1), attempt_ids=[taken])
    before = ledger_hash(store)
    with pytest.raises(UnknownAttempt):
        raw_create(store, attempt_ids=["att_" + "0" * 24])
    with pytest.raises(AttemptNotEligible):
        raw_create(store, attempt_ids=[summoning])
    with pytest.raises(AttemptAlreadyLinked):
        raw_create(store, attempt_ids=[seeded.attempts[0][1], taken])
    assert ledger_hash(store) == before


def test_create_work_refuses_more_than_the_limits(tmp_path: Path) -> None:
    opened, seeded = open_seeded(tmp_path, bots=9, per_bot=2)
    try:
        flat = seeded.flat()
        with pytest.raises(LimitReached):
            raw_create(opened, attempt_ids=flat[:17])
        nine_bots = [seeded.attempts[b][0] for b in range(9)]
        with pytest.raises(LimitReached):
            raw_create(opened, attempt_ids=nine_bots)
        with pytest.raises(LimitReached):
            raw_create(opened, milestones=[f"m{i}" for i in range(9)])
        assert counts(opened)["work_item"] == 0
        sixteen = [a for per_bot in seeded.attempts[:8] for a in per_bot]
        record = raw_create(
            opened, attempt_ids=sixteen, milestones=[f"m{i}" for i in range(8)]
        ).record
        assert (len(record.attempts), len(record.contributors), len(record.milestones)) == (
            16,
            8,
            8,
        )
    finally:
        opened.close()


def test_a_container_can_start_with_no_attempts(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    record = raw_create(store).record
    assert (record.attempts, record.contributors, record.progress) == ((), (), None)
    assert record.evidence_revision == EMPTY_REVISION


def test_child_creation_rules(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    root = make_work(store, [seeded.attempts[0][0]], 1)
    middle = make_work(store, [seeded.attempts[1][0]], 2, parent_id=root.work_id)
    leaf = make_work(store, [seeded.attempts[2][0]], 3, parent_id=middle.work_id)
    assert (leaf.parent_id, get_work(store, root.work_id).child_count) == (middle.work_id, 1)
    with pytest.raises(LimitReached):
        make_work(store, [seeded.attempts[3][0]], 4, parent_id=leaf.work_id)
    with pytest.raises(UnknownWork):
        make_work(store, [], 5, parent_id="wrk_" + "f" * 24)
    cancelled = make_work(store, [], 6)
    decide(store, cancelled, "cancel", 1, at=T0 + 2000)
    with pytest.raises(ParentLocked):
        make_work(store, [], 7, parent_id=cancelled.work_id)


def test_a_parent_with_xp_or_an_accepted_state_takes_no_children(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    earned = make_work(store, [seeded.attempts[0][0]], 1)
    submit_and_accept(store, earned, 1, at=T0 + 2000)
    with pytest.raises(ParentLocked):
        make_work(store, [], 2, parent_id=earned.work_id)
    tracked = make_work(store, [seeded.attempts[1][0]], 3, rewardable=False)
    submit_and_accept(store, tracked, 2, at=T0 + 3000)
    with pytest.raises(ParentLocked):
        make_work(store, [], 4, parent_id=tracked.work_id)


def test_an_ended_attempt_with_no_work_item_earns_nothing(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    assert all(counts(store)[t] == 0 for t in LEDGER_TABLES)
    assert xp_summaries(store) == ()
    assert len(query(store, "SELECT 1 FROM attempt WHERE running = 0")) == len(seeded.flat())
    rebuild_projection(store, as_of_ms=T0 + 5000)
    assert all(counts(store)[t] == 0 for t in LEDGER_TABLES)


def test_an_ended_linked_attempt_earns_nothing_until_a_human_accepts(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    assert record.attempts[0].ended is True
    assert counts(store)["xp_entry"] == 0
    submitted = decide(store, record, "submit", 1, at=T0 + 2000)
    assert (submitted.state, counts(store)["xp_entry"]) == ("awaiting-review", 0)
    accepted = decide(store, submitted, "accept", 1, at=T0 + 2001)
    assert accepted.state == "accepted"
    assert counts(store)["xp_entry"] == 1
    assert accepted.contributors[0].xp_net == 100


def test_a_chat_done_end_signal_is_not_acceptance(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    ended = bot_turn_attempt(store, 0, end="chat-done")
    record = make_work(store, [ended])
    assert record.attempts[0].kind == "bot-turn"
    assert (record.attempts[0].end_signal, record.attempts[0].ended) == ("chat_done", True)
    assert (record.state, counts(store)["work_decision"], counts(store)["xp_entry"]) == (
        "open",
        0,
        0,
    )
    assert xp_summaries(store) == ()


def test_a_retry_is_another_attempt_on_the_same_item(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    first = make_work(store, [seeded.attempts[0][0]])
    retried = link_attempt(
        store,
        first.work_id,
        expected_version=first.version,
        attempt_id=seeded.attempts[0][1],
        now_ms=T0 + 2000,
    )
    assert counts(store)["work_item"] == 1
    assert (retried.version, len(retried.attempts)) == (2, 2)
    assert [(c.binding_id, c.attempt_count) for c in retried.contributors] == [
        (seeded.bindings[0], 2)
    ]
    assert retried.evidence_revision != first.evidence_revision


def test_two_bots_on_one_item_have_one_outcome_and_two_contributors(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0], seeded.attempts[1][0]])
    accepted = submit_and_accept(store, record, 1, at=T0 + 2000)
    assert accepted.state == "accepted"
    assert len(accepted.contributors) == 2
    assert sum(c.xp_net for c in accepted.contributors) == 100
    assert counts(store)["work_item"] == 1


def test_progress_is_unknown_without_milestones(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    assert record.progress is None


def test_progress_counts_done_milestones_only(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]], milestones=["a", "b", "c"])
    first = set_milestone(
        store, record.work_id, expected_version=1, position=2, done=True, now_ms=T0 + 2000
    )
    assert first.progress == WorkProgress(1, 3)
    assert first.version == 2
    assert [m.done_ms for m in first.milestones] == [None, T0 + 2000, None]
    undone = set_milestone(
        store, record.work_id, expected_version=2, position=2, done=False, now_ms=T0 + 2100
    )
    assert undone.progress == WorkProgress(0, 3)
    assert undone.milestones[1].done_ms is None


def test_progress_ignores_attempt_times_and_token_like_facts(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]], milestones=["a", "b"])
    key = query(
        store,
        "SELECT b.dm_key FROM bot_binding b WHERE b.binding_id = ?",
        seeded.bindings[0],
    )[0][0]
    send(
        store,
        observe(store, key, T0 + 9000, turn=5, turnGen="ab05", tokens=123456, lastActivityMs=9),
    )
    again = get_work(store, record.work_id)
    assert again.progress == WorkProgress(0, 2)
    long_run = make_work(
        store, [seeded.attempts[1][0]], 2, milestones=["only"], at=T0 + 1_000_000_000
    )
    assert long_run.progress == WorkProgress(0, 1)


def test_milestone_toggle_to_the_same_value_is_a_noop(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]], milestones=["a"])
    before = ledger_hash(store)
    same = set_milestone(
        store, record.work_id, expected_version=1, position=1, done=False, now_ms=T0 + 2000
    )
    assert (same.version, same.updated_ms) == (1, record.updated_ms)
    assert ledger_hash(store) == before


def test_a_cancelled_item_takes_no_milestone_change(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]], milestones=["a"])
    cancelled = decide(store, record, "cancel", 1, at=T0 + 2000)
    with pytest.raises(InvalidTransition):
        set_milestone(
            store,
            record.work_id,
            expected_version=cancelled.version,
            position=1,
            done=True,
            now_ms=T0 + 3000,
        )
    with pytest.raises(VersionConflict) as stale:
        set_milestone(
            store, record.work_id, expected_version=1, position=1, done=True, now_ms=T0 + 3000
        )
    assert stale.value.current_version == cancelled.version


def test_the_revision_of_no_attempts_is_the_hash_of_an_empty_list() -> None:
    assert evidence_revision_of([]) == EMPTY_REVISION
    assert canonical_evidence([]) == "[]"


def test_a_missing_attempt_contributes_seven_elements_with_six_nulls(
    ledger: tuple[Store, Seeded],
) -> None:
    assert evidence_revision_of([["att_x", None, None, None, None, None, None]]) == (
        MISSING_REVISION
    )
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    with store.write() as conn:
        conn.execute("DELETE FROM attempt WHERE attempt_id = ?", (seeded.attempts[0][0],))
    gone = get_work(store, record.work_id)
    view = gone.attempts[0]
    assert (view.present, view.ended, view.started_ms, view.ended_ms, view.end_signal) == (
        False,
        False,
        None,
        None,
        None,
    )
    assert gone.evidence_revision != record.evidence_revision
    assert gone.review.blockers == ("wrong-state", "attempt-missing")
    submitted = decide(store, gone, "submit", 1, at=T0 + 2000)
    assert "attempt-missing" in submitted.review.blockers
    assert submitted.review.can_accept is False


def test_the_revision_is_the_documented_hash_of_the_linked_attempts(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    chosen = [seeded.attempts[0][0], seeded.attempts[1][0]]
    record = make_work(store, chosen)
    rows = query(
        store,
        "SELECT attempt_id, binding_id, kind, started_ms, ended_ms, running, end_signal"
        " FROM attempt WHERE attempt_id IN (?, ?) ORDER BY attempt_id",
        *chosen,
    )
    expected = evidence_revision_of([list(r) for r in rows])
    assert record.evidence_revision == expected


def test_the_revision_survives_a_projection_rebuild(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    turn = bot_turn_attempt(store, 2, end="chat-done", turn=3, ms=T0 + 700)
    record = make_work(store, [seeded.attempts[0][0], seeded.attempts[1][0], turn])
    rebuild_projection(store, as_of_ms=T0 + 9000)
    assert get_work(store, record.work_id).evidence_revision == record.evidence_revision


def test_the_revision_changes_when_a_worker_attempt_reopens(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    key, slot = query(
        store,
        "SELECT b.dm_key, a.slot_key FROM attempt a JOIN bot_binding b USING (binding_id)"
        " WHERE a.attempt_id = ?",
        seeded.attempts[0][0],
    )[0]
    send(
        store,
        observe(store, key, T0 + 9000, slot=slot, createdBy=key, createdMs=7, running=True),
    )
    reopened = get_work(store, record.work_id)
    assert reopened.attempts[0].ended is False
    assert reopened.evidence_revision != record.evidence_revision


def test_the_revision_changes_when_an_end_time_changes(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    with store.write() as conn:
        conn.execute(
            "UPDATE attempt SET ended_ms = ended_ms + 1 WHERE attempt_id = ?",
            (seeded.attempts[0][0],),
        )
    assert get_work(store, record.work_id).evidence_revision != record.evidence_revision


def test_decide_records_actor_time_note_and_evidence_snapshot(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    submitted = decide(store, record, "submit", 1, at=T0 + 2000, note="Ready for a look.")
    accepted = decide(store, submitted, "accept", 1, at=T0 + 2500, note="Looks right.")
    first, second = accepted.decisions
    assert (first.seq, first.action, first.from_state, first.to_state) == (
        1,
        "submit",
        "open",
        "awaiting-review",
    )
    assert (first.actor, first.at_ms, first.note, first.evidence_revision) == (
        "app-owner",
        T0 + 2000,
        "Ready for a look.",
        None,
    )
    assert (second.seq, second.action, second.to_state, second.note) == (
        2,
        "accept",
        "accepted",
        "Looks right.",
    )
    assert second.evidence_revision == record.evidence_revision
    stored = query(
        store,
        "SELECT evidence_json FROM work_decision WHERE work_id = ? AND seq = 2",
        record.work_id,
    )[0][0]
    snapshot = json.loads(stored)
    assert [row[0] for row in snapshot] == [seeded.attempts[0][0]]
    assert len(snapshot[0]) == 7
    assert snapshot[0][1] == seeded.bindings[0]
    assert query(store, "SELECT evidence_json FROM work_decision WHERE seq = 1") == [(None,)]


def test_accept_needs_the_echoed_revision_and_none_is_stale(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    submitted = decide(store, record, "submit", 1, at=T0 + 2000)
    for revision in (None, "0" * 24, submitted.evidence_revision[::-1]):
        with pytest.raises(StaleEvidence):
            decide_work(
                store,
                record.work_id,
                action="accept",
                expected_version=submitted.version,
                request_token=token("accept", 5),
                evidence_revision=revision,
                note=None,
                now_ms=T0 + 3000,
            )
    with pytest.raises(StaleEvidence):
        decide_work(
            store,
            record.work_id,
            action="reject",
            expected_version=submitted.version,
            request_token=token("reject", 5),
            evidence_revision="0" * 24,
            note=None,
            now_ms=T0 + 3000,
        )
    assert counts(store)["xp_entry"] == 0
    rejected = decide(store, submitted, "reject", 1, at=T0 + 3100, note="Not yet.")
    assert rejected.state == "rejected"


def test_accept_needs_every_attempt_ended(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    running = worker_attempt(store, 0, 901, ended=False)
    record = make_work(store, [seeded.attempts[0][0], running])
    assert record.attempts[1].ended is False
    submitted = decide(store, record, "submit", 1, at=T0 + 2000)
    assert "attempts-not-ended" in submitted.review.blockers
    with pytest.raises(AttemptsNotEnded):
        decide(store, submitted, "accept", 1, at=T0 + 2100)
    assert counts(store)["xp_entry"] == 0


def test_accept_of_a_missing_attempt_is_attempts_not_ended(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    submitted = decide(store, record, "submit", 1, at=T0 + 2000)
    with store.write() as conn:
        conn.execute("DELETE FROM attempt WHERE attempt_id = ?", (seeded.attempts[0][0],))
    current = get_work(store, record.work_id)
    with pytest.raises(AttemptsNotEnded):
        decide(store, current, "accept", 1, at=T0 + 2100)
    assert submitted.version == current.version


def test_accept_of_a_leaf_without_attempts_is_no_evidence(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    record = make_work(store, [])
    submitted = decide(store, record, "submit", 1, at=T0 + 2000)
    assert submitted.review.blockers == ("no-evidence",)
    with pytest.raises(NoEvidence):
        decide(store, submitted, "accept", 1, at=T0 + 2100)


def test_a_container_is_accepted_only_after_its_children(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    parent = make_work(store, [], 1)
    child = make_work(store, [seeded.attempts[0][0]], 2, parent_id=parent.work_id)
    other = make_work(store, [seeded.attempts[1][0]], 3, parent_id=parent.work_id)
    submitted = decide(store, get_work(store, parent.work_id), "submit", 1, at=T0 + 2000)
    assert submitted.review.blockers == ("children-not-accepted",)
    assert (submitted.child_count, submitted.children_accepted) == (2, 0)
    with pytest.raises(ChildrenNotAccepted):
        decide(store, submitted, "accept", 1, at=T0 + 2100)
    submit_and_accept(store, child, 1, at=T0 + 2200)
    mid = get_work(store, parent.work_id)
    assert (mid.child_count, mid.children_accepted) == (2, 1)
    with pytest.raises(ChildrenNotAccepted):
        decide(store, mid, "accept", 2, at=T0 + 2300)
    decide(store, other, "cancel", 2, at=T0 + 2400)
    ready = get_work(store, parent.work_id)
    assert ready.review.can_accept is True
    accepted = decide(store, ready, "accept", 3, at=T0 + 2500)
    assert accepted.state == "accepted"
    assert counts(store)["xp_entry"] == 1


def test_a_container_whose_children_are_all_cancelled_cannot_be_accepted(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    parent = make_work(store, [], 1)
    child = make_work(store, [seeded.attempts[0][0]], 2, parent_id=parent.work_id)
    decide(store, child, "cancel", 1, at=T0 + 2000)
    submitted = decide(store, get_work(store, parent.work_id), "submit", 1, at=T0 + 2100)
    assert submitted.review.can_accept is False
    assert submitted.review.blockers == ("children-not-accepted",)
    before = ledger_hash(store)
    with pytest.raises(ChildrenNotAccepted):
        decide(store, submitted, "accept", 1, at=T0 + 2200)
    assert ledger_hash(store) == before


Scenario = Callable[[Store, Seeded], tuple[Callable[[], Any], type[Exception]]]


def scenario_stale_evidence(
    store: Store, seeded: Seeded
) -> tuple[Callable[[], Any], type[Exception]]:
    record = decide(store, make_work(store, [seeded.attempts[0][0]]), "submit", 1, at=T0 + 2000)
    return (
        lambda: decide(store, record, "accept", 2, at=T0 + 2100, revision="1" * 24),
        StaleEvidence,
    )


def scenario_wrong_version(
    store: Store, seeded: Seeded
) -> tuple[Callable[[], Any], type[Exception]]:
    record = make_work(store, [seeded.attempts[0][0]])
    return (
        lambda: decide_work(
            store,
            record.work_id,
            action="submit",
            expected_version=record.version + 3,
            request_token=token("submit", 1),
            evidence_revision=None,
            note=None,
            now_ms=T0 + 2000,
        ),
        VersionConflict,
    )


def scenario_invalid_transition(
    store: Store, seeded: Seeded
) -> tuple[Callable[[], Any], type[Exception]]:
    record = make_work(store, [seeded.attempts[0][0]])
    return lambda: decide(store, record, "accept", 1, at=T0 + 2000), InvalidTransition


def scenario_running_attempt(
    store: Store, seeded: Seeded
) -> tuple[Callable[[], Any], type[Exception]]:
    running = worker_attempt(store, 1, 902, ended=False)
    record = decide(store, make_work(store, [running]), "submit", 1, at=T0 + 2000)
    return lambda: decide(store, record, "accept", 2, at=T0 + 2100), AttemptsNotEnded


def scenario_no_evidence(store: Store, seeded: Seeded) -> tuple[Callable[[], Any], type[Exception]]:
    record = decide(store, make_work(store, []), "submit", 1, at=T0 + 2000)
    return lambda: decide(store, record, "accept", 2, at=T0 + 2100), NoEvidence


def scenario_children_open(
    store: Store, seeded: Seeded
) -> tuple[Callable[[], Any], type[Exception]]:
    parent = make_work(store, [], 1)
    make_work(store, [seeded.attempts[0][0]], 2, parent_id=parent.work_id)
    record = decide(store, get_work(store, parent.work_id), "submit", 1, at=T0 + 2000)
    return lambda: decide(store, record, "accept", 2, at=T0 + 2100), ChildrenNotAccepted


def scenario_reused_token(
    store: Store, seeded: Seeded
) -> tuple[Callable[[], Any], type[Exception]]:
    record = make_work(store, [seeded.attempts[0][0]])
    decide(store, record, "block", 1, at=T0 + 2000)
    return (
        lambda: decide_work(
            store,
            record.work_id,
            action="cancel",
            expected_version=record.version + 1,
            request_token=token("block", 1),
            evidence_revision=None,
            note=None,
            now_ms=T0 + 2100,
        ),
        RequestReused,
    )


def scenario_unknown_work(
    store: Store, seeded: Seeded
) -> tuple[Callable[[], Any], type[Exception]]:
    return (
        lambda: decide_work(
            store,
            "wrk_" + "e" * 24,
            action="submit",
            expected_version=1,
            request_token=token("submit", 1),
            evidence_revision=None,
            note=None,
            now_ms=T0 + 2000,
        ),
        UnknownWork,
    )


SCENARIOS: dict[str, Scenario] = {
    "stale evidence": scenario_stale_evidence,
    "wrong version": scenario_wrong_version,
    "invalid transition": scenario_invalid_transition,
    "running attempt": scenario_running_attempt,
    "no evidence": scenario_no_evidence,
    "children open": scenario_children_open,
    "reused token": scenario_reused_token,
    "unknown work": scenario_unknown_work,
}


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_refused_decisions_leave_every_row_unchanged(
    ledger: tuple[Store, Seeded], name: str
) -> None:
    store, seeded = ledger
    attempt, error = SCENARIOS[name](store, seeded)
    before = ledger_hash(store)
    with pytest.raises(error):
        attempt()
    assert ledger_hash(store) == before


def test_a_replayed_token_returns_the_recorded_result_and_writes_nothing(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    submitted = decide(store, record, "submit", 1, at=T0 + 2000)
    arguments: dict[str, Any] = {
        "action": "accept",
        "request_token": token("accept", 1),
        "evidence_revision": submitted.evidence_revision,
        "note": "ok",
    }
    first = decide_work(
        store, record.work_id, expected_version=submitted.version, now_ms=T0 + 2100, **arguments
    )
    before = ledger_hash(store)
    again = decide_work(
        store, record.work_id, expected_version=submitted.version, now_ms=T0 + 9000, **arguments
    )
    assert (first.replayed, again.replayed) == (False, True)
    assert again.record == first.record
    assert ledger_hash(store) == before


def test_replay_wins_over_a_version_conflict(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    first = decide_work(
        store,
        record.work_id,
        action="block",
        expected_version=record.version,
        request_token=token("block", 1),
        evidence_revision=None,
        note=None,
        now_ms=T0 + 2000,
    )
    stale = decide_work(
        store,
        record.work_id,
        action="block",
        expected_version=record.version,
        request_token=token("block", 1),
        evidence_revision=None,
        note=None,
        now_ms=T0 + 2100,
    )
    assert stale.replayed is True and stale.record == first.record


@pytest.mark.parametrize(
    "changes",
    [
        {"action": "cancel"},
        {"note": "a different note"},
        {"note": None},
    ],
)
def test_a_token_reused_with_another_action_or_note_raises(
    ledger: tuple[Store, Seeded], changes: dict[str, Any]
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    base: dict[str, Any] = {"action": "block", "note": "waiting"}

    def call(extra: dict[str, Any]) -> Any:
        return decide_work(
            store,
            record.work_id,
            expected_version=record.version,
            request_token=token("block", 1),
            evidence_revision=None,
            now_ms=T0 + 2000,
            **{**base, **extra},
        )

    call({})
    with pytest.raises(RequestReused):
        call(changes)


def test_a_token_reused_with_another_evidence_revision_raises(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = decide(store, make_work(store, [seeded.attempts[0][0]]), "submit", 1, at=T0 + 2000)
    rejected = decide(store, record, "reject", 1, at=T0 + 2100)
    with pytest.raises(RequestReused):
        decide(store, rejected, "reject", 1, at=T0 + 2200, revision="2" * 24)


def test_decision_time_never_goes_backwards(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]], at=T0 + 5000)
    submitted = decide(store, record, "submit", 1, at=T0 + 10)
    assert submitted.decisions[0].at_ms == T0 + 5000
    assert submitted.updated_ms == T0 + 5000
    again = decide(store, submitted, "block", 2, at=T0 + 4000)
    assert again.updated_ms == T0 + 5000


def reach(store: Store, record: WorkRecord, state: str, start: int) -> WorkRecord:
    steps = {
        "open": [],
        "awaiting-review": ["submit"],
        "blocked": ["block"],
        "rejected": ["submit", "reject"],
        "cancelled": ["cancel"],
        "accepted": ["submit", "accept"],
        "reopened": ["submit", "accept", "reopen"],
    }[state]
    for index, action in enumerate(steps):
        record = decide(store, record, action, start + index, at=T0 + 2000 + start + index)
    assert record.state == state
    return record


@pytest.mark.parametrize("action", ACTIONS)
@pytest.mark.parametrize("state", STATES)
def test_every_state_and_action_pair(tmp_path: Path, state: str, action: str) -> None:
    opened, seeded = open_seeded(tmp_path, bots=1, per_bot=1)
    try:
        record = reach(opened, make_work(opened, [seeded.attempts[0][0]]), state, 1)
        before_rows = counts(opened)["work_decision"]
        before_hash = ledger_hash(opened)
        allowed_from, target = TRANSITIONS[action]

        def attempt() -> WorkRecord:
            return decide(opened, record, action, 50, at=T0 + 9000)

        if state in allowed_from:
            moved = attempt()
            assert moved.state == target
            assert moved.version == record.version + 1
            assert counts(opened)["work_decision"] == before_rows + 1
            last = moved.decisions[-1]
            assert (last.from_state, last.to_state, last.action) == (state, target, action)
        else:
            with pytest.raises(InvalidTransition):
                attempt()
            assert ledger_hash(opened) == before_hash
    finally:
        opened.close()


@pytest.mark.parametrize(
    "path, final",
    [
        (["submit", "reject"], "rejected"),
        (["cancel"], "cancelled"),
        (["block"], "blocked"),
        (["submit"], "awaiting-review"),
        (["submit", "accept"], "accepted"),
        (["submit", "accept", "reopen"], "reopened"),
    ],
)
def test_each_required_case_leaves_audit_rows(
    ledger: tuple[Store, Seeded], path: list[str], final: str
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    for index, action in enumerate(path):
        record = decide(
            store, record, action, index + 1, at=T0 + 2000 + index, note=f"note {action}"
        )
    assert record.state == final
    rows = query(
        store,
        "SELECT seq, action, from_state, to_state, actor, at_ms, note FROM work_decision"
        " WHERE work_id = ? ORDER BY seq",
        record.work_id,
    )
    assert [r[1] for r in rows] == path
    assert [r[0] for r in rows] == list(range(1, len(path) + 1))
    assert all(r[4] == "app-owner" and r[6] == f"note {r[1]}" for r in rows)
    assert rows[-1][3] == final
    assert [r[5] for r in rows] == [T0 + 2000 + i for i in range(len(path))]


def test_cancelled_is_terminal(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = decide(store, make_work(store, [seeded.attempts[0][0]]), "cancel", 1, at=T0 + 2000)
    for number, action in enumerate(ACTIONS):
        with pytest.raises(InvalidTransition):
            decide(store, record, action, 10 + number, at=T0 + 3000)
    with pytest.raises(InvalidTransition):
        link_attempt(
            store,
            record.work_id,
            expected_version=record.version,
            attempt_id=seeded.attempts[0][1],
            now_ms=T0 + 3000,
        )


def test_unblock_returns_to_open(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    blocked = decide(store, record, "block", 1, at=T0 + 2000)
    assert blocked.state == "blocked"
    assert decide(store, blocked, "unblock", 2, at=T0 + 2100).state == "open"


def test_evidence_revision_is_refused_for_actions_that_take_none(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    with pytest.raises(StoreUsageError):
        decide_work(
            store,
            record.work_id,
            action="submit",
            expected_version=record.version,
            request_token=token("submit", 1),
            evidence_revision=record.evidence_revision,
            note=None,
            now_ms=T0 + 2000,
        )


def test_contributors_come_only_from_linked_attempts() -> None:
    forbidden = {"contributors", "contributor", "contributor_ids", "actor", "beneficiary"}
    checked = 0
    for module in (work_module, xp_module):
        for name, function in inspect.getmembers(module, inspect.isfunction):
            if name.startswith("_") or function.__module__ != module.__name__:
                continue
            checked += 1
            parameters = set(inspect.signature(function).parameters)
            assert not parameters & forbidden, (name, parameters & forbidden)
            assert not any(p.startswith("beneficiar") for p in parameters), name
    assert checked >= 12


def test_link_attempt_bumps_the_version_and_refuses_stale_closed_and_frozen(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    with pytest.raises(VersionConflict):
        link_attempt(
            store,
            record.work_id,
            expected_version=5,
            attempt_id=seeded.attempts[0][1],
            now_ms=T0 + 2000,
        )
    with pytest.raises(AttemptAlreadyLinked):
        link_attempt(
            store,
            record.work_id,
            expected_version=record.version,
            attempt_id=seeded.attempts[0][0],
            now_ms=T0 + 2000,
        )
    with pytest.raises(UnknownAttempt):
        link_attempt(
            store,
            record.work_id,
            expected_version=record.version,
            attempt_id="att_" + "0" * 24,
            now_ms=T0 + 2000,
        )
    accepted = submit_and_accept(store, record, 1, at=T0 + 3000)
    with pytest.raises(InvalidTransition):
        link_attempt(
            store,
            record.work_id,
            expected_version=accepted.version,
            attempt_id=seeded.attempts[0][1],
            now_ms=T0 + 4000,
        )
    reopened = decide(store, accepted, "reopen", 3, at=T0 + 5000)
    with pytest.raises(ContributorsFrozen):
        link_attempt(
            store,
            record.work_id,
            expected_version=reopened.version,
            attempt_id=seeded.attempts[1][0],
            now_ms=T0 + 6000,
        )
    same_bot = link_attempt(
        store,
        record.work_id,
        expected_version=reopened.version,
        attempt_id=seeded.attempts[0][1],
        now_ms=T0 + 6000,
    )
    assert same_bot.version == reopened.version + 1
    assert same_bot.updated_ms == T0 + 6000


def test_link_attempt_refuses_a_ninth_contributor_and_a_seventeenth_attempt(
    tmp_path: Path,
) -> None:
    opened, seeded = open_seeded(tmp_path, bots=9, per_bot=4)
    try:
        eight = [seeded.attempts[b][0] for b in range(8)]
        record = make_work(opened, eight)
        with pytest.raises(LimitReached):
            link_attempt(
                opened,
                record.work_id,
                expected_version=record.version,
                attempt_id=seeded.attempts[8][0],
                now_ms=T0 + 2000,
            )
        version = record.version
        for index in range(8):
            linked = link_attempt(
                opened,
                record.work_id,
                expected_version=version,
                attempt_id=seeded.attempts[index][1],
                now_ms=T0 + 2000 + index,
            )
            version = linked.version
        assert len(linked.attempts) == 16
        with pytest.raises(LimitReached):
            link_attempt(
                opened,
                record.work_id,
                expected_version=version,
                attempt_id=seeded.attempts[0][2],
                now_ms=T0 + 3000,
            )
    finally:
        opened.close()


def test_get_work_refuses_an_unknown_item(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    with pytest.raises(UnknownWork):
        get_work(store, "wrk_" + "d" * 24)


def test_list_work_pages_newest_first_with_a_stable_tie_break(
    ledger: tuple[Store, Seeded],
) -> None:
    store, _ = ledger
    made = [make_work(store, [], n, at=T0 + 1000 + (n // 2)) for n in range(1, 6)]
    page = list_work(store, state=None, binding_id=None, cursor=None, limit=2)
    assert len(page.items) == 2 and page.next_cursor is not None
    seen = list(page.items)
    while page.next_cursor is not None:
        page = list_work(store, state=None, binding_id=None, cursor=page.next_cursor, limit=2)
        seen.extend(page.items)
    assert {r.work_id for r in seen} == {m.work_id for m in made}
    assert len(seen) == 5
    order = [(r.created_ms, r.work_id) for r in seen]
    assert order == sorted(order, reverse=True)


def test_list_work_filters_by_state_and_binding(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    mine = make_work(store, [seeded.attempts[0][0]], 1)
    other = make_work(store, [seeded.attempts[1][0]], 2)
    decide(store, other, "block", 1, at=T0 + 2000)
    assert [
        r.work_id
        for r in list_work(store, state="blocked", binding_id=None, cursor=None, limit=None).items
    ] == [other.work_id]
    only_mine = list_work(store, state=None, binding_id=seeded.bindings[0], cursor=None, limit=None)
    assert [r.work_id for r in only_mine.items] == [mine.work_id]
    assert list_work(store, state="accepted", binding_id=None, cursor=None, limit=None).items == ()
    with pytest.raises(UnknownBinding):
        list_work(store, state=None, binding_id="bnd_" + "0" * 24, cursor=None, limit=None)


def test_list_work_clamps_the_limit_and_refuses_bad_cursors(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    for n in range(30):
        make_work(store, [], n + 1, at=T0 + 1000 + n)
    big = list_work(store, state=None, binding_id=None, cursor=None, limit=100)
    assert len(big.items) == 25 and big.next_cursor is not None
    assert len(list_work(store, state=None, binding_id=None, cursor=None, limit=0).items) == 1
    for bad in (
        "not-a-cursor",
        "",
        "AAAA",
        encode_cursor([5, "wrk_nope"]),
        encode_cursor([-1, "wrk_" + "a" * 24]),
        encode_cursor(["5", "wrk_" + "a" * 24]),
    ):
        with pytest.raises(InvalidCursor):
            list_work(store, state=None, binding_id=None, cursor=bad, limit=None)


def test_a_record_shows_the_newest_fifty_decisions_oldest_first(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    for cycle in range(30):
        record = decide(store, record, "block", cycle, at=T0 + 2000 + 2 * cycle)
        record = decide(store, record, "unblock", cycle, at=T0 + 2001 + 2 * cycle)
    assert counts(store)["work_decision"] == 60
    seqs = [d.seq for d in record.decisions]
    assert seqs == list(range(11, 61))
    assert get_work(store, record.work_id).decisions == record.decisions


def test_text_is_normalised_trimmed_and_checked(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    composed = unicodedata.normalize("NFC", "Caf\u00e9")
    decomposed = "  Cafe\u0301  "
    record = raw_create(
        store, title=decomposed, acceptance_condition="\n Line one.\nLine two. \n"
    ).record
    assert record.title == composed
    assert record.acceptance_condition == "Line one.\nLine two."
    again = raw_create(store, title=composed, acceptance_condition="Line one.\nLine two.")
    assert again.created is False and again.record.work_id == record.work_id


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"title": "x" * 121},
        {"title": "two\nlines"},
        {"title": "bell\x07"},
        {"title": "tab\tbed"},
        {"title": "del\x7f"},
        {"title": "a\x00b"},
        {"title": "lone \ud800 surrogate"},
        {"title": 5},
        {"acceptance_condition": ""},
        {"acceptance_condition": "y" * 281},
        {"acceptance_condition": "carriage\r\nreturn"},
        {"acceptance_condition": "bell\x07"},
        {"milestones": ["ok", "has\nnewline"]},
        {"milestones": ["z" * 81]},
        {"milestones": ["  "]},
    ],
)
def test_text_the_wire_could_not_carry_is_refused_at_the_store(
    ledger: tuple[Store, Seeded], changes: dict[str, Any]
) -> None:
    store, _ = ledger
    with pytest.raises(StoreUsageError):
        raw_create(store, **changes)
    assert counts(store)["work_item"] == 0


def test_text_at_the_limits_in_code_points_is_accepted(ledger: tuple[Store, Seeded]) -> None:
    store, _ = ledger
    record = raw_create(
        store,
        title="\u4e16" * 120,
        acceptance_condition="\U0001f600" * 140 + "\n" + "z" * 139,
        milestones=["m" * 80],
    ).record
    assert len(record.title) == 120
    assert len(record.acceptance_condition) == 280


def test_an_empty_note_is_stored_and_returned_as_null(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    blocked = decide(store, record, "block", 1, at=T0 + 2000, note="  \n ")
    assert blocked.decisions[-1].note is None
    unblocked = decide(store, blocked, "unblock", 2, at=T0 + 2100, note="  waiting for\nreview  ")
    assert unblocked.decisions[-1].note == "waiting for\nreview"
    assert query(store, "SELECT note FROM work_decision ORDER BY seq") == [
        (None,),
        ("waiting for\nreview",),
    ]


@pytest.mark.parametrize("note", ["x" * 281, "bell\x07", "tab\t", "lone \ud800", 7])
def test_a_bad_note_is_a_usage_error(ledger: tuple[Store, Seeded], note: Any) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]])
    with pytest.raises(StoreUsageError):
        decide(store, record, "block", 1, at=T0 + 2000, note=note)


BAD_CALLS: dict[str, Callable[[Store, WorkRecord, Seeded], Any]] = {
    "create token": lambda s, r, d: raw_create(s, request_token="short"),
    "create token characters": lambda s, r, d: raw_create(s, request_token="bad token!!!"),
    "create rewardable": lambda s, r, d: raw_create(s, rewardable="yes"),
    "create rewardable as an int": lambda s, r, d: raw_create(s, rewardable=1),
    "create parent": lambda s, r, d: raw_create(s, parent_id="parent"),
    "create attempt id": lambda s, r, d: raw_create(s, attempt_ids=["att_nope"]),
    "create duplicate attempt": lambda s, r, d: raw_create(
        s, attempt_ids=[d.attempts[0][0], d.attempts[0][0]]
    ),
    "create attempts as a string": lambda s, r, d: raw_create(s, attempt_ids="att_" + "0" * 24),
    "create milestones as a string": lambda s, r, d: raw_create(s, milestones="abc"),
    "create time negative": lambda s, r, d: raw_create(s, now_ms=-1),
    "create time bool": lambda s, r, d: raw_create(s, now_ms=True),
    "link work id": lambda s, r, d: link_attempt(
        s, "wrk_x", expected_version=1, attempt_id=d.attempts[1][0], now_ms=T0
    ),
    "link attempt id": lambda s, r, d: link_attempt(
        s, r.work_id, expected_version=1, attempt_id="att_x", now_ms=T0
    ),
    "link version zero": lambda s, r, d: link_attempt(
        s, r.work_id, expected_version=0, attempt_id=d.attempts[1][0], now_ms=T0
    ),
    "link version bool": lambda s, r, d: link_attempt(
        s, r.work_id, expected_version=True, attempt_id=d.attempts[1][0], now_ms=T0
    ),
    "milestone position bool": lambda s, r, d: set_milestone(
        s, r.work_id, expected_version=1, position=True, done=True, now_ms=T0
    ),
    "milestone position text": lambda s, r, d: set_milestone(
        s,
        r.work_id,
        expected_version=1,
        position=cast(Any, "1"),
        done=True,
        now_ms=T0,
    ),
    "milestone done text": lambda s, r, d: set_milestone(
        s,
        r.work_id,
        expected_version=1,
        position=1,
        done=cast(Any, "yes"),
        now_ms=T0,
    ),
    "milestone unknown position": lambda s, r, d: set_milestone(
        s, r.work_id, expected_version=1, position=7, done=True, now_ms=T0
    ),
    "decide action": lambda s, r, d: decide_work(
        s,
        r.work_id,
        action="approve",
        expected_version=1,
        request_token=token("x", 1),
        evidence_revision=None,
        note=None,
        now_ms=T0,
    ),
    "decide token": lambda s, r, d: decide_work(
        s,
        r.work_id,
        action="submit",
        expected_version=1,
        request_token="no",
        evidence_revision=None,
        note=None,
        now_ms=T0,
    ),
    "decide revision shape": lambda s, r, d: decide_work(
        s,
        r.work_id,
        action="accept",
        expected_version=1,
        request_token=token("x", 1),
        evidence_revision="XYZ",
        note=None,
        now_ms=T0,
    ),
    "decide version": lambda s, r, d: decide_work(
        s,
        r.work_id,
        action="submit",
        expected_version=0,
        request_token=token("x", 1),
        evidence_revision=None,
        note=None,
        now_ms=T0,
    ),
    "decide work id": lambda s, r, d: decide_work(
        s,
        "wrk_x",
        action="submit",
        expected_version=1,
        request_token=token("x", 1),
        evidence_revision=None,
        note=None,
        now_ms=T0,
    ),
    "get work id": lambda s, r, d: get_work(s, "wrk_x"),
    "list state": lambda s, r, d: list_work(
        s, state="weird", binding_id=None, cursor=None, limit=None
    ),
    "list binding": lambda s, r, d: list_work(
        s, state=None, binding_id="bnd_x", cursor=None, limit=None
    ),
}


@pytest.mark.parametrize("name", sorted(BAD_CALLS))
def test_bad_arguments_are_usage_errors_not_data_errors(
    ledger: tuple[Store, Seeded], name: str
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[2][0]], 77, milestones=["one"])
    before = ledger_hash(store)
    with pytest.raises(StoreUsageError):
        BAD_CALLS[name](store, record, seeded)
    assert ledger_hash(store) == before
