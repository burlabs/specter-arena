import json
from collections.abc import Mapping
from dataclasses import asdict, is_dataclass, replace
from pathlib import Path

import pytest

from backend.specter_arena.collector.lanes import EventLane, RowLane
from backend.specter_arena.collector.parse import (
    EVENT_FIELDS,
    EVENT_PAYLOAD_KEYS,
    ROW_FACTS,
    SLOT_ROW_KEYS,
    EventParse,
    RowFact,
    aware_ms,
    fact_digest,
    load_frame,
    parse_event,
    parse_slots,
    peek_type,
    raw_within_cap,
)
from backend.specter_arena.collector.vocabulary import HANDLED_TYPES, LIMITS

RECORDED = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "recorded"
    / "crew-0.12.2"
    / "s1-v1-event-capture.json"
)

BOT_A = "member-bot-a-9d63166ee3a3.memory-member-bot-a-9d63166ee3a3-aa11"
BOT_B = "member-bot-b-0a1b2c3d4e5f.memory-member-bot-b-0a1b2c3d4e5f-bb22"
STORE_LESS = "member-bot-c"
WORKER = "chat-61-1794779966"
AWARE = "2026-11-16T12:00:00+00:00"
AWARE_MS = 1_794_830_400_000
SENTINEL = "SENTINEL-must-never-leave-the-parser"

DENIED_FIELDS = (
    "title",
    "messages",
    "last_message",
    "prompt_preview",
    "welcome_message",
    "options",
    "todo",
    "mcp_report",
    "source_links",
    "workspace",
    "project",
    "tags",
    "attribution",
    "pending_approval_info",
    "slack_channel",
    "agent",
    "model",
)


def bot_row(key: str = BOT_A, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "key": key,
        "mode": "member",
        "running": True,
        "turn": 7,
        "turn_gen": "a8b8767e",
        "last_activity_ts": AWARE,
    }
    row.update(overrides)
    return row


def worker_row(
    created_by: str = BOT_A, key: str = WORKER, **overrides: object
) -> dict[str, object]:
    row: dict[str, object] = {
        "key": key,
        "origin": "user",
        "created_by": created_by,
        "running": False,
        "lineage_minted": True,
    }
    row.update(overrides)
    return row


def frame(*rows: object, partial: bool | None = None) -> dict[str, object]:
    body: dict[str, object] = {"type": "slots", "data": list(rows)}
    if partial is not None:
        body["slotsPartial"] = partial
    return body


def walk(value: object) -> list[object]:
    """Every scalar and key reachable in a parser output."""
    found: list[object] = []
    if is_dataclass(value) and not isinstance(value, type):
        return walk(asdict(value))
    if isinstance(value, Mapping):
        for key, child in value.items():
            found.append(key)
            found.extend(walk(child))
    elif isinstance(value, list | tuple | set | frozenset):
        for child in value:
            found.extend(walk(child))
    else:
        found.append(value)
    return found


def contains(value: object, needle: str) -> bool:
    return any(needle in item for item in walk(value) if isinstance(item, str))


def event(event_type: str, **data: object) -> dict[str, object]:
    return {"type": event_type, "data": data}


# --- load_frame, peek_type, size cap -------------------------------------------------------


def test_load_frame_returns_a_typed_dict() -> None:
    assert load_frame('{"type":"slots","data":[]}') == ({"type": "slots", "data": []}, None)


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "not json",
        "[1,2]",
        '"text"',
        "{}",
        '{"type":5}',
        '{"type":"x"',
        "NaN",
        '{"type":"a","v":NaN}',
        '{"type":"a","v":Infinity}',
        b'{"type":"slots"}',
        None,
        7,
    ],
)
def test_load_frame_rejects_malformed_input_with_a_reason(raw: object) -> None:
    assert load_frame(raw) == (None, "malformed-frame")


def test_deeply_nested_json_does_not_raise() -> None:
    assert load_frame("[" * 50_000 + "]" * 50_000) == (None, "malformed-frame")
    assert load_frame('{"type":"a","v":' + "[" * 50_000 + "]" * 50_000 + "}") == (
        None,
        "malformed-frame",
    )


def test_a_two_mebibyte_string_is_loaded_or_rejected_but_never_raises() -> None:
    huge = '{"type":"a","v":"' + "x" * (2 * 1024 * 1024) + '"}'
    assert load_frame(huge) == (None, "oversize-frame")
    near = '{"type":"a","v":"' + "x" * (2 * 1024 * 1024 - 100) + '"}'
    loaded, reason = load_frame(near)
    assert reason is None and loaded is not None


def test_peek_type() -> None:
    assert peek_type('{"type":"chat_done","data":{}}') == "chat_done"
    assert peek_type('{ "type" : "slots"}') == "slots"
    assert peek_type('{"data":{},"type":"slots"}') is None
    assert peek_type("[]") is None
    assert peek_type('{"type":"Bad"}') is None
    assert peek_type("") is None


def test_raw_within_cap() -> None:
    assert raw_within_cap("x" * LIMITS.raw_frame_max_chars)
    assert not raw_within_cap("x" * (LIMITS.raw_frame_max_chars + 1))


# --- timestamps ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (AWARE, AWARE_MS),
        ("2026-11-16T12:00:00Z", AWARE_MS),
        ("2026-11-16T05:00:00-07:00", AWARE_MS),
        ("2026-11-16T12:00:00.250+00:00", AWARE_MS + 250),
        ("2026-11-16T12:00:00", None),
        ("garbage", None),
        ("", None),
        (1794916800, None),
        (1794916800.5, None),
        (None, None),
        ("0001-01-01T00:00:00+00:00", None),
        ("9999-12-31T23:59:59+00:00", 253_402_300_799_000),
    ],
)
def test_only_aware_iso_timestamps_yield_milliseconds(value: object, expected: int | None) -> None:
    assert aware_ms(value) == expected


# --- parse_slots ---------------------------------------------------------------------------


def test_synthetic_snapshot_keeps_bots_and_workers_and_counts_the_rest() -> None:
    other = [{"key": f"chat-{index}", "title": SENTINEL, "running": False} for index in range(39)]
    result = parse_slots(
        frame(bot_row(BOT_A), bot_row(BOT_B), worker_row(BOT_A), *other), frozenset()
    )
    assert [row.slot_key for row in result.bots] == [BOT_A, BOT_B]
    assert [row.slot_key for row in result.workers] == [WORKER]
    assert result.other_rows == 39
    assert result.rejected == ()
    assert result.partial is False
    assert result.frame_reason is None
    for kept in (*result.bots, *result.workers):
        assert len(kept.fact_digest) == 64
        assert set(kept.facts) <= SLOT_ROW_KEYS


def test_bot_row_facts_use_the_wire_names() -> None:
    row = bot_row(
        mode="member",
        origin="chat",
        pending_approval=False,
        needs_input=True,
        has_options=False,
        waiting_for_input=False,
        interrupted=False,
        stopping=False,
        admission_queued=False,
        queue_depth=2,
        compacting=False,
        subagents_running=1,
        subagents_queued=0,
        stop_state="idle",
        wait_state="",
        created="2026-11-16T11:00:00+00:00",
        parent={"key": WORKER, "title": SENTINEL},
    )
    [bot] = parse_slots(frame(row), frozenset()).bots
    assert bot.dm is not None and bot.dm.member_id == "bot-a-9d63166ee3a3"
    assert bot.facts == {
        "running": True,
        "turn": 7,
        "turnGen": "a8b8767e",
        "slotMode": "member",
        "slotOrigin": "chat",
        "pendingApproval": False,
        "needsInput": True,
        "hasOptions": False,
        "waitingForInput": False,
        "interrupted": False,
        "stopping": False,
        "admissionQueued": False,
        "queueDepth": 2,
        "compacting": False,
        "subagentsRunning": 1,
        "subagentsQueued": 0,
        "stopState": "idle",
        "waitStatePresent": True,
        "parentKey": WORKER,
        "lastActivityMs": AWARE_MS,
        "createdMs": AWARE_MS - 3_600_000,
    }
    assert (bot.turn, bot.turn_gen, bot.source_time_ms) == (7, "a8b8767e", AWARE_MS)
    assert bot.created_by is None


def test_wait_state_none_is_not_present() -> None:
    [bot] = parse_slots(frame(bot_row(wait_state=None)), frozenset()).bots
    assert bot.facts["waitStatePresent"] is False


def test_sentinel_in_every_denied_field_never_leaves_the_parser() -> None:
    row = bot_row()
    worker = worker_row()
    for name in DENIED_FIELDS:
        row[name] = SENTINEL
        worker[name] = SENTINEL
    row["pending_approval_info"] = {"tool_input": SENTINEL}
    row["parent"] = {"key": WORKER, "title": SENTINEL}
    result = parse_slots(frame(row, worker, {"key": "other", "title": SENTINEL}), frozenset())
    assert result.bots and result.workers
    assert not contains(result, SENTINEL)
    assert not contains(
        json.dumps([dict(r.facts) for r in (*result.bots, *result.workers)]), SENTINEL
    )


def test_worker_rows_keep_created_by_and_nothing_else_free_form() -> None:
    [worker] = parse_slots(frame(bot_row(), worker_row()), frozenset()).workers
    assert worker.dm is None
    assert worker.created_by == BOT_A
    assert worker.facts["createdBy"] == BOT_A
    assert worker.facts["lineageMinted"] is True


def test_worker_attribution_is_exact_never_by_prefix_or_substring() -> None:
    near = [
        worker_row(BOT_A + "x", key="chat-1"),
        worker_row(BOT_A[:-1], key="chat-2"),
        worker_row("", key="chat-3"),
        worker_row(BOT_A, key="chat-4", origin="cron"),
        worker_row(BOT_B, key="chat-5"),
    ]
    result = parse_slots(frame(bot_row(), *near), frozenset())
    assert result.workers == ()
    assert result.other_rows == 5


def test_worker_of_an_already_bound_bot_is_attributed_without_its_dm_row() -> None:
    result = parse_slots(frame(worker_row(BOT_B)), frozenset({BOT_B}))
    assert [row.created_by for row in result.workers] == [BOT_B]


def test_bad_worker_key_is_rejected_by_reason() -> None:
    result = parse_slots(frame(bot_row(), worker_row(key="bad key!")), frozenset())
    assert result.rejected == ("bad-worker-key",)
    assert result.workers == ()


def test_store_less_keys_are_counted_by_digest_never_bound_or_stored() -> None:
    result = parse_slots(frame(bot_row(STORE_LESS), bot_row(STORE_LESS)), frozenset())
    assert result.bots == () and result.rejected == ()
    assert len(result.store_less) == 1
    assert len(result.store_less[0]) == 12
    assert STORE_LESS not in json.dumps(result.store_less)


def test_a_dm_shaped_key_whose_mode_is_not_member_is_not_a_bot_row() -> None:
    result = parse_slots(frame(bot_row(mode="chat")), frozenset())
    assert result.bots == ()
    assert result.other_rows == 1


MALFORMED_ROWS = [
    bot_row(running=1),
    bot_row(running="true"),
    bot_row(running=None),
    {k: v for k, v in bot_row().items() if k != "running"},
]


@pytest.mark.parametrize("row", MALFORMED_ROWS)
def test_a_row_without_a_real_running_bool_is_rejected_and_neighbours_survive(
    row: dict[str, object],
) -> None:
    result = parse_slots(frame(row, bot_row(BOT_B)), frozenset())
    assert result.rejected == ("bad-row",)
    assert [bot.slot_key for bot in result.bots] == [BOT_B]


def test_wrong_typed_optional_facts_become_absent_and_are_counted() -> None:
    row = bot_row(
        turn="7",
        queue_depth=-1,
        subagents_running=True,
        needs_input=1,
        turn_gen=12,
        mode="member",
        stop_state="Bad State",
    )
    row["origin"] = float("nan")
    [bot] = parse_slots(frame(row), frozenset()).bots
    assert set(bot.facts) == {"running", "slotMode", "lastActivityMs"}
    assert bot.turn is None and bot.turn_gen is None
    assert bot.nulled == 7


@pytest.mark.parametrize(
    "junk", [None, 5, "text", ["list"], {"key": 5}, {"key": None}, {"nokey": True}]
)
def test_junk_rows_are_counted_as_other_rows(junk: object) -> None:
    result = parse_slots(frame(junk, bot_row()), frozenset())
    assert result.other_rows == 1
    assert len(result.bots) == 1


def test_a_hostile_numeric_key_is_not_a_bot() -> None:
    result = parse_slots(frame(bot_row(key=5)), frozenset())  # type: ignore[arg-type]
    assert result.bots == () and result.rejected == ()


@pytest.mark.parametrize("data", [None, "rows", {"a": 1}, 5])
def test_a_frame_whose_data_is_not_a_list_is_quarantined_as_a_whole(data: object) -> None:
    result = parse_slots({"type": "slots", "data": data}, frozenset())
    assert result.frame_reason == "schema-mismatch"
    assert result.bots == () and result.workers == ()


def test_a_frame_with_too_many_rows_is_quarantined_as_a_whole() -> None:
    result = parse_slots(frame(*[{"key": f"c{index}"} for index in range(2_001)]), frozenset())
    assert result.frame_reason == "schema-mismatch"
    assert (
        parse_slots(
            frame(*[{"key": f"c{index}"} for index in range(2_000)]), frozenset()
        ).other_rows
        == 2_000
    )


def test_partial_flag_is_read_from_the_connect_frame_only_when_true() -> None:
    assert parse_slots(frame(partial=True), frozenset()).partial is True
    assert parse_slots(frame(partial=False), frozenset()).partial is False
    assert (
        parse_slots({"type": "slots", "data": [], "slotsPartial": "yes"}, frozenset()).partial
        is False
    )
    assert (
        parse_slots({"type": "slots", "data": "x", "slotsPartial": True}, frozenset()).partial
        is True
    )


def test_a_row_over_64_kib_is_rejected_before_the_allow_list_and_neighbours_are_kept() -> None:
    big = bot_row(BOT_A, title="x" * 70 * 1024)
    result = parse_slots(
        frame(big, bot_row(BOT_B), worker_row(BOT_B, title="y" * 70 * 1024)), frozenset()
    )
    assert result.rejected == ("oversize-frame", "oversize-frame")
    assert [bot.slot_key for bot in result.bots] == [BOT_B]
    assert result.workers == ()


def test_a_row_just_under_the_cap_is_kept() -> None:
    row = bot_row(title="x" * 60 * 1024)
    assert len(parse_slots(frame(row), frozenset()).bots) == 1


def test_a_row_that_cannot_be_measured_is_rejected_not_raised() -> None:
    row = bot_row()
    row["loop"] = row
    result = parse_slots(frame(row), frozenset())
    assert result.rejected == ("bad-row",)


def test_a_reduced_payload_over_the_store_bound_is_rejected_oversize(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from backend.specter_arena.collector import parse as parse_module

    monkeypatch.setattr(parse_module, "LIMITS", replace(LIMITS, payload_max_bytes=50))
    result = parse_slots(frame(bot_row()), frozenset())
    assert result.rejected == ("oversize",)


# --- digests and timestamps on rows -------------------------------------------------------


def test_activity_time_alone_does_not_change_the_digest() -> None:
    first = parse_slots(frame(bot_row(last_activity_ts=AWARE)), frozenset()).bots[0]
    later = parse_slots(
        frame(bot_row(last_activity_ts="2026-11-16T13:00:00+00:00")), frozenset()
    ).bots[0]
    assert first.source_time_ms != later.source_time_ms
    assert first.fact_digest == later.fact_digest


def test_one_changed_fact_changes_the_digest() -> None:
    first = parse_slots(frame(bot_row()), frozenset()).bots[0]
    changed = parse_slots(frame(bot_row(running=False)), frozenset()).bots[0]
    turned = parse_slots(frame(bot_row(turn=8)), frozenset()).bots[0]
    assert len({first.fact_digest, changed.fact_digest, turned.fact_digest}) == 3


def test_digest_is_independent_of_key_order() -> None:
    assert fact_digest({"a": 1, "b": True}) == fact_digest({"b": True, "a": 1})
    assert fact_digest({"a": 1, "lastActivityMs": 5}) == fact_digest({"a": 1, "lastActivityMs": 9})


@pytest.mark.parametrize("stamp", ["2026-11-16T12:00:00", "garbage", 1794916800, None, ""])
def test_a_naive_or_unparsable_activity_stamp_gives_no_source_time(stamp: object) -> None:
    [bot] = parse_slots(frame(bot_row(last_activity_ts=stamp)), frozenset()).bots
    assert bot.source_time_ms is None
    assert "lastActivityMs" not in bot.facts


# --- parse_event ---------------------------------------------------------------------------


def test_chat_done_keeps_two_flags_and_puts_turn_on_the_envelope() -> None:
    parsed = parse_event(
        "chat_done",
        event(
            "chat_done",
            slot=BOT_A,
            turn=7,
            turn_gen="a8b8767e",
            continuing=False,
            needs_input=True,
            text=SENTINEL,
        ),
    )
    assert isinstance(parsed, EventParse)
    assert parsed.payload == {"continuing": False, "needsInput": True}
    assert (parsed.turn, parsed.turn_gen, parsed.slot_key) == (7, "a8b8767e", BOT_A)
    assert parsed.dedup_key == f"chat_done:{BOT_A}:a8b8767e:7"
    assert not contains(parsed, SENTINEL)


def test_chat_done_dedup_key_is_stable_and_none_without_the_turn_pair() -> None:
    body = event("chat_done", slot=BOT_A, turn=7, turn_gen="a8b8767e")
    first, second = parse_event("chat_done", body), parse_event("chat_done", body)
    assert isinstance(first, EventParse) and isinstance(second, EventParse)
    assert first.dedup_key == second.dedup_key is not None
    for missing in (
        event("chat_done", slot=BOT_A, turn=7),
        event("chat_done", slot=BOT_A, turn_gen="a8b8767e"),
        event("chat_done", slot=BOT_A, turn=7, turn_gen="NOT HEX"),
        event("chat_done", slot=BOT_A, turn="7", turn_gen="a8b8767e"),
    ):
        parsed = parse_event("chat_done", missing)
        assert isinstance(parsed, EventParse) and parsed.dedup_key is None


def test_tool_events_carry_the_id_on_the_envelope_only() -> None:
    call = parse_event(
        "tool_call",
        event(
            "tool_call",
            slot=BOT_A,
            tool_call_id="tc_1",
            is_shell=True,
            tool=SENTINEL,
            kind=SENTINEL,
            input_preview=SENTINEL,
        ),
    )
    result = parse_event(
        "tool_result", event("tool_result", slot=BOT_A, tool_call_id="tc_1", is_error=True)
    )
    assert isinstance(call, EventParse) and isinstance(result, EventParse)
    assert call.payload == {"isShell": True}
    assert result.payload == {}
    assert call.tool_call_id == result.tool_call_id == "tc_1"
    assert call.dedup_key == f"tool_call:{BOT_A}:tc_1"
    assert result.dedup_key == f"tool_result:{BOT_A}:tc_1"
    assert not contains(call, SENTINEL)


def test_tool_events_without_a_usable_id_have_no_dedup_key() -> None:
    for bad in (None, 5, "has space", "", "x" * 129):
        parsed = parse_event("tool_call", event("tool_call", slot=BOT_A, tool_call_id=bad))
        assert isinstance(parsed, EventParse)
        assert parsed.dedup_key is None and parsed.tool_call_id is None


def test_context_usage_keeps_token_counts_and_drops_pct_and_reset() -> None:
    parsed = parse_event(
        "context_usage",
        event(
            "context_usage",
            slot=BOT_A,
            used_tokens=1200,
            window_tokens=200_000,
            pct=0.6,
            reset=True,
        ),
    )
    assert isinstance(parsed, EventParse)
    assert parsed.payload == {"usedTokens": 1200, "windowTokens": 200_000}
    assert parsed.dedup_key is None


def test_chat_status_is_an_empty_payload() -> None:
    parsed = parse_event("chat_status", event("chat_status", slot=BOT_A, status=SENTINEL))
    assert isinstance(parsed, EventParse)
    assert parsed.payload == {} and parsed.dedup_key is None
    assert not contains(parsed, SENTINEL)


def test_wrong_typed_event_fields_are_dropped_and_counted() -> None:
    parsed = parse_event(
        "context_usage", event("context_usage", slot=BOT_A, used_tokens="12", window_tokens=-1)
    )
    assert isinstance(parsed, EventParse)
    assert parsed.payload == {} and parsed.nulled == 2


def test_no_payload_ever_holds_envelope_or_forbidden_keys() -> None:
    forbidden = {"turn", "turnGen", "toolCallId", "pct", "reset", "waiting"}
    for keys in EVENT_PAYLOAD_KEYS.values():
        assert keys.isdisjoint(forbidden)
    assert forbidden.isdisjoint(SLOT_ROW_KEYS - {"turn", "turnGen"})
    assert set(EVENT_FIELDS) <= HANDLED_TYPES


@pytest.mark.parametrize("slot", [None, 5, "", "has space", "x" * 257, ["a"]])
def test_events_with_an_unusable_slot_are_a_schema_mismatch(slot: object) -> None:
    assert parse_event("chat_done", event("chat_done", slot=slot)) == "schema-mismatch"


@pytest.mark.parametrize(
    "body",
    [{"type": "chat_done"}, {"type": "chat_done", "data": []}, {"type": "chat_done", "data": "x"}],
)
def test_events_without_a_data_object_are_a_schema_mismatch(body: dict[str, object]) -> None:
    assert parse_event("chat_done", body) == "schema-mismatch"


def test_unknown_event_types_are_a_reason_not_an_exception() -> None:
    assert parse_event("brand_new", event("brand_new", slot=BOT_A)) == "unknown-event-type"
    assert parse_event("slots", {"type": "slots", "data": {}}) == "unknown-event-type"


def test_recorded_0_12_2_event_shapes_parse_to_the_allow_list_only() -> None:
    rows = json.loads(RECORDED.read_text())["rows"]
    parsed_types: set[str] = set()
    for row in rows:
        event_type = row.get("eventType")
        if event_type not in EVENT_FIELDS:
            continue
        data = {key: value for key, value in row.items() if key in {"slot"} or key.islower()}
        result = parse_event(event_type, {"type": event_type, "data": {"slot": BOT_A, **data}})
        if isinstance(result, EventParse):
            parsed_types.add(event_type)
            assert set(result.payload) <= EVENT_PAYLOAD_KEYS[event_type]
    assert parsed_types


# --- fit with the lanes --------------------------------------------------------------------


def test_parser_outputs_satisfy_the_lane_protocols() -> None:
    [bot] = parse_slots(frame(bot_row()), frozenset()).bots
    rows: RowLane[RowFact] = RowLane()
    assert rows.put(bot, 1) is False
    assert rows.drain(1)[0][0] is bot
    parsed = parse_event("chat_status", event("chat_status", slot=BOT_A))
    assert isinstance(parsed, EventParse)
    events: EventLane[EventParse] = EventLane(2)
    events.put(parsed, BOT_A, 1)
    assert events.drain(1)[0][0] is parsed


def test_the_row_fact_table_and_wire_key_list_agree() -> None:
    wire_names = {name for name, _ in ROW_FACTS.values()}
    assert wire_names <= SLOT_ROW_KEYS
    assert SLOT_ROW_KEYS - wire_names == {
        "createdBy",
        "parentKey",
        "waitStatePresent",
        "lastActivityMs",
        "createdMs",
    }
    assert all(name.isidentifier() and name[0].islower() for name in SLOT_ROW_KEYS)
