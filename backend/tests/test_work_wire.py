"""FP-02-AC04 producer test for the five work and XP contracts.

Bodies are built by local mappers from real store records (the real `Store`, real ingest, real
decisions) and validated with the same validator the case runner uses. The mappers follow the
field table in the work-ledger changeset; the PR that adds the service replaces them with the
service's own bodies. A constant dictionary here would prove nothing about the store.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import fastjsonschema
import pytest

from backend.specter_arena.attempts_view import end_signal_wire
from backend.specter_arena.store import (
    Store,
    WorkRecord,
    XpHistory,
    XpSummary,
    create_work,
    decide_work,
    get_work,
    list_work,
    xp_history,
    xp_summaries,
    xp_summary,
)

from .contract_support import compile_schema, load_registry
from .work_fakes import (
    T0,
    Seeded,
    bot_turn_attempt,
    decide,
    make_work,
    open_seeded,
    submit_and_accept,
    token,
    worker_attempt,
)

REGISTRY = load_registry()
IDS = {
    "work-item": "urn:specter-arena:contract:work-item:v1",
    "work-items": "urn:specter-arena:contract:work-items:v1",
    "xp-summary": "urn:specter-arena:contract:xp-summary:v1",
    "xp-summaries": "urn:specter-arena:contract:xp-summaries:v1",
    "xp-history": "urn:specter-arena:contract:xp-history:v1",
}
AS_OF = T0 + 90_000


def check(schema: str, body: Any) -> None:
    compile_schema(IDS[schema], REGISTRY)(body)


def work_item_body(record: WorkRecord) -> dict[str, Any]:
    return {
        "contractVersion": 1,
        "workId": record.work_id,
        "parentId": record.parent_id,
        "title": record.title,
        "acceptanceCondition": record.acceptance_condition,
        "rewardable": record.rewardable,
        "bountyXp": record.bounty_xp,
        "policyVersion": record.policy_version,
        "state": record.state,
        "version": record.version,
        "createdAtMs": record.created_ms,
        "updatedAtMs": record.updated_ms,
        "attempts": [
            {
                "attemptId": a.attempt_id,
                "bindingId": a.binding_id,
                "kind": a.kind,
                "startedMs": a.started_ms,
                "endedMs": a.ended_ms,
                "endSignal": end_signal_wire(a.end_signal),
                "ended": a.ended,
                "present": a.present,
            }
            for a in record.attempts
        ],
        "contributors": [
            {"bindingId": c.binding_id, "attemptCount": c.attempt_count, "xpNet": c.xp_net}
            for c in record.contributors
        ],
        "milestones": [
            {"position": m.position, "label": m.label, "doneAtMs": m.done_ms}
            for m in record.milestones
        ],
        "progress": (
            None
            if record.progress is None
            else {"done": record.progress.done, "total": record.progress.total}
        ),
        "evidenceRevision": record.evidence_revision,
        "childCount": record.child_count,
        "childrenAccepted": record.children_accepted,
        "review": {"canAccept": record.review.can_accept, "blockers": list(record.review.blockers)},
        "decisions": [
            {
                "decisionId": d.decision_id,
                "seq": d.seq,
                "action": d.action,
                "fromState": d.from_state,
                "toState": d.to_state,
                "actor": d.actor,
                "atMs": d.at_ms,
                "note": d.note,
                "evidenceRevision": d.evidence_revision,
            }
            for d in record.decisions
        ],
    }


def work_items_body(items: tuple[WorkRecord, ...], next_cursor: str | None) -> dict[str, Any]:
    return {
        "contractVersion": 1,
        "items": [work_item_body(r) for r in items],
        "nextCursor": next_cursor,
        "asOfMs": AS_OF,
    }


def xp_summary_body(summary: XpSummary) -> dict[str, Any]:
    return {
        "contractVersion": 1,
        "bindingId": summary.binding_id,
        "totalXp": summary.total_xp,
        "level": summary.level,
        "levelTableVersion": summary.level_table_version,
        "levelFloorXp": summary.level_floor_xp,
        "nextLevelXp": summary.next_level_xp,
        "acceptedWorkCount": summary.accepted_work_count,
        "policyVersion": summary.policy_version,
    }


def xp_summaries_body(items: tuple[XpSummary, ...]) -> dict[str, Any]:
    return {"contractVersion": 1, "items": [xp_summary_body(s) for s in items], "asOfMs": AS_OF}


def xp_history_body(history: XpHistory) -> dict[str, Any]:
    return {
        "contractVersion": 1,
        "bindingId": history.summary.binding_id,
        "summary": xp_summary_body(history.summary),
        "items": [
            {
                "entryId": e.entry_id,
                "workId": e.work_id,
                "workTitle": e.work_title,
                "kind": e.kind,
                "amount": e.amount,
                "policyVersion": e.policy_version,
                "decisionId": e.decision_id,
                "createdAtMs": e.created_ms,
            }
            for e in history.page.items
        ],
        "nextCursor": history.page.next_cursor,
        "asOfMs": AS_OF,
    }


@pytest.fixture
def ledger(tmp_path: Path) -> Iterator[tuple[Store, Seeded]]:
    opened, seeded = open_seeded(tmp_path, bots=9, per_bot=4)
    try:
        yield opened, seeded
    finally:
        opened.close()


def test_a_fresh_item_and_an_accepted_item_with_two_contributors_match_their_contracts(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    fresh = make_work(
        store, [seeded.attempts[0][0], seeded.attempts[1][0]], 1, milestones=["Outline", "Draft"]
    )
    check("work-item", work_item_body(fresh))
    accepted = submit_and_accept(store, fresh, 1, at=T0 + 2000)
    body = work_item_body(accepted)
    check("work-item", body)
    assert sorted(c["xpNet"] for c in body["contributors"]) == [50, 50]
    assert body["decisions"][-1]["actor"] == "app-owner"
    assert body["progress"] == {"done": 0, "total": 2}


def test_a_reopened_item_with_a_negative_history_entry_matches(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    accepted = submit_and_accept(
        store, make_work(store, [seeded.attempts[0][0]], 1), 1, at=T0 + 2000
    )
    reopened = decide(store, accepted, "reopen", 3, at=T0 + 3000, note="The notes missed a step.")
    check("work-item", work_item_body(reopened))
    history = xp_history(store, seeded.bindings[0], cursor=None, limit=None)
    body = xp_history_body(history)
    check("xp-history", body)
    assert [e["amount"] for e in body["items"]] == [-100, 100]
    again = submit_and_accept(store, reopened, 4, at=T0 + 4000)
    check("work-item", work_item_body(again))
    after = xp_history_body(xp_history(store, seeded.bindings[0], cursor=None, limit=None))
    check("xp-history", after)
    assert [e["kind"] for e in after["items"]] == ["reinstatement", "correction", "award"]


def test_an_item_with_no_milestones_has_null_progress_and_an_empty_note_is_null(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]], 1)
    blocked = decide(store, record, "block", 1, at=T0 + 2000, note="   ")
    body = work_item_body(blocked)
    check("work-item", body)
    assert body["progress"] is None
    assert body["decisions"][0]["note"] is None


def test_a_container_with_children_and_an_unlinked_container_match(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    parent = make_work(store, [], 1)
    first = make_work(store, [seeded.attempts[0][0]], 2, parent_id=parent.work_id)
    make_work(store, [seeded.attempts[1][0]], 3, parent_id=parent.work_id)
    check("work-item", work_item_body(get_work(store, parent.work_id)))
    submit_and_accept(store, first, 1, at=T0 + 2000)
    container = get_work(store, parent.work_id)
    body = work_item_body(container)
    check("work-item", body)
    assert (body["childCount"], body["childrenAccepted"], body["attempts"]) == (2, 1, [])
    assert body["review"]["blockers"] == ["wrong-state", "children-not-accepted"]
    check("work-item", work_item_body(get_work(store, first.work_id)))


def test_a_missing_attempt_and_a_chat_done_attempt_match(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    ended = bot_turn_attempt(store, 0, end="chat-done", turn=3, ms=T0 + 700)
    running = worker_attempt(store, 1, 901, ended=False)
    record = make_work(store, [ended, running, seeded.attempts[2][0]], 1)
    with store.write() as conn:
        conn.execute("DELETE FROM attempt WHERE attempt_id = ?", (seeded.attempts[2][0],))
    body = work_item_body(get_work(store, record.work_id))
    check("work-item", body)
    by_id = {a["attemptId"]: a for a in body["attempts"]}
    assert by_id[ended]["endSignal"] == "chat-done"
    assert by_id[running]["ended"] is False
    assert by_id[seeded.attempts[2][0]]["present"] is False
    assert by_id[seeded.attempts[2][0]]["startedMs"] is None


def test_the_limits_of_the_contract_are_producible(tmp_path: Path) -> None:
    store, seeded = open_seeded(tmp_path, bots=8, per_bot=2)
    try:
        sixteen = [a for per_bot in seeded.attempts for a in per_bot]
        record = make_work(
            store,
            sixteen,
            1,
            milestones=[f"Step {n}" for n in range(1, 9)],
            title="\u00e9\u4e16 <angle> " + "t" * 90,
            condition="Line one.\nLine two with <brackets> and \u00fcmlauts.",
        )
        body = work_item_body(record)
        check("work-item", body)
        assert (len(body["attempts"]), len(body["contributors"]), len(body["milestones"])) == (
            16,
            8,
            8,
        )
    finally:
        store.close()


def test_a_record_with_more_than_fifty_decisions_still_matches(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]], 1)
    for cycle in range(30):
        record = decide(store, record, "block", cycle, at=T0 + 2000 + 2 * cycle)
        record = decide(store, record, "unblock", cycle, at=T0 + 2001 + 2 * cycle)
    body = work_item_body(record)
    check("work-item", body)
    assert len(body["decisions"]) == 50
    assert body["decisions"][0]["seq"] == 11


def test_not_rewardable_items_and_the_list_page_match(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    tracked = make_work(store, [seeded.attempts[0][0]], 1, rewardable=False, at=T0 + 1000)
    make_work(store, [seeded.attempts[1][0]], 2, at=T0 + 2000)
    submit_and_accept(store, tracked, 1, at=T0 + 3000)
    page = list_work(store, state=None, binding_id=None, cursor=None, limit=1)
    assert page.next_cursor is not None
    check("work-items", work_items_body(page.items, page.next_cursor))
    last = list_work(store, state=None, binding_id=None, cursor=page.next_cursor, limit=25)
    check("work-items", work_items_body(last.items, last.next_cursor))
    empty = list_work(store, state="rejected", binding_id=None, cursor=None, limit=None)
    check("work-items", work_items_body(empty.items, empty.next_cursor))
    assert work_item_body(get_work(store, tracked.work_id))["bountyXp"] == 0


def test_summaries_and_history_pages_match(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    check("xp-summaries", xp_summaries_body(xp_summaries(store)))
    for number in range(1, 4):
        record = make_work(store, [seeded.attempts[0][number], seeded.attempts[1][number]], number)
        submit_and_accept(store, record, number, at=T0 + 2000 * number)
    listed = xp_summaries(store)
    body = xp_summaries_body(listed)
    check("xp-summaries", body)
    assert len(body["items"]) == 2
    for item in listed:
        check("xp-summary", xp_summary_body(item))
    check("xp-summary", xp_summary_body(xp_summary(store, seeded.bindings[8])))
    first = xp_history(store, seeded.bindings[0], cursor=None, limit=2)
    check("xp-history", xp_history_body(first))
    assert first.page.next_cursor is not None
    second = xp_history(store, seeded.bindings[0], cursor=first.page.next_cursor, limit=2)
    check("xp-history", xp_history_body(second))
    empty = xp_history(store, seeded.bindings[8], cursor=None, limit=None)
    check("xp-history", xp_history_body(empty))


def test_every_replayed_decision_body_matches(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    record = make_work(store, [seeded.attempts[0][0]], 1)
    created = create_work(
        store,
        request_token=token("create", 1),
        title=record.title,
        acceptance_condition=record.acceptance_condition,
        rewardable=True,
        parent_id=None,
        attempt_ids=[seeded.attempts[0][0]],
        milestones=[],
        now_ms=T0 + 9000,
    )
    assert created.created is False
    check("work-item", work_item_body(created.record))
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
    replay = decide_work(
        store,
        record.work_id,
        action="block",
        expected_version=record.version,
        request_token=token("block", 1),
        evidence_revision=None,
        note=None,
        now_ms=T0 + 3000,
    )
    assert replay.replayed is True
    check("work-item", work_item_body(replay.record))
    assert work_item_body(replay.record) == work_item_body(first.record)


def test_the_validator_would_refuse_a_body_the_mappers_got_wrong(
    ledger: tuple[Store, Seeded],
) -> None:
    store, seeded = ledger
    body = work_item_body(make_work(store, [seeded.attempts[0][0]], 1))
    with pytest.raises(fastjsonschema.JsonSchemaException):
        check("work-item", {**body, "percent": 40})
    with pytest.raises(fastjsonschema.JsonSchemaException):
        check("work-item", {**body, "state": "Awaiting Review"})
    summary = xp_summary_body(xp_summary(store, seeded.bindings[0]))
    with pytest.raises(fastjsonschema.JsonSchemaException):
        check("xp-summary", {**summary, "totalXp": -1})
