import ast
import copy
import json
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena import wire
from backend.specter_arena.collector.parse import (
    EVENT_PAYLOAD_KEYS as PARSE_EVENT_KEYS,
)
from backend.specter_arena.collector.parse import (
    SLOT_ROW_KEYS,
    EventParse,
    RowFact,
    parse_event,
    parse_slots,
)
from backend.specter_arena.store import ObservationIn
from backend.specter_arena.wire import (
    EVENT_PAYLOAD_KEYS,
    READERS,
    ROW_FACT_KEYS,
    ContractViolation,
    to_wire,
)
from backend.tests.contract_support import (
    CONTRACTS_DIR,
    CaseParseError,
    compile_schema,
    load_json,
    load_registry,
)

REGISTRY = load_registry()
WIRE_MODULE = Path(wire.__file__)
NAMES = ("observation", "roster-item", "roster", "bot-binding", "quarantine-record")

BOT = "member-bot-a-9d63166ee3a3.memory-member-bot-a-9d63166ee3a3-aa11"
WORKER = "chat-61-1794779966"


def case_params() -> list[Any]:
    params = []
    for name in NAMES:
        case_dir = CONTRACTS_DIR / "cases" / name / "v1"
        for entry in load_json(case_dir / "cases.json"):
            params.append(pytest.param(name, case_dir, entry, id=f"{name}/{entry['file']}"))
    return params


@pytest.mark.parametrize(("name", "case_dir", "entry"), case_params())
def test_readers_agree_with_the_schema_on_every_shared_case(
    name: str, case_dir: Path, entry: dict[str, Any]
) -> None:
    try:
        instance = load_json(case_dir / entry["file"])
    except CaseParseError:
        assert entry["valid"] is False
        return
    if entry["valid"]:
        assert READERS[name](instance) == instance
    else:
        with pytest.raises(ContractViolation):
            READERS[name](instance)


def test_every_schema_with_a_reader_is_covered_by_the_shared_cases() -> None:
    assert set(READERS) == set(NAMES)


def valid_row_change() -> dict[str, Any]:
    return copy.deepcopy(
        load_json(CONTRACTS_DIR / "cases" / "observation" / "v1" / "valid" / "row-change-full.json")
    )


def valid_chat_done() -> dict[str, Any]:
    return copy.deepcopy(
        load_json(
            CONTRACTS_DIR / "cases" / "observation" / "v1" / "valid" / "chat-done-with-turn.json"
        )
    )


def valid_roster() -> dict[str, Any]:
    return copy.deepcopy(
        load_json(CONTRACTS_DIR / "cases" / "roster" / "v1" / "valid" / "one-item-last-page.json")
    )


def mutated(base: dict[str, Any], path: Sequence[str | int], value: object) -> dict[str, Any]:
    result = copy.deepcopy(base)
    target: Any = result
    for step in path[:-1]:
        target = target[step]
    target[path[-1]] = value
    return result


NOT_INTEGERS = [float("nan"), float("inf"), 1e300, True, "7", 1.5, None, [1], {"a": 1}]


@pytest.mark.parametrize("bad", NOT_INTEGERS)
def test_integer_fields_reject_nan_infinity_huge_floats_bools_and_nesting(bad: object) -> None:
    targets: list[tuple[Any, dict[str, Any], list[str | int]]] = [
        (READERS["observation"], valid_row_change(), ["receivedAtMs"]),
        (READERS["observation"], valid_row_change(), ["payload", "turn"]),
        (READERS["observation"], valid_chat_done(), ["sourceRef", "turn"]),
        (READERS["roster"], valid_roster(), ["rosterRevision"]),
        (READERS["roster"], valid_roster(), ["items", 0, "workers", "running"]),
        (READERS["roster"], valid_roster(), ["items", 0, "workers", "unknown"]),
    ]
    for reader, base, path in targets:
        with pytest.raises(ContractViolation):
            reader(mutated(base, path, bad))


@pytest.mark.parametrize(
    "path",
    [
        ["collector", "sinceMs"],
        ["items", 0, "coverage", "sinceMs"],
        ["items", 0, "condition", "sourceTimeMs"],
        ["items", 0, "condition", "observedAtMs"],
        ["items", 0, "lastObservedAtMs"],
    ],
    ids=lambda path: ".".join(str(step) for step in path),
)
def test_nullable_times_reject_a_negative_value_but_accept_null(path: list[str | int]) -> None:
    assert READERS["roster"](mutated(valid_roster(), path, None))
    with pytest.raises(ContractViolation):
        READERS["roster"](mutated(valid_roster(), path, -1))
    with pytest.raises(ContractViolation):
        READERS["roster"](mutated(valid_roster(), path, 2**53))


def test_roster_item_rejects_a_negative_since_ms_on_its_own() -> None:
    item = valid_roster()["items"][0]
    with pytest.raises(ContractViolation):
        READERS["roster-item"](mutated(item, ["coverage", "sinceMs"], -1))


def test_observation_rejects_a_negative_source_time() -> None:
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_row_change(), ["sourceTimeMs"], -1))
    assert READERS["observation"](mutated(valid_row_change(), ["sourceTimeMs"], None))


def test_whole_valued_floats_are_integers_like_json_schema() -> None:
    body = mutated(valid_row_change(), ["receivedAtMs"], 1_760_000_000_500.0)
    assert READERS["observation"](body) == body


def test_integers_stop_at_the_json_safe_maximum() -> None:
    assert READERS["observation"](mutated(valid_row_change(), ["receivedAtMs"], 2**53 - 1))
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_row_change(), ["receivedAtMs"], 2**53))
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_row_change(), ["receivedAtMs"], -1))


def test_roster_item_rejects_a_129_character_display_name() -> None:
    body = valid_roster()
    body["items"][0]["displayName"] = "x" * 128
    assert READERS["roster"](body)
    body["items"][0]["displayName"] = "x" * 129
    with pytest.raises(ContractViolation):
        READERS["roster"](body)
    with pytest.raises(ContractViolation):
        READERS["roster-item"](body["items"][0])


def test_roster_rejects_free_text_notes_and_oversize_collections() -> None:
    cases: list[tuple[list[str | int], object]] = [
        (["notes", 0, "code"], "Has Space"),
        (["notes", 0, "code"], "x" * 65),
        (["notes", 0, "count"], -1),
        (["notes", 0, "count"], True),
        (["nextCursor"], ""),
        (["nextCursor"], "bad cursor"),
        (["nextCursor"], "a" * 513),
        (["nextCursor"], 5),
        (["items"], [valid_roster()["items"][0]] * 201),
        (["notes"], [{"code": "ok", "count": None}] * 9),
        (["items"], "none"),
        (["collector", "state"], "Bad"),
    ]
    for path, value in cases:
        with pytest.raises(ContractViolation):
            READERS["roster"](mutated(valid_roster(), path, value))


def test_roster_item_rejects_wrong_enums_and_shapes() -> None:
    item = valid_roster()["items"][0]
    for path, value in (
        (["presence"], "PRESENT"),
        (["condition", "basis"], "guess"),
        (["condition", "signals", "needsInput"], "yes"),
        (["coverage", "state"], "maybe"),
        (["coverage", "openGapCount"], 1_000_001),
        (["avatar"], {"kind": "image"}),
        (["avatar"], {"kind": "image", "ref": "a b"}),
        (["avatar"], "image"),
        (["displayName"], 5),
        (["workers"], []),
        (["contractVersion"], 2),
    ):
        with pytest.raises(ContractViolation):
            READERS["roster-item"](mutated(item, path, value))


@pytest.mark.parametrize(
    ("event_type", "key"),
    [
        ("chat_done", "pct"),
        ("chat_done", "reset"),
        ("chat_done", "waiting"),
        ("chat_done", "turn"),
        ("context_usage", "pct"),
        ("tool_call", "tool"),
        ("tool_result", "isShell"),
    ],
)
def test_an_unknown_or_foreign_payload_key_is_rejected(event_type: str, key: str) -> None:
    case_name = {
        "chat_done": "chat-done-with-turn",
        "context_usage": "context-usage",
        "tool_call": "tool-call",
        "tool_result": "tool-result",
    }[event_type]
    body = copy.deepcopy(
        load_json(CONTRACTS_DIR / "cases" / "observation" / "v1" / "valid" / f"{case_name}.json")
    )
    body["payload"][key] = 1
    with pytest.raises(ContractViolation):
        READERS["observation"](body)


def test_a_payload_for_a_different_event_type_is_rejected() -> None:
    body = valid_chat_done()
    body["payload"] = {"usedTokens": 1, "windowTokens": 2}
    with pytest.raises(ContractViolation):
        READERS["observation"](body)


def test_a_nested_payload_value_is_rejected() -> None:
    for value in ({"a": 1}, [True], "text"):
        with pytest.raises(ContractViolation):
            READERS["observation"](mutated(valid_chat_done(), ["payload", "continuing"], value))
        with pytest.raises(ContractViolation):
            READERS["observation"](mutated(valid_row_change(), ["payload", "running"], value))


def test_row_change_needs_a_digest_and_a_null_dedup_key_and_events_the_opposite() -> None:
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_row_change(), ["dedupKey"], "row:x"))
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_row_change(), ["factDigest"], None))
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_chat_done(), ["factDigest"], "0" * 64))


def test_source_ref_must_match_the_kind() -> None:
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_chat_done(), ["sourceRef", "eventType"], "slot-row"))
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_chat_done(), ["sourceRef", "eventType"], "slots"))
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_chat_done(), ["sourceRef", "eventType"], ["x"]))
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_row_change(), ["sourceRef", "eventType"], "chat_done"))
    with pytest.raises(ContractViolation):
        READERS["observation"](mutated(valid_row_change(), ["sourceRef"], "ref"))


@pytest.mark.parametrize(
    "value", [None, 0, "text", [], [{"a": 1}], math.nan, {"a": {"b": {}}}, {1: 2}, b"{}"]
)
def test_every_reader_raises_only_contract_violation_on_arbitrary_input(value: object) -> None:
    for reader in READERS.values():
        with pytest.raises(ContractViolation):
            reader(value)


def test_key_sets_agree_across_wire_parse_and_the_schema() -> None:
    schema = REGISTRY["urn:specter-arena:contract:observation:v1"]["definitions"]
    assert ROW_FACT_KEYS == set(schema["rowFacts"]["properties"]) == SLOT_ROW_KEYS | {"running"}
    expected = {
        "chat_done": set(schema["chatDonePayload"]["properties"]),
        "tool_call": set(schema["toolCallPayload"]["properties"]),
        "context_usage": set(schema["contextUsagePayload"]["properties"]),
        "tool_result": set(),
        "chat_status": set(),
    }
    assert {name: set(keys) for name, keys in EVENT_PAYLOAD_KEYS.items()} == expected
    assert dict(EVENT_PAYLOAD_KEYS) == dict(PARSE_EVENT_KEYS)


def observation(parsed: RowFact | EventParse, installation: str = "inst_fake_01") -> ObservationIn:
    if isinstance(parsed, RowFact):
        return ObservationIn(
            installation_id=installation,
            dm_key=BOT,
            slot_key=parsed.slot_key,
            kind="row-change",
            event_type="slot-row",
            received_at_ms=1_760_000_000_500,
            payload=dict(parsed.facts),
            source_time_ms=parsed.source_time_ms,
            turn=parsed.turn,
            turn_gen=parsed.turn_gen,
            fact_digest=parsed.fact_digest,
        )
    return ObservationIn(
        installation_id=installation,
        dm_key=BOT,
        slot_key=parsed.slot_key,
        kind="event",
        event_type=parsed.event_type,
        received_at_ms=1_760_000_000_500,
        payload=dict(parsed.payload),
        turn=parsed.turn,
        turn_gen=parsed.turn_gen,
        tool_call_id=parsed.tool_call_id,
        dedup_key=parsed.dedup_key,
    )


def test_every_collector_row_item_round_trips_through_to_wire_and_the_reader() -> None:
    row = {
        "key": BOT,
        "mode": "member",
        "running": True,
        "turn": 7,
        "turn_gen": "a8b8767e",
        "last_activity_ts": "2026-11-16T12:00:00+00:00",
        "needs_input": False,
        "stop_state": "idle",
        "wait_state": "",
        "created": "2026-11-16T11:00:00+00:00",
        "parent": {"key": WORKER},
    }
    worker = {"key": WORKER, "origin": "user", "created_by": BOT, "running": False}
    result = parse_slots({"type": "slots", "data": [row, worker]}, frozenset())
    assert len(result.bots) == 1 and len(result.workers) == 1
    validate = compile_schema("urn:specter-arena:contract:observation:v1", REGISTRY)
    for parsed in (*result.bots, *result.workers):
        body = to_wire(observation(parsed), binding_id="bnd_0a1b2c3d")
        validate(json.loads(json.dumps(body)))
        assert READERS["observation"](body) == body
        assert body["dedupKey"] is None
        assert body["factDigest"] == parsed.fact_digest
        assert body["sourceRef"] == {"slotKey": parsed.slot_key, "eventType": "slot-row"}


@pytest.mark.parametrize(
    ("event_type", "data"),
    [
        ("chat_done", {"slot": BOT, "turn": 7, "turn_gen": "a8b8767e", "continuing": False}),
        ("chat_done", {"slot": BOT, "continuing": True, "needs_input": True}),
        ("tool_call", {"slot": BOT, "tool_call_id": "tc_1", "is_shell": True}),
        ("tool_result", {"slot": BOT, "tool_call_id": "tc_1"}),
        ("context_usage", {"slot": BOT, "used_tokens": 5, "window_tokens": 9, "pct": 0.5}),
        ("chat_status", {"slot": BOT, "status": "free text"}),
    ],
)
def test_every_collector_event_item_round_trips_through_to_wire_and_the_reader(
    event_type: str, data: dict[str, object]
) -> None:
    parsed = parse_event(event_type, {"type": event_type, "data": data})
    assert isinstance(parsed, EventParse)
    body = to_wire(observation(parsed), binding_id="bnd_0a1b2c3d")
    compile_schema("urn:specter-arena:contract:observation:v1", REGISTRY)(
        json.loads(json.dumps(body))
    )
    assert READERS["observation"](body) == body
    assert body["factDigest"] is None
    assert "free text" not in json.dumps(body)


def test_wire_imports_only_light_modules_and_store_for_types() -> None:
    tree = ast.parse(WIRE_MODULE.read_text())
    runtime: set[str] = set()
    type_only: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module:
            runtime.add(node.module)
        elif isinstance(node, ast.Import):
            runtime.update(alias.name for alias in node.names)
        elif isinstance(node, ast.If):
            for inner in ast.walk(node):
                if isinstance(inner, ast.ImportFrom):
                    type_only.add(f"{'.' * inner.level}{inner.module}")
    assert runtime <= {"__future__", "collections.abc", "math", "re", "typing"}
    assert type_only == {".store"}
