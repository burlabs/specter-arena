import json
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    EVENT_PAYLOAD_KEYS,
    ROW_FACT_KEYS,
    BindingSeen,
    DmKey,
    IngestBatch,
    IngestItem,
    IngestResult,
    ObservationIn,
    QuarantineIn,
    Store,
    StoreUsageError,
    ingest,
    open_store,
    row_fact_digest,
    start_run,
)
from backend.specter_arena.store.validate import canonical_payload

ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
ALPHA_KEY = "member-alpha-0123456789ab.memory-memory-alpha"
WORKER_KEY = "member-alpha-0123456789ab.memory-memory-alpha.worker-1"
T0 = 1_800_000_000_000
RUN = "run-00000001"


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        start_run(opened, run_id=RUN, now_ms=T0 - 1)
        yield opened
    finally:
        opened.close()


def installation(opened: Store) -> str:
    with opened.read() as conn:
        return str(conn.execute("SELECT store_id FROM store_meta").fetchone()[0])


def run(opened: Store, *items: IngestItem) -> IngestResult:
    return ingest(opened, IngestBatch(RUN, installation(opened), items))


def row(opened: Store, payload: dict[str, Any] | None = None, **fields: Any) -> ObservationIn:
    facts: dict[str, Any] = {"running": True, "turn": 3, "turnGen": "ab12", "lastActivityMs": 9}
    if payload is not None:
        facts = payload
    base = ObservationIn(
        installation_id=installation(opened),
        dm_key=ALPHA_KEY,
        slot_key=ALPHA_KEY,
        kind="row-change",
        event_type="slot-row",
        received_at_ms=T0,
        payload=facts,
        turn=3 if "turn" in facts else None,
        turn_gen="ab12" if "turnGen" in facts else None,
        fact_digest=row_fact_digest(facts),
    )
    return replace(base, **fields)


def event(opened: Store, event_type: str = "chat_done", **fields: Any) -> ObservationIn:
    base = ObservationIn(
        installation_id=installation(opened),
        dm_key=ALPHA_KEY,
        slot_key=ALPHA_KEY,
        kind="event",
        event_type=event_type,
        received_at_ms=T0,
        payload={"continuing": False},
        turn=3,
        turn_gen="ab12",
        dedup_key="chat_done:3",
    )
    return replace(base, **fields)


def count(opened: Store, sql: str, *params: object) -> int:
    with opened.read() as conn:
        return int(conn.execute(sql, params).fetchone()[0])


def bind(opened: Store) -> str:
    return run(opened, BindingSeen(ALPHA, T0)).bindings[0].binding_id


@pytest.fixture
def bound(store: Store) -> Store:
    bind(store)
    return store


def reasons(result: IngestResult) -> list[str]:
    return [r.reason for r in result.rejections]


# Persisting ----------------------------------------------------------------------------------


def test_a_row_change_is_stored_with_its_columns_and_a_canonical_payload(bound: Store) -> None:
    result = run(bound, row(bound))
    assert result.counts["observation"].persisted == 1
    assert result.last_seq == 1
    with bound.read() as conn:
        stored = conn.execute(
            "SELECT kind, event_type, source, slot_key, turn, turn_gen, dedup_key, fact_digest,"
            " origin, payload FROM observation"
        ).fetchone()
    assert stored[:7] == ("row-change", "slot-row", "crew-ws", ALPHA_KEY, 3, "ab12", None)
    assert stored[7] == row_fact_digest({"running": True, "turn": 3, "turnGen": "ab12"})
    assert stored[8] == "live"
    assert json.loads(stored[9]) == {
        "running": True,
        "turn": 3,
        "turnGen": "ab12",
        "lastActivityMs": 9,
    }


@pytest.mark.parametrize(
    "event_type,payload",
    [
        ("chat_done", {"continuing": True, "needsInput": False}),
        ("chat_status", {}),
        ("context_usage", {"usedTokens": 10, "windowTokens": 200_000}),
        ("tool_call", {"isShell": True}),
        ("tool_result", {}),
    ],
)
def test_every_event_type_is_stored_with_its_own_keys(
    bound: Store, event_type: str, payload: dict[str, Any]
) -> None:
    item = event(bound, event_type, payload=payload, dedup_key=f"{event_type}:1", tool_call_id="t1")
    assert run(bound, item).counts["observation"].persisted == 1
    assert count(bound, "SELECT count(*) FROM observation WHERE event_type = ?", event_type) == 1


def test_the_published_key_lists_cover_the_contract() -> None:
    assert set(EVENT_PAYLOAD_KEYS) == {
        "chat_done",
        "chat_status",
        "context_usage",
        "tool_call",
        "tool_result",
    }
    assert len(ROW_FACT_KEYS) == 23
    assert "waiting" not in ROW_FACT_KEYS and "waitStatePresent" in ROW_FACT_KEYS


def test_the_recorded_and_fixture_origins_are_kept(bound: Store) -> None:
    run(bound, event(bound, origin="recorded", dedup_key="a"), event(bound, origin="fixture"))
    with bound.read() as conn:
        origins = conn.execute("SELECT origin FROM observation ORDER BY seq").fetchall()
    assert origins == [("recorded",), ("fixture",)]


def test_a_worker_row_is_attributed_to_its_creator(bound: Store) -> None:
    payload: dict[str, Any] = {"running": True, "createdBy": ALPHA_KEY, "createdMs": 5}
    worker = row(bound, payload, slot_key=WORKER_KEY, turn=None, turn_gen=None)
    assert run(bound, worker).counts["observation"].persisted == 1


# Duplicates and order ------------------------------------------------------------------------


def test_a_repeated_event_is_deduplicated_by_its_key(bound: Store) -> None:
    first = run(bound, event(bound))
    again = run(bound, event(bound, received_at_ms=T0 + 5))
    assert first.counts["observation"].persisted == 1
    assert again.counts["observation"].deduplicated == 1
    assert again.last_seq is None
    assert count(bound, "SELECT count(*) FROM observation") == 1
    other = run(bound, event(bound, dedup_key="chat_done:4"))
    assert other.counts["observation"].persisted == 1


def test_an_event_without_a_dedup_key_is_never_a_duplicate(bound: Store) -> None:
    run(bound, event(bound, dedup_key=None), event(bound, dedup_key=None))
    assert count(bound, "SELECT count(*) FROM observation") == 2


def test_the_same_dedup_key_under_another_event_type_is_not_a_duplicate(bound: Store) -> None:
    run(bound, event(bound, dedup_key="k"), event(bound, "chat_status", payload={}, dedup_key="k"))
    assert count(bound, "SELECT count(*) FROM observation") == 2


def test_an_unchanged_row_is_deduplicated_but_a_recurring_state_is_kept(bound: Store) -> None:
    def approval(flag: bool, activity: int) -> ObservationIn:
        facts: dict[str, Any] = {
            "running": True,
            "pendingApproval": flag,
            "lastActivityMs": activity,
        }
        return row(bound, facts, turn=None, turn_gen=None)

    outcomes = [
        run(bound, approval(True, 1)).counts["observation"],
        run(bound, approval(True, 2)).counts["observation"],
        run(bound, approval(False, 3)).counts["observation"],
        run(bound, approval(True, 4)).counts["observation"],
    ]
    assert [(o.persisted, o.deduplicated) for o in outcomes] == [(1, 0), (0, 1), (1, 0), (1, 0)]
    assert count(bound, "SELECT count(*) FROM observation") == 3


def test_row_dedup_is_per_slot(bound: Store) -> None:
    facts: dict[str, Any] = {"running": True, "createdBy": ALPHA_KEY}
    one = row(bound, facts, slot_key=WORKER_KEY, turn=None, turn_gen=None)
    two = replace(one, slot_key=WORKER_KEY + "2")
    assert run(bound, one, two).counts["observation"].persisted == 2


def test_out_of_order_rows_are_all_kept_as_evidence(bound: Store) -> None:
    newer = row(bound, {"running": True, "turn": 9, "turnGen": "ab12"}, turn=9)
    older = row(bound, {"running": False, "turn": 2, "turnGen": "ab12"}, turn=2)
    result = run(bound, newer, older)
    assert result.counts["observation"].persisted == 2
    assert [r[0] for r in _seqs(bound)] == [1, 2]


def _seqs(opened: Store) -> list[tuple[int, int]]:
    with opened.read() as conn:
        return list(conn.execute("SELECT seq, turn FROM observation ORDER BY seq"))


def test_two_simultaneous_sessions_of_one_bot_store_separate_rows(bound: Store) -> None:
    other = {"running": True, "createdBy": ALPHA_KEY}
    run(bound, row(bound), row(bound, other, slot_key=WORKER_KEY, turn=None, turn_gen=None))
    assert count(bound, "SELECT count(DISTINCT slot_key) FROM observation") == 2


# Rejections ----------------------------------------------------------------------------------


def test_an_observation_for_another_installation_is_rejected(bound: Store) -> None:
    result = run(bound, row(bound, installation_id="99999999-9999-4999-8999-999999999999"))
    assert reasons(result) == ["wrong-installation"]
    assert count(bound, "SELECT count(*) FROM observation") == 0


def test_an_observation_for_an_unbound_key_is_rejected(store: Store) -> None:
    assert reasons(run(store, row(store))) == ["unknown-binding"]


def test_a_binding_id_that_does_not_match_the_key_is_rejected(bound: Store) -> None:
    result = run(bound, row(bound, binding_id="bnd_" + "0" * 24))
    assert reasons(result) == ["binding-mismatch"]


def test_a_matching_binding_id_is_accepted(bound: Store) -> None:
    with bound.read() as conn:
        binding_id = conn.execute("SELECT binding_id FROM bot_binding").fetchone()[0]
    assert run(bound, row(bound, binding_id=binding_id)).counts["observation"].persisted == 1


@pytest.mark.parametrize(
    "fields,reason",
    [
        ({"origin": "elsewhere"}, "bad-origin"),
        ({"source": "other"}, "bad-field"),
        ({"contract_version": 2}, "bad-field"),
        ({"kind": "other"}, "bad-field"),
        ({"dm_key": "nope"}, "bad-dm-key"),
        ({"slot_key": ""}, "bad-field"),
        ({"slot_key": "s" * 257}, "bad-field"),
        ({"event_type": 5}, "bad-field"),
        ({"received_at_ms": -1}, "bad-field"),
        ({"received_at_ms": True}, "bad-field"),
        ({"source_time_ms": -1}, "bad-field"),
        ({"turn": -1}, "bad-field"),
        ({"turn_gen": "XYZ"}, "bad-field"),
        ({"turn_gen": "a" * 17}, "bad-field"),
        ({"tool_call_id": ""}, "bad-field"),
        ({"tool_call_id": "t" * 129}, "bad-field"),
        ({"binding_id": 5}, "bad-field"),
        ({"event_type": "chat_done"}, "unknown-event-type"),
    ],
)
def test_malformed_observation_fields_are_rejected_with_a_stable_reason(
    bound: Store, fields: dict[str, Any], reason: str
) -> None:
    assert reasons(run(bound, row(bound, **fields))) == [reason]
    assert count(bound, "SELECT count(*) FROM observation") == 0


def test_an_unknown_event_type_is_rejected(bound: Store) -> None:
    assert reasons(run(bound, event(bound, "mystery_event"))) == ["unknown-event-type"]


@pytest.mark.parametrize(
    "payload",
    [
        {"running": True, "pct": 5},
        {"running": True, "waiting": True},
        {"running": True, "toolCallId": "x"},
        {"running": "yes"},
        {"running": 1},
        {"turn": 3},
        {"running": True, "queueDepth": -1},
        {"running": True, "queueDepth": True},
        {"running": True, "queueDepth": 2**53},
        {"running": True, "queueDepth": 1.5},
        {"running": True, "slotMode": "x" * 129},
        {"running": True, "slotMode": ""},
        {"running": True, "slotMode": "has space"},
        {"running": True, "turnGen": "XYZ"},
        {"running": True, "createdBy": ""},
        {"running": True, "createdBy": "c" * 257},
        {"running": True, "pendingApproval": None},
        {"running": True, "nested": {"a": 1}},
        {"running": True, "parentKey": ["a"]},
    ],
)
def test_row_payload_shape_violations_are_rejected(bound: Store, payload: dict[str, Any]) -> None:
    item = row(bound, payload, turn=None, turn_gen=None, fact_digest="0" * 64)
    assert reasons(run(bound, item)) == ["payload-shape"]


@pytest.mark.parametrize(
    "event_type,payload",
    [
        ("chat_done", {"turn": 1}),
        ("chat_done", {"turnGen": "ab"}),
        ("chat_done", {"continuing": "no"}),
        ("tool_call", {"toolCallId": "x"}),
        ("tool_result", {"isShell": True}),
        ("context_usage", {"pct": 5}),
        ("context_usage", {"reset": True}),
        ("context_usage", {"usedTokens": 1.5}),
        ("chat_status", {"anything": 1}),
    ],
)
def test_event_payload_shape_violations_are_rejected(
    bound: Store, event_type: str, payload: dict[str, Any]
) -> None:
    item = event(bound, event_type, payload=payload)
    assert reasons(run(bound, item)) == ["payload-shape"]


@pytest.mark.parametrize("token", ["Upper", "1lead", "has space", "dot.ed", "a" * 49, "", "naïve"])
def test_the_store_tokens_follow_the_wire_pattern(bound: Store, token: str) -> None:
    for key in ("slotMode", "slotOrigin", "stopState"):
        item = row(bound, {"running": True, key: token}, turn=None, turn_gen=None)
        assert reasons(run(bound, item)) == ["payload-shape"], key


@pytest.mark.parametrize("token", ["a", "user", "idle_now", "mode-2", "a" * 48])
def test_wire_conforming_tokens_are_accepted(bound: Store, token: str) -> None:
    payload = {"running": True, "slotMode": token, "slotOrigin": token, "stopState": token}
    assert (
        run(bound, row(bound, payload, turn=None, turn_gen=None)).counts["observation"].persisted
        == 1
    )


@pytest.mark.parametrize("slot", ["has space", "a/b", "ünï", "semi;colon", "a" * 257, "", "x=y"])
def test_slot_keys_follow_the_wire_character_set(bound: Store, slot: str) -> None:
    created = row(bound, {"running": True, "createdBy": slot}, turn=None, turn_gen=None)
    parent = row(bound, {"running": True, "parentKey": slot}, turn=None, turn_gen=None)
    assert reasons(run(bound, created, parent)) == ["payload-shape"] * 2
    assert reasons(run(bound, row(bound, slot_key=slot))) == ["bad-field"]


@pytest.mark.parametrize("slot", ["chat-61-1794779966", "a:b.c_d-e", "A" * 256])
def test_wire_conforming_slot_keys_are_accepted(bound: Store, slot: str) -> None:
    worker = {"running": True, "createdBy": ALPHA_KEY}
    item = row(bound, worker, slot_key=slot, turn=None, turn_gen=None)
    assert run(bound, item).counts["observation"].persisted == 1


@pytest.mark.parametrize("tool_call_id", ["has space", "a/b", "ünï", "a" * 129])
def test_tool_call_ids_follow_the_wire_character_set(bound: Store, tool_call_id: str) -> None:
    item = event(bound, "tool_call", payload={"isShell": True}, tool_call_id=tool_call_id)
    assert reasons(run(bound, item)) == ["bad-field"]


@pytest.mark.parametrize("key", ["has space", "a/b", "ünï", "semi;colon"])
def test_dedup_keys_follow_the_wire_character_set(bound: Store, key: str) -> None:
    assert reasons(run(bound, event(bound, dedup_key=key))) == ["bad-dedup"]


def test_a_payload_that_is_not_a_mapping_or_not_json_is_rejected(bound: Store) -> None:
    assert reasons(run(bound, event(bound, payload=[1]))) == ["payload-shape"]
    assert reasons(run(bound, event(bound, payload={1: True}))) == ["payload-shape"]
    assert reasons(run(bound, event(bound, payload={"continuing": {1, 2}}))) == ["payload-shape"]


def test_a_slot_row_payload_turn_must_equal_the_columns(bound: Store) -> None:
    mismatch = row(bound, {"running": True, "turn": 4}, turn=3, turn_gen=None)
    gen = row(bound, {"running": True, "turnGen": "cd34"}, turn=None, turn_gen="ab12")
    missing = row(bound, {"running": True, "turn": 3}, turn=None, turn_gen=None)
    assert reasons(run(bound, mismatch, gen, missing)) == ["payload-shape"] * 3


def test_an_oversize_payload_is_rejected(bound: Store) -> None:
    big = event(bound, payload={"continuing": "x" * 70_000})
    assert reasons(run(bound, big)) == ["payload-too-large"]


@pytest.mark.parametrize(
    "fields",
    [
        {"dedup_key": "x"},
        {"fact_digest": None},
        {"fact_digest": "F" * 64},
        {"fact_digest": "0" * 63},
        {"fact_digest": "0" * 64},
    ],
)
def test_row_change_dedup_fields_are_checked(bound: Store, fields: dict[str, Any]) -> None:
    assert reasons(run(bound, row(bound, **fields))) == ["bad-dedup"]


@pytest.mark.parametrize(
    "fields", [{"fact_digest": "0" * 64}, {"dedup_key": ""}, {"dedup_key": "d" * 513}]
)
def test_event_dedup_fields_are_checked(bound: Store, fields: dict[str, Any]) -> None:
    assert reasons(run(bound, event(bound, **fields))) == ["bad-dedup"]


def test_the_digest_ignores_last_activity_and_follows_every_other_fact() -> None:
    base = {"running": True, "turn": 3}
    assert row_fact_digest({**base, "lastActivityMs": 1}) == row_fact_digest(base)
    assert row_fact_digest({**base, "interrupted": True}) != row_fact_digest(base)
    assert row_fact_digest({"turn": 3, "running": True}) == row_fact_digest(base)


def test_a_worker_row_not_created_by_the_bound_bot_is_rejected(bound: Store) -> None:
    other = row(
        bound,
        {"running": True, "createdBy": "member-someone-else"},
        slot_key=WORKER_KEY,
        turn=None,
        turn_gen=None,
    )
    unattributed = row(bound, {"running": True}, slot_key=WORKER_KEY, turn=None, turn_gen=None)
    assert reasons(run(bound, other, unattributed)) == ["worker-not-attributable"] * 2


def test_a_bad_observation_does_not_stop_its_neighbours(bound: Store) -> None:
    result = run(bound, event(bound), event(bound, "mystery"), event(bound, dedup_key="two"))
    assert result.counts["observation"].persisted == 2
    assert [(r.index, r.reason) for r in result.rejections] == [(1, "unknown-event-type")]


def test_canonical_payload_is_stable() -> None:
    assert canonical_payload({"b": 1, "a": True}) == '{"a":true,"b":1}'


# Quarantine ----------------------------------------------------------------------------------


def test_a_quarantine_item_stores_counts_and_never_a_body(store: Store) -> None:
    item = QuarantineIn(
        received_at_ms=T0 + 10,
        reason="unknown-event-type",
        frame_type="mystery_frame",
        size_bytes=1234,
        digest="sha256:0123456789ab",
        count=7,
        first_received_at_ms=T0,
    )
    result = run(store, item)
    assert result.counts["quarantine"].quarantined == 1
    assert result.counts["quarantine"].persisted == 0
    with store.read() as conn:
        stored = conn.execute("SELECT * FROM quarantine").fetchone()
        columns = [c[1] for c in conn.execute("PRAGMA table_info(quarantine)")]
    assert dict(zip(columns, stored, strict=True)) == {
        "seq": 1,
        "run_id": RUN,
        "received_at_ms": T0 + 10,
        "reason": "unknown-event-type",
        "frame_type": "mystery_frame",
        "size_bytes": 1234,
        "digest": "sha256:0123456789ab",
        "count": 7,
        "first_received_at_ms": T0,
    }
    assert "payload" not in columns and "body" not in columns


def test_a_quarantine_item_defaults_its_first_time_and_coerces_an_unfit_frame_type(
    store: Store,
) -> None:
    run(store, QuarantineIn(T0, "malformed-frame", "Not A Type!", 0))
    with store.read() as conn:
        assert conn.execute(
            "SELECT frame_type, first_received_at_ms, count FROM quarantine"
        ).fetchone() == (
            "invalid",
            T0,
            1,
        )


@pytest.mark.parametrize(
    "fields",
    [
        {"received_at_ms": -1},
        {"reason": "Bad Reason"},
        {"reason": "r" * 41},
        {"reason": 5},
        {"size_bytes": -1},
        {"size_bytes": 2**31 + 1},
        {"count": 0},
        {"count": 2**31},
        {"count": 2**31 + 1},
        {"digest": "sha256:XYZ"},
        {"digest": "a" * 64},
        {"first_received_at_ms": T0 + 1},
        {"first_received_at_ms": -1},
    ],
)
def test_malformed_quarantine_items_are_rejected(store: Store, fields: dict[str, Any]) -> None:
    item = replace(QuarantineIn(T0, "malformed-frame", "frame", 10), **fields)
    assert reasons(run(store, item)) == ["bad-field"]
    assert count(store, "SELECT count(*) FROM quarantine") == 0


def test_quarantine_boundaries_are_accepted(store: Store) -> None:
    item = QuarantineIn(T0, "r" * 40, "t" * 64, 2**31, count=2**31 - 1, first_received_at_ms=T0)
    assert run(store, item).counts["quarantine"].quarantined == 1


# Batch behaviour -----------------------------------------------------------------------------


def test_a_batch_for_another_installation_rejects_every_new_kind(store: Store) -> None:
    items = (row(store), event(store), QuarantineIn(T0, "malformed-frame", "x", 1))
    result = ingest(store, IngestBatch(RUN, "9" * 36, items))
    assert reasons(result) == ["wrong-installation"] * 3


def test_an_unknown_item_type_is_a_usage_error(store: Store) -> None:
    with pytest.raises(StoreUsageError):
        ingest(store, IngestBatch(RUN, installation(store), (object(),)))  # type: ignore[arg-type]


def test_the_revision_moves_only_when_something_is_persisted(bound: Store) -> None:
    def revision() -> int:
        return count(bound, "SELECT revision FROM collector_setting")

    before = revision()
    run(bound, event(bound))
    persisted = revision()
    run(bound, event(bound))
    run(bound, QuarantineIn(T0, "malformed-frame", "x", 1))
    run(bound, event(bound, "mystery"))
    assert persisted == before + 1
    assert revision() == persisted


def test_last_seq_is_the_highest_inserted(bound: Store) -> None:
    result = run(bound, event(bound), event(bound, dedup_key="b"), event(bound))
    assert result.last_seq == 2


def test_a_constraint_failure_in_an_observation_rejects_only_that_item(
    bound: Store, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.specter_arena.store import observations

    real = vars(observations)["canonical_payload"]

    def broken(payload: object) -> str:
        if payload == {"continuing": True}:
            return "not json"
        return str(real(payload))

    monkeypatch.setattr(observations, "canonical_payload", broken)
    good = event(bound, dedup_key="g")
    bad = event(bound, payload={"continuing": True}, dedup_key="b")
    result = run(bound, bad, good)
    assert [(r.index, r.reason) for r in result.rejections] == [(0, "constraint")]
    assert result.counts["observation"].persisted == 1
    assert count(bound, "SELECT count(*) FROM observation") == 1
