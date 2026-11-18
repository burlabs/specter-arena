"""FP-02-AC04 producer test for the five work and XP contracts.

Bodies come from the real wire builders over real store records (the real `Store`, real ingest,
real decisions) and, for the service tests below, from the real `WorkService` and the signed
routes. Each body is validated with the same validator the case runner uses. A constant
dictionary here would prove nothing about the service.
"""

import re
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

import fastjsonschema
import pytest
from starlette.testclient import TestClient

from backend.specter_arena.store import (
    Page,
    Store,
    WorkDecisionView,
    WorkRecord,
    WorkReview,
    XpEntryView,
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
from backend.specter_arena.work import wire

from .contract_support import compile_schema, load_registry
from .work_api_fakes import SIGNING_VALUE, Api, WorkRig, build_rig, run
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


def work_item_body(record: WorkRecord) -> dict[str, Any]:
    return cast(dict[str, Any], wire.work_item_wire(record))


def work_items_body(page: Page[WorkRecord], as_of_ms: int) -> dict[str, Any]:
    return cast(dict[str, Any], wire.work_items_wire(page, as_of_ms))


def xp_summary_body(summary: XpSummary) -> dict[str, Any]:
    return cast(dict[str, Any], wire.xp_summary_wire(summary))


def xp_summaries_body(items: tuple[XpSummary, ...], as_of_ms: int) -> dict[str, Any]:
    return cast(dict[str, Any], wire.xp_summaries_wire(items, as_of_ms))


def xp_history_body(history: XpHistory, as_of_ms: int) -> dict[str, Any]:
    return cast(dict[str, Any], wire.xp_history_wire(history, as_of_ms))


def check(schema: str, body: Any) -> None:
    compile_schema(IDS[schema], REGISTRY)(body)


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
    body = xp_history_body(history, AS_OF)
    check("xp-history", body)
    assert [e["amount"] for e in body["items"]] == [-100, 100]
    again = submit_and_accept(store, reopened, 4, at=T0 + 4000)
    check("work-item", work_item_body(again))
    after = xp_history_body(xp_history(store, seeded.bindings[0], cursor=None, limit=None), AS_OF)
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
    check("work-items", work_items_body(page, AS_OF))
    last = list_work(store, state=None, binding_id=None, cursor=page.next_cursor, limit=25)
    check("work-items", work_items_body(last, AS_OF))
    empty = list_work(store, state="rejected", binding_id=None, cursor=None, limit=None)
    check("work-items", work_items_body(empty, AS_OF))
    assert work_item_body(get_work(store, tracked.work_id))["bountyXp"] == 0


def test_summaries_and_history_pages_match(ledger: tuple[Store, Seeded]) -> None:
    store, seeded = ledger
    check("xp-summaries", xp_summaries_body(xp_summaries(store), AS_OF))
    for number in range(1, 4):
        record = make_work(store, [seeded.attempts[0][number], seeded.attempts[1][number]], number)
        submit_and_accept(store, record, number, at=T0 + 2000 * number)
    listed = xp_summaries(store)
    body = xp_summaries_body(listed, AS_OF)
    check("xp-summaries", body)
    assert len(body["items"]) == 2
    for item in listed:
        check("xp-summary", xp_summary_body(item))
    check("xp-summary", xp_summary_body(xp_summary(store, seeded.bindings[8])))
    first = xp_history(store, seeded.bindings[0], cursor=None, limit=2)
    check("xp-history", xp_history_body(first, AS_OF))
    assert first.page.next_cursor is not None
    second = xp_history(store, seeded.bindings[0], cursor=first.page.next_cursor, limit=2)
    check("xp-history", xp_history_body(second, AS_OF))
    empty = xp_history(store, seeded.bindings[8], cursor=None, limit=None)
    check("xp-history", xp_history_body(empty, AS_OF))


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


def test_the_validator_would_refuse_a_body_the_builders_got_wrong(
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


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[WorkRig]:
    made = build_rig(tmp_path)
    try:
        yield made
    finally:
        made.store.close()


def service_bodies(made: WorkRig) -> dict[str, list[dict[str, Any]]]:
    """Every body the service produces over one accepted, reopened and re-accepted item."""
    first, second = made.seeded.attempts[0][0], made.seeded.attempts[1][0]
    _, item = run(
        made.service.create_work(
            {
                "requestId": token("create", 1),
                "title": "Write the release notes",
                "acceptanceCondition": "The owner read them.\nAnd agrees.",
                "rewardable": True,
                "attemptIds": [first, second],
                "milestones": ["Outline", "Draft"],
            }
        )
    )
    bodies: dict[str, list[dict[str, Any]]] = {"work-item": [item]}
    for n, action in enumerate(("submit", "accept", "reopen", "submit", "accept"), start=1):
        current = bodies["work-item"][-1]
        needs = action == "accept"
        request: dict[str, Any] = {
            "requestId": token(action, n),
            "expectedVersion": current["version"],
            "action": action,
        }
        if needs:
            request["evidenceRevision"] = current["evidenceRevision"]
        made.clock.now += 10
        bodies["work-item"].append(run(made.service.decide(item["workId"], request)))
    bodies["work-items"] = [
        run(made.service.list_work(state=None, binding_id=None, cursor=None, limit=None))
    ]
    bodies["xp-summaries"] = [run(made.service.xp_summaries())]
    bodies["xp-summary"] = bodies["xp-summaries"][0]["items"]
    bodies["xp-history"] = [
        run(made.service.xp_history(binding, cursor=None, limit=None))
        for binding in made.seeded.bindings
    ]
    return bodies


def test_every_body_the_service_returns_matches_its_contract(rig: WorkRig) -> None:
    bodies = service_bodies(rig)
    for name, produced in bodies.items():
        assert produced, name
        for body in produced:
            check(name, body)
    assert [b["state"] for b in bodies["work-item"]][-1] == "accepted"
    assert [e["kind"] for e in bodies["xp-history"][0]["items"]] == [
        "reinstatement",
        "correction",
        "award",
    ]


def test_a_route_error_body_matches_api_error(
    rig: WorkRig, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SIGNING_VALUE)
    with TestClient(rig.app) as client:
        api = Api(client)
        for response in (
            api.get("/api/work/wrk_" + "f" * 24),
            api.get("/api/work?state=nope"),
            api.post("/api/work", {"nope": 1}),
            api.call("GET", "/api/xp", sign=False),
        ):
            assert response.status_code >= 400
            compile_schema("urn:specter-arena:contract:api-error:v1", REGISTRY)(response.json())


def test_the_emitted_keys_are_exactly_the_contract_keys_and_no_denied_word(rig: WorkRig) -> None:
    denied = {"class", "classes", "archetype", "species", "category", "taxonomy"}
    denied |= {"tier", "rank", "rarity", "role", "score", "percent", "percentage"}
    for name, produced in service_bodies(rig).items():
        schema_keys = set(REGISTRY[IDS[name]]["properties"])
        for body in produced:
            assert set(body) == schema_keys, name
            for key in all_keys(body):
                assert not denied & {word.lower() for word in re.findall(r"[A-Z]?[a-z]+", key)}


def all_keys(value: Any) -> Iterator[str]:
    if isinstance(value, dict):
        for key, inner in value.items():
            yield key
            yield from all_keys(inner)
    elif isinstance(value, list):
        for inner in value:
            yield from all_keys(inner)


def record_of(rig: WorkRig) -> WorkRecord:
    return make_work(rig.store, [rig.seeded.attempts[0][0]], 1, milestones=["One", "Two"])


def test_a_missing_attempt_has_no_times_and_is_never_ended(rig: WorkRig) -> None:
    record = record_of(rig)
    ghost = replace(
        record.attempts[0],
        present=False,
        started_ms=5,
        ended_ms=9,
        end_signal="row-idle",
        ended=True,
    )
    wire = work_item_body(replace(record, attempts=(ghost,)))
    assert wire["attempts"] == [
        {
            "attemptId": ghost.attempt_id,
            "bindingId": ghost.binding_id,
            "kind": ghost.kind,
            "startedMs": None,
            "endedMs": None,
            "endSignal": None,
            "ended": False,
            "present": False,
        }
    ]
    check("work-item", wire)


def test_a_value_that_does_not_match_its_pattern_becomes_unknown(rig: WorkRig) -> None:
    record = record_of(rig)
    odd_attempt = replace(record.attempts[0], kind="Bad Kind!", end_signal="free text")
    decision = WorkDecisionView(
        "dec_" + "a" * 24, 1, "Do It", "Open!", "x" * 40, "app-owner", 5, None, None
    )
    wire = work_item_body(
        replace(record, state="Awaiting Review", attempts=(odd_attempt,), decisions=(decision,))
    )
    assert wire["state"] == "unknown"
    attempt = wire["attempts"][0]
    assert (attempt["kind"], attempt["endSignal"]) == ("unknown", None)
    shown = wire["decisions"][0]
    assert (shown["action"], shown["fromState"], shown["toState"]) == ("unknown",) * 3
    entry = XpEntryView(
        "xpe_" + "a" * 24, record.work_id, "t", "Odd Kind", 5, "xp-policy-1", "dec_x", 1
    )
    history = XpHistory(
        XpSummary("bnd_" + "a" * 24, 5, 1, 0, 100, 1, "xp-policy-1", "levels-1"),
        Page((entry,), None),
    )
    assert xp_history_body(history, AS_OF)["items"][0]["kind"] == "unknown"


def test_can_accept_needs_the_store_flag_and_an_empty_blocker_list(rig: WorkRig) -> None:
    record = record_of(rig)
    cases = [
        (WorkReview(True, ()), True, []),
        (WorkReview(False, ("wrong-state",)), False, ["wrong-state"]),
        (WorkReview(True, ("Bad Blocker",)), False, []),
        (WorkReview(False, ("Bad Blocker", "no-evidence")), False, ["no-evidence"]),
        (
            WorkReview(False, tuple(f"blocker-{n}" for n in range(12))),
            False,
            [f"blocker-{n}" for n in range(8)],
        ),
    ]
    for review, can_accept, blockers in cases:
        wire = work_item_body(replace(record, review=review))
        assert wire["review"] == {"canAccept": can_accept, "blockers": blockers}
        check("work-item", wire)


def test_progress_is_null_without_milestones_and_never_a_percentage(rig: WorkRig) -> None:
    record = record_of(rig)
    assert work_item_body(replace(record, milestones=(), progress=None))["progress"] is None
    wire = work_item_body(record)
    assert wire["progress"] == {"done": 0, "total": 2}
    assert "percent" not in str(wire).lower()


def test_decisions_over_fifty_keep_the_newest_fifty_oldest_first(rig: WorkRig) -> None:
    record = record_of(rig)
    many = tuple(
        WorkDecisionView(f"dec_{n:024x}", n, "block", "open", "blocked", "app-owner", n, None, None)
        for n in range(1, 61)
    )
    wire = work_item_body(replace(record, decisions=many))
    seqs = [d["seq"] for d in wire["decisions"]]
    assert seqs == list(range(11, 61))
    check("work-item", wire)


LEVELS = [
    (0, 1, 0, 100),
    (99, 1, 0, 100),
    (100, 2, 100, 250),
    (249, 2, 100, 250),
    (250, 3, 250, 450),
    (999, 5, 700, 1000),
    (1000, 6, 1000, 1400),
    (3199, 9, 2500, 3200),
    (3200, 10, 3200, None),
    (10000, 10, 3200, None),
]


@pytest.mark.parametrize(("total", "level", "floor", "following"), LEVELS)
def test_level_boundaries(total: int, level: int, floor: int, following: int | None) -> None:
    from backend.specter_arena.store.xp_policy import LEVEL_TABLE_VERSION, POLICY_VERSION, level_for

    got_level, got_floor, got_next = level_for(total)
    summary = XpSummary(
        "bnd_" + "a" * 24,
        total,
        got_level,
        got_floor,
        got_next,
        1,
        POLICY_VERSION,
        LEVEL_TABLE_VERSION,
    )
    wire = xp_summary_body(summary)
    assert (wire["level"], wire["levelFloorXp"], wire["nextLevelXp"]) == (level, floor, following)
    check("xp-summary", wire)


def test_a_summary_page_and_a_work_page_keep_the_stores_cursor(rig: WorkRig) -> None:
    items = tuple(make_work(rig.store, [], n) for n in range(1, 4))
    page = Page(items, "cursor-token")
    wire = work_items_body(page, AS_OF)
    assert wire["nextCursor"] == "cursor-token" and len(wire["items"]) == 3
    assert xp_summaries_body((), AS_OF)["items"] == []
