"""WorkService over the real store: strict validation, the error table, the lifecycle, replays,
refusals that write nothing, and concurrent acceptance (FP0809-CI-01, FP0809-CI-04, FP0809-CI-05,
FP-08-AC03, FP-08-AC04, FP-08-AC06, FP-09-AC01)."""

import asyncio
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any, cast

import pytest

from backend.specter_arena.store import Store
from backend.specter_arena.store import errors as store_errors
from backend.specter_arena.store import work as db_work
from backend.specter_arena.store.dmkey import build_dm_key
from backend.specter_arena.work.service import WorkError, WorkService

from .specter_fakes import FakeClock
from .work_api_fakes import WorkRig, build_rig, run
from .work_fakes import (
    T0,
    dm_key_of,
    ledger_hash,
    observe,
    query,
    send,
    token,
    worker_attempt,
)

BINDING_FAR = "bnd_" + "f" * 24
WORK_FAR = "wrk_" + "f" * 24
ATTEMPT_OK = "att_" + "a" * 24
REVISION = "0" * 24
BIG = 2**53


def untouchable() -> Store:
    """A stand-in for a store that no test below may reach."""
    return cast(Store, object())


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[WorkRig]:
    made = build_rig(tmp_path)
    try:
        yield made
    finally:
        made.store.close()


@pytest.fixture
def spied(monkeypatch: pytest.MonkeyPatch) -> WorkService:
    """A service whose store must never be reached: validation has to refuse first."""
    service = WorkService(untouchable(), clock=FakeClock())

    async def unreachable(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("the store was reached")

    monkeypatch.setattr(service, "_call", unreachable)
    return service


def create_body(n: int = 1, **changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "requestId": token("create", n),
        "title": "Write the release notes",
        "acceptanceCondition": "The owner read them and agrees.",
        "rewardable": True,
        "attemptIds": [],
        "milestones": [],
    }
    body.update(changes)
    return body


def decision_body(
    kind: str, version: int, n: int = 1, revision: str | None = None, **changes: Any
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "requestId": token(kind, n),
        "expectedVersion": version,
        "action": kind,
    }
    if revision is not None:
        body["evidenceRevision"] = revision
    body.update(changes)
    return body


def refused(call: Any) -> WorkError:
    with pytest.raises(WorkError) as caught:
        run(call)
    return caught.value


def without(body: dict[str, Any], key: str) -> dict[str, Any]:
    return {k: v for k, v in body.items() if k != key}


def code_of(error: WorkError) -> tuple[str, int]:
    return error.code, error.status


INVALID = ("invalid_body", 400)
NO_WORK = ("unknown_work", 404)
NO_ATTEMPT = ("unknown_attempt", 404)

CREATE_CASES: list[tuple[str, Any, tuple[str, int]]] = [
    ("list body", [], INVALID),
    ("null body", None, INVALID),
    ("number body", 7, INVALID),
    ("extra key", create_body(actor="app-owner"), INVALID),
    ("missing title", without(create_body(), "title"), INVALID),
    ("missing requestId", without(create_body(), "requestId"), INVALID),
    ("missing attemptIds", without(create_body(), "attemptIds"), INVALID),
    ("missing milestones", without(create_body(), "milestones"), INVALID),
    ("short requestId", create_body(requestId="abcdefg"), INVALID),
    ("long requestId", create_body(requestId="a" * 65), INVALID),
    ("newline requestId", create_body(requestId="create-00000001\n"), INVALID),
    ("non ascii requestId", create_body(requestId="cr\u00e9ate-00000001"), INVALID),
    ("numeric requestId", create_body(requestId=12345678), INVALID),
    ("numeric title", create_body(title=7), INVALID),
    ("empty title", create_body(title=""), INVALID),
    ("blank title", create_body(title="   "), INVALID),
    ("invisible title", create_body(title="\u200b\u200b"), INVALID),
    ("raw over bound title", create_body(title="t" * 481), INVALID),
    ("empty condition", create_body(acceptanceCondition=""), INVALID),
    ("raw over bound condition", create_body(acceptanceCondition="c" * 1121), INVALID),
    ("rewardable one", create_body(rewardable=1), INVALID),
    ("rewardable zero", create_body(rewardable=0), INVALID),
    ("rewardable text", create_body(rewardable="true"), INVALID),
    ("rewardable null", create_body(rewardable=None), INVALID),
    ("numeric parent", create_body(parentId=5), INVALID),
    ("malformed parent", create_body(parentId="wrk_short"), NO_WORK),
    ("attemptIds text", create_body(attemptIds="x"), INVALID),
    ("seventeen attempts", create_body(attemptIds=[f"att_{i:024x}" for i in range(17)]), INVALID),
    ("duplicate attempts", create_body(attemptIds=[ATTEMPT_OK, ATTEMPT_OK]), INVALID),
    ("numeric attempt", create_body(attemptIds=[5]), INVALID),
    ("malformed attempt", create_body(attemptIds=["att_short"]), NO_ATTEMPT),
    ("milestones text", create_body(milestones="x"), INVALID),
    ("nine milestones", create_body(milestones=["m"] * 9), INVALID),
    ("numeric milestone", create_body(milestones=[5]), INVALID),
    ("empty milestone", create_body(milestones=[""]), INVALID),
    ("blank milestone", create_body(milestones=["   "]), INVALID),
]
BAD_VERSIONS = [True, 1.0, "1", None, 0, -1, BIG]


@pytest.mark.parametrize(
    ("name", "body", "expected"), CREATE_CASES, ids=[c[0] for c in CREATE_CASES]
)
def test_create_refuses_a_bad_body_before_the_store(
    spied: WorkService, name: str, body: Any, expected: tuple[str, int]
) -> None:
    assert code_of(refused(spied.create_work(body))) == expected


@pytest.mark.parametrize("version", BAD_VERSIONS, ids=repr)
def test_link_and_milestone_refuse_a_bad_expected_version(spied: WorkService, version: Any) -> None:
    link = {"expectedVersion": version, "attemptId": ATTEMPT_OK}
    mark = {"expectedVersion": version, "position": 1, "done": True}
    assert code_of(refused(spied.link_attempt(WORK_FAR, link))) == INVALID
    assert code_of(refused(spied.set_milestone(WORK_FAR, mark))) == INVALID
    assert code_of(refused(spied.decide(WORK_FAR, decision_body("submit", version)))) == INVALID


def test_a_boolean_is_never_an_integer(spied: WorkService) -> None:
    for call in (
        spied.link_attempt(WORK_FAR, {"expectedVersion": True, "attemptId": ATTEMPT_OK}),
        spied.set_milestone(WORK_FAR, {"expectedVersion": 1, "position": True, "done": True}),
    ):
        assert code_of(refused(call)) == INVALID


LINK_CASES: list[tuple[str, Any, tuple[str, int]]] = [
    ("extra key", {"expectedVersion": 1, "attemptId": ATTEMPT_OK, "by": "x"}, INVALID),
    ("missing attempt", {"expectedVersion": 1}, INVALID),
    ("missing version", {"attemptId": ATTEMPT_OK}, INVALID),
    ("numeric attempt", {"expectedVersion": 1, "attemptId": 5}, INVALID),
    ("malformed attempt", {"expectedVersion": 1, "attemptId": "att_short"}, NO_ATTEMPT),
    (
        "trailing newline attempt",
        {"expectedVersion": 1, "attemptId": ATTEMPT_OK + "\n"},
        NO_ATTEMPT,
    ),
    ("list body", [], INVALID),
]


@pytest.mark.parametrize(("name", "body", "expected"), LINK_CASES, ids=[c[0] for c in LINK_CASES])
def test_link_refuses_a_bad_body_before_the_store(
    spied: WorkService, name: str, body: Any, expected: tuple[str, int]
) -> None:
    assert code_of(refused(spied.link_attempt(WORK_FAR, body))) == expected


MILESTONE_CASES: list[tuple[str, Any]] = [
    ("extra key", {"expectedVersion": 1, "position": 1, "done": True, "x": 1}),
    ("missing done", {"expectedVersion": 1, "position": 1}),
    ("position zero", {"expectedVersion": 1, "position": 0, "done": True}),
    ("position nine", {"expectedVersion": 1, "position": 9, "done": True}),
    ("position float", {"expectedVersion": 1, "position": 1.0, "done": True}),
    ("position text", {"expectedVersion": 1, "position": "1", "done": True}),
    ("done one", {"expectedVersion": 1, "position": 1, "done": 1}),
    ("done zero", {"expectedVersion": 1, "position": 1, "done": 0}),
    ("done text", {"expectedVersion": 1, "position": 1, "done": "true"}),
    ("done null", {"expectedVersion": 1, "position": 1, "done": None}),
]


@pytest.mark.parametrize(("name", "body"), MILESTONE_CASES, ids=[c[0] for c in MILESTONE_CASES])
def test_milestone_refuses_a_bad_body_before_the_store(
    spied: WorkService, name: str, body: Any
) -> None:
    assert code_of(refused(spied.set_milestone(WORK_FAR, body))) == INVALID


DECISION_CASES: list[tuple[str, Any]] = [
    ("actor key", decision_body("submit", 1, actor="app-owner")),
    ("by key", decision_body("submit", 1, by="someone")),
    ("user key", decision_body("submit", 1, user="someone")),
    ("missing requestId", without(decision_body("submit", 1), "requestId")),
    ("missing action", without(decision_body("submit", 1), "action")),
    ("capitalised action", decision_body("submit", 1, action="Accept")),
    ("padded action", decision_body("submit", 1, action="accept ")),
    ("unknown action", decision_body("submit", 1, action="approve")),
    ("numeric action", decision_body("submit", 1, action=5)),
    ("accept without revision", decision_body("accept", 1)),
    ("reject without revision", decision_body("reject", 1)),
    ("uppercase revision", decision_body("accept", 1, revision="A" * 24)),
    ("short revision", decision_body("accept", 1, revision="a" * 23)),
    ("long revision", decision_body("accept", 1, revision="a" * 25)),
    ("newline revision", decision_body("accept", 1, revision="a" * 24 + "\n")),
    ("null revision on accept", decision_body("accept", 1, evidenceRevision=None)),
    ("revision on submit", decision_body("submit", 1, evidenceRevision=REVISION)),
    ("revision on reopen", decision_body("reopen", 1, evidenceRevision=REVISION)),
    ("numeric note", decision_body("submit", 1, note=5)),
    ("raw over bound note", decision_body("submit", 1, note="n" * 1121)),
    ("short requestId", decision_body("submit", 1, requestId="short")),
]


@pytest.mark.parametrize(("name", "body"), DECISION_CASES, ids=[c[0] for c in DECISION_CASES])
def test_decide_refuses_a_bad_body_before_the_store(
    spied: WorkService, name: str, body: Any
) -> None:
    assert code_of(refused(spied.decide(WORK_FAR, body))) == INVALID


@pytest.mark.parametrize("work_id", ["wrk_short", "WRK_" + "a" * 24, WORK_FAR + "\n", "", 5])
def test_a_malformed_work_id_is_the_unknown_work_outcome(spied: WorkService, work_id: Any) -> None:
    ok_link = {"expectedVersion": 1, "attemptId": ATTEMPT_OK}
    assert code_of(refused(spied.get_work(work_id))) == NO_WORK
    assert code_of(refused(spied.link_attempt(work_id, ok_link))) == NO_WORK
    assert code_of(refused(spied.decide(work_id, decision_body("submit", 1)))) == NO_WORK


QUERY_CASES: list[tuple[dict[str, Any], tuple[str, int]]] = [
    ({"state": "bogus"}, ("invalid_state", 400)),
    ({"state": "Open"}, ("invalid_state", 400)),
    ({"binding_id": "bnd_short"}, ("unknown_binding", 404)),
    ({"limit": "abc"}, ("invalid_limit", 400)),
    ({"limit": "1e3"}, ("invalid_limit", 400)),
    ({"limit": "+5"}, ("invalid_limit", 400)),
    ({"limit": " 5"}, ("invalid_limit", 400)),
    ({"limit": "-1"}, ("invalid_limit", 400)),
    ({"limit": "\u0663"}, ("invalid_limit", 400)),
    ({"limit": ""}, ("invalid_limit", 400)),
    ({"limit": "1234567"}, ("invalid_limit", 400)),
]


@pytest.mark.parametrize(("args", "expected"), QUERY_CASES, ids=lambda v: repr(v)[:30])
def test_list_refuses_a_bad_query_before_the_store(
    spied: WorkService, args: dict[str, Any], expected: tuple[str, int]
) -> None:
    arguments = {"state": None, "binding_id": None, "cursor": None, "limit": None, **args}
    assert code_of(refused(spied.list_work(**arguments))) == expected


@pytest.mark.parametrize("limit", ["abc", "+5", "\u0663", "1234567"])
def test_history_refuses_a_bad_limit_and_a_malformed_binding(
    spied: WorkService, limit: str
) -> None:
    assert code_of(refused(spied.xp_history(BINDING_FAR, cursor=None, limit=limit))) == (
        "invalid_limit",
        400,
    )
    assert code_of(refused(spied.xp_history("bnd_short", cursor=None, limit=None))) == (
        "unknown_binding",
        404,
    )


ERRORS: list[tuple[Callable[[], Exception], str, int]] = [
    (lambda: store_errors.VersionConflict(3), "version_conflict", 409),
    (store_errors.UnknownWork, "unknown_work", 404),
    (store_errors.UnknownAttempt, "unknown_attempt", 404),
    (store_errors.UnknownBinding, "unknown_binding", 404),
    (store_errors.AttemptAlreadyLinked, "attempt_already_linked", 409),
    (store_errors.AttemptNotEligible, "attempt_not_eligible", 422),
    (store_errors.InvalidTransition, "invalid_transition", 409),
    (store_errors.StaleEvidence, "stale_evidence", 409),
    (store_errors.AttemptsNotEnded, "attempts_not_ended", 409),
    (store_errors.NoEvidence, "no_evidence", 409),
    (store_errors.ChildrenNotAccepted, "children_not_accepted", 409),
    (store_errors.ParentLocked, "parent_locked", 409),
    (store_errors.ContributorsFrozen, "contributors_frozen", 409),
    (store_errors.RequestReused, "request_reused", 409),
    (store_errors.LimitReached, "limit_reached", 422),
    (store_errors.InvalidCursor, "invalid_cursor", 400),
    (store_errors.StoreUsageError, "invalid_body", 400),
    (store_errors.StoreClosed, "store_unavailable", 503),
    (store_errors.StoreUnavailable, "store_unavailable", 503),
    (store_errors.StoreError, "store_unavailable", 503),
]


@pytest.mark.parametrize(
    ("make", "code", "status"), ERRORS, ids=[e[1] + str(i) for i, e in enumerate(ERRORS)]
)
def test_every_store_error_maps_to_its_own_code(
    monkeypatch: pytest.MonkeyPatch,
    make: Callable[[], Exception],
    code: str,
    status: int,
) -> None:
    def raises(*args: Any, **kwargs: Any) -> None:
        raise make()

    monkeypatch.setattr(db_work, "get_work", raises)
    service = WorkService(untouchable(), clock=FakeClock())
    assert code_of(refused(service.get_work(WORK_FAR))) == (code, status)


def test_an_error_that_is_not_a_store_error_propagates(monkeypatch: pytest.MonkeyPatch) -> None:
    def raises(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(db_work, "get_work", raises)
    service = WorkService(untouchable(), clock=FakeClock())
    with pytest.raises(RuntimeError):
        run(service.get_work(WORK_FAR))


def test_the_error_table_has_one_distinct_code_per_store_error_class() -> None:
    from backend.specter_arena.work.service import _ERRORS

    codes = [code for _, code, _ in _ERRORS]
    classes = [kind for kind, _, _ in _ERRORS]
    assert len(codes) == len(set(codes))
    assert len(classes) == len(set(classes))
    for index, (kind, _, _) in enumerate(_ERRORS):
        assert not any(issubclass(kind, earlier) for earlier in classes[:index])


def ids_of(rig: WorkRig, bot: int, *numbers: int) -> list[str]:
    return [rig.seeded.attempts[bot][n] for n in numbers]


def made(rig: WorkRig, n: int = 1, **changes: Any) -> dict[str, Any]:
    status, body = run(rig.service.create_work(create_body(n, **changes)))
    assert status == 201
    return body


def step(rig: WorkRig, work: dict[str, Any], action: str, n: int = 1, **changes: Any) -> Any:
    revision = work["evidenceRevision"] if action in ("accept", "reject") else None
    body = decision_body(action, work["version"], n, revision, **changes)
    rig.clock.now += 10
    return run(rig.service.decide(work["workId"], body))


def test_the_whole_lifecycle_creates_one_net_award_and_a_compensating_reopen(
    rig: WorkRig,
) -> None:
    first, second = ids_of(rig, 0, 0, 1)[0], ids_of(rig, 1, 0)[0]
    status, item = run(
        rig.service.create_work(
            create_body(1, attemptIds=[first, second], milestones=["Outline", "Draft"])
        )
    )
    assert (status, item["state"], item["version"]) == (201, "open", 1)
    assert item["review"] == {"canAccept": False, "blockers": ["wrong-state"]}
    assert item["progress"] == {"done": 0, "total": 2}
    assert [c["xpNet"] for c in item["contributors"]] == [0, 0]

    replay_status, replayed = run(
        rig.service.create_work(
            create_body(1, attemptIds=[first, second], milestones=["Outline", "Draft"])
        )
    )
    assert (replay_status, replayed) == (200, item)

    extra = ids_of(rig, 0, 2)[0]
    linked = run(
        rig.service.link_attempt(item["workId"], {"expectedVersion": 1, "attemptId": extra})
    )
    assert (linked["version"], len(linked["attempts"])) == (2, 3)
    marked = run(
        rig.service.set_milestone(
            item["workId"], {"expectedVersion": 2, "position": 1, "done": True}
        )
    )
    assert (marked["version"], marked["progress"]) == (3, {"done": 1, "total": 2})

    submitted = step(rig, marked, "submit")
    assert (submitted["state"], submitted["review"]["canAccept"]) == ("awaiting-review", True)
    accepted = step(rig, submitted, "accept")
    assert accepted["state"] == "accepted"
    assert sorted(c["xpNet"] for c in accepted["contributors"]) == [50, 50]
    assert accepted["decisions"][-1]["actor"] == "app-owner"
    assert accepted["decisions"][-1]["evidenceRevision"] == submitted["evidenceRevision"]

    summaries = run(rig.service.xp_summaries())
    assert [s["totalXp"] for s in summaries["items"]] == [50, 50]
    assert all(s["level"] == 1 and s["acceptedWorkCount"] == 1 for s in summaries["items"])
    first_binding = rig.seeded.bindings[0]
    history = run(rig.service.xp_history(first_binding, cursor=None, limit=None))
    assert [e["amount"] for e in history["items"]] == [50]

    reopened = step(rig, accepted, "reopen", note="The notes missed a step.")
    assert [c["xpNet"] for c in reopened["contributors"]] == [0, 0]
    history = run(rig.service.xp_history(first_binding, cursor=None, limit=None))
    assert [e["kind"] for e in history["items"]] == ["correction", "award"]
    assert run(rig.service.xp_summaries())["items"][0]["totalXp"] == 0

    again = step(rig, step(rig, reopened, "submit", 2), "accept", 2)
    assert sorted(c["xpNet"] for c in again["contributors"]) == [50, 50]
    history = run(rig.service.xp_history(first_binding, cursor=None, limit=None))
    assert [e["kind"] for e in history["items"]] == ["reinstatement", "correction", "award"]
    assert sum(r[0] for r in query(rig.store, "SELECT amount FROM xp_entry")) == 100


def test_reject_block_unblock_and_cancel_write_no_xp(rig: WorkRig) -> None:
    rejected = step(rig, step(rig, made(rig, 1, attemptIds=ids_of(rig, 0, 0)), "submit"), "reject")
    assert rejected["state"] == "rejected"
    blocked = step(rig, made(rig, 2, attemptIds=ids_of(rig, 1, 0)), "block")
    assert blocked["state"] == "blocked"
    reopened = step(rig, blocked, "unblock")
    assert reopened["state"] == "open"
    cancelled = step(rig, made(rig, 3, attemptIds=ids_of(rig, 2, 0)), "cancel")
    assert cancelled["state"] == "cancelled"
    assert query(rig.store, "SELECT count(*) FROM xp_entry") == [(0,)]
    assert {d["actor"] for item in (rejected, blocked, cancelled) for d in item["decisions"]} == {
        "app-owner"
    }


def test_a_replayed_decision_returns_the_recorded_body_and_writes_nothing(rig: WorkRig) -> None:
    item = made(rig, 1, attemptIds=ids_of(rig, 0, 0))
    first = step(rig, item, "block", 7)
    rows = query(rig.store, "SELECT count(*) FROM work_decision")
    again = step(rig, item, "block", 7)
    assert again == first
    assert query(rig.store, "SELECT count(*) FROM work_decision") == rows


def test_a_reused_request_id_with_other_fields_is_refused(rig: WorkRig) -> None:
    item = made(rig, 1, attemptIds=ids_of(rig, 0, 0))
    step(rig, item, "block", 7)
    before = ledger_hash(rig.store)
    other = decision_body("cancel", item["version"], 7, requestId=token("block", 7))
    assert code_of(refused(rig.service.decide(item["workId"], other))) == ("request_reused", 409)
    changed = create_body(1, attemptIds=ids_of(rig, 0, 0), title="Another title")
    assert code_of(refused(rig.service.create_work(changed))) == ("request_reused", 409)
    assert ledger_hash(rig.store) == before


def end_worker(rig: WorkRig, bot: int, number: int, at: int) -> None:
    key = build_dm_key(dm_key_of(bot))
    slot = f"chat-{number}-{1_794_779_966 + number}"
    facts = {"createdBy": key, "createdMs": 7 + number}
    send(rig.store, observe(rig.store, key, at, slot=slot, running=False, **facts))


def test_stale_evidence_is_refused_and_leaves_every_row_unchanged(rig: WorkRig) -> None:
    item = made(rig, 1, attemptIds=ids_of(rig, 0, 0))
    submitted = step(rig, item, "submit")
    stale = submitted["evidenceRevision"]
    linked = run(
        rig.service.link_attempt(
            item["workId"],
            {"expectedVersion": submitted["version"], "attemptId": ids_of(rig, 1, 0)[0]},
        )
    )
    assert linked["evidenceRevision"] != stale
    before = ledger_hash(rig.store)
    error = refused(
        rig.service.decide(item["workId"], decision_body("accept", linked["version"], 1, stale))
    )
    assert code_of(error) == ("stale_evidence", 409)
    assert ledger_hash(rig.store) == before
    assert step(rig, linked, "accept")["state"] == "accepted"


def test_evidence_that_changed_because_an_attempt_ended_is_stale(rig: WorkRig) -> None:
    running = worker_attempt(rig.store, 0, 901, ended=False, ms=T0 + 50)
    item = made(rig, 1, attemptIds=[running])
    submitted = step(rig, item, "submit")
    before_end = submitted["evidenceRevision"]
    end_worker(rig, 0, 901, T0 + 60)
    before = ledger_hash(rig.store)
    body = decision_body("accept", submitted["version"], 1, before_end)
    assert code_of(refused(rig.service.decide(item["workId"], body))) == ("stale_evidence", 409)
    assert ledger_hash(rig.store) == before
    current = run(rig.service.get_work(item["workId"]))
    assert current["evidenceRevision"] != before_end
    assert step(rig, current, "accept")["state"] == "accepted"


def refusal_scenarios(rig: WorkRig) -> list[tuple[str, str, Callable[[], Any]]]:
    running = worker_attempt(rig.store, 0, 902, ended=False, ms=T0 + 70)
    unended = step(rig, made(rig, 1, attemptIds=[running]), "submit")
    empty = step(rig, made(rig, 2), "submit")
    opened = made(rig, 3, attemptIds=ids_of(rig, 1, 0))
    parent = made(rig, 4)
    made(rig, 5, parentId=parent["workId"], attemptIds=ids_of(rig, 2, 0))
    container = step(rig, run(rig.service.get_work(parent["workId"])), "submit", 4)

    def accept(item: dict[str, Any], version: int | None = None) -> Callable[[], Any]:
        body = decision_body(
            "accept", item["version"] if version is None else version, 9, item["evidenceRevision"]
        )
        return lambda: rig.service.decide(item["workId"], body)

    return [
        ("attempts_not_ended", "attempts_not_ended", accept(unended)),
        ("no_evidence", "no_evidence", accept(empty)),
        ("invalid_transition", "invalid_transition", accept(opened)),
        ("version_conflict", "version_conflict", accept(unended, 99)),
        ("children_not_accepted", "children_not_accepted", accept(container)),
    ]


@pytest.mark.parametrize(
    "name",
    [
        "attempts_not_ended",
        "no_evidence",
        "invalid_transition",
        "version_conflict",
        "children_not_accepted",
    ],
)
def test_each_refused_acceptance_writes_no_row(rig: WorkRig, name: str) -> None:
    scenarios = {label: (code, call) for label, code, call in refusal_scenarios(rig)}
    code, call = scenarios[name]
    before = ledger_hash(rig.store)
    assert refused(call()).code == code
    assert ledger_hash(rig.store) == before


def test_a_rejected_write_of_any_kind_leaves_every_ledger_table_unchanged(rig: WorkRig) -> None:
    item = made(rig, 1, attemptIds=ids_of(rig, 0, 0), milestones=["One"])
    before = ledger_hash(rig.store)
    attempts = [
        rig.service.create_work(create_body(2, attemptIds=[ATTEMPT_OK])),
        rig.service.create_work(create_body(3, title="t" * 121)),
        rig.service.create_work(create_body(4, milestones=["m" * 81])),
        rig.service.create_work(create_body(5, acceptanceCondition="line\u0007bell")),
        rig.service.create_work(create_body(6, attemptIds=ids_of(rig, 0, 0))),
        rig.service.link_attempt(item["workId"], {"expectedVersion": 9, "attemptId": ATTEMPT_OK}),
        rig.service.set_milestone(
            item["workId"], {"expectedVersion": item["version"], "position": 5, "done": True}
        ),
        rig.service.decide(item["workId"], decision_body("cancel", 9, 2)),
    ]
    for call in attempts:
        assert refused(call).status in (400, 404, 409, 422)
    assert ledger_hash(rig.store) == before


def test_eight_concurrent_accepts_have_one_winner_and_one_hundred_xp(rig: WorkRig) -> None:
    item = made(rig, 1, attemptIds=[ids_of(rig, 0, 0)[0], ids_of(rig, 1, 0)[0]])
    submitted = step(rig, item, "submit")

    async def race() -> list[Any]:
        results: list[Any] = await asyncio.gather(
            *(
                rig.service.decide(
                    item["workId"],
                    decision_body("accept", submitted["version"], n, submitted["evidenceRevision"]),
                )
                for n in range(8)
            ),
            return_exceptions=True,
        )
        return results

    results = run(race())
    winners = [r for r in results if isinstance(r, dict)]
    losers = [r for r in results if isinstance(r, WorkError)]
    assert (len(winners), len(losers)) == (1, 7)
    assert {code_of(e) for e in losers} == {("version_conflict", 409)}
    assert query(rig.store, "SELECT COALESCE(sum(amount), 0) FROM xp_entry") == [(100,)]
    assert query(rig.store, "SELECT count(*) FROM xp_entry WHERE kind = 'award'") == [(2,)]


def test_eight_accepts_with_one_request_id_replay_to_identical_bodies(rig: WorkRig) -> None:
    item = made(rig, 1, attemptIds=[ids_of(rig, 0, 0)[0], ids_of(rig, 1, 0)[0]])
    submitted = step(rig, item, "submit")
    body = decision_body("accept", submitted["version"], 1, submitted["evidenceRevision"])

    async def race() -> list[Any]:
        results: list[Any] = await asyncio.gather(
            *(rig.service.decide(item["workId"], body) for _ in range(8))
        )
        return results

    results = run(race())
    assert all(r == results[0] for r in results)
    assert query(rig.store, "SELECT count(*) FROM work_decision WHERE action = 'accept'") == [(1,)]
    assert query(rig.store, "SELECT COALESCE(sum(amount), 0) FROM xp_entry") == [(100,)]


def test_a_two_bot_item_splits_the_bounty_and_shows_zero_before_acceptance(rig: WorkRig) -> None:
    item = made(rig, 1, attemptIds=[*ids_of(rig, 0, 0, 1), *ids_of(rig, 1, 0)])
    by_binding = {c["bindingId"]: c for c in item["contributors"]}
    assert set(by_binding) == {rig.seeded.bindings[0], rig.seeded.bindings[1]}
    assert by_binding[rig.seeded.bindings[0]]["attemptCount"] == 2
    assert all(c["xpNet"] == 0 for c in item["contributors"])
    assert step(rig, step(rig, item, "submit"), "accept")["contributors"] != item["contributors"]


def test_list_pages_filters_and_cursor_errors(rig: WorkRig) -> None:
    for n in range(1, 31):
        made(rig, n)
    first = run(rig.service.list_work(state=None, binding_id=None, cursor=None, limit=None))
    assert len(first["items"]) == 25 and first["nextCursor"] is not None
    second = run(
        rig.service.list_work(state=None, binding_id=None, cursor=first["nextCursor"], limit="25")
    )
    assert len(second["items"]) == 5 and second["nextCursor"] is None
    ids = [i["workId"] for i in first["items"] + second["items"]]
    assert len(set(ids)) == 30
    assert (
        len(
            run(rig.service.list_work(state=None, binding_id=None, cursor=None, limit="0"))["items"]
        )
        == 1
    )
    assert (
        len(
            run(rig.service.list_work(state=None, binding_id=None, cursor=None, limit="26"))[
                "items"
            ]
        )
        == 25
    )
    for cursor in ("not-a-cursor", ""):
        error = refused(
            rig.service.list_work(state=None, binding_id=None, cursor=cursor, limit=None)
        )
        assert code_of(error) == ("invalid_cursor", 400)
    assert first["asOfMs"] == rig.clock.now

    mine = made(rig, 40, attemptIds=ids_of(rig, 1, 3))
    filtered = run(
        rig.service.list_work(
            state=None, binding_id=rig.seeded.bindings[1], cursor=None, limit=None
        )
    )
    assert [i["workId"] for i in filtered["items"]] == [mine["workId"]]
    blocked = step(rig, mine, "block")
    by_state = run(rig.service.list_work(state="blocked", binding_id=None, cursor=None, limit=None))
    assert [i["workId"] for i in by_state["items"]] == [blocked["workId"]]
    unknown = refused(
        rig.service.list_work(state=None, binding_id=BINDING_FAR, cursor=None, limit=None)
    )
    assert code_of(unknown) == ("unknown_binding", 404)


def test_history_pages_and_unknown_bindings(rig: WorkRig) -> None:
    for n in range(1, 4):
        item = made(rig, n, attemptIds=ids_of(rig, 0, n))
        step(rig, step(rig, item, "submit", n), "accept", n)
    binding = rig.seeded.bindings[0]
    first = run(rig.service.xp_history(binding, cursor=None, limit="2"))
    assert len(first["items"]) == 2 and first["nextCursor"] is not None
    last = run(rig.service.xp_history(binding, cursor=first["nextCursor"], limit="2"))
    assert len(last["items"]) == 1 and last["nextCursor"] is None
    assert first["summary"]["totalXp"] == 300
    for call in (
        rig.service.xp_history(BINDING_FAR, cursor=None, limit=None),
        rig.service.xp_history(binding, cursor="nope", limit=None),
    ):
        assert refused(call).status in (404, 400)
    empty = run(rig.service.xp_history(rig.seeded.bindings[2], cursor=None, limit=None))
    assert (empty["items"], empty["summary"]["level"]) == ([], 1)


def test_an_unknown_work_id_is_404(rig: WorkRig) -> None:
    assert code_of(refused(rig.service.get_work(WORK_FAR))) == NO_WORK
