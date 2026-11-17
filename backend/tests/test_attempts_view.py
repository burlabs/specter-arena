import dataclasses
from typing import Any

import pytest

from backend.specter_arena.attempts_view import (
    attempt_item_wire,
    attempts_body,
    end_signal_wire,
    window_wire,
)
from backend.specter_arena.store import ActivityWindow, AttemptsResult, AttemptView, Page
from backend.tests.contract_support import compile_schema, load_registry

REGISTRY = load_registry()
VALIDATE_ITEM = compile_schema("urn:specter-arena:contract:attempt-item:v1", REGISTRY)
VALIDATE_BODY = compile_schema("urn:specter-arena:contract:attempts:v1", REGISTRY)

AS_OF = 1_760_000_010_000


def attempt(**overrides: Any) -> AttemptView:
    base: dict[str, Any] = {
        "attempt_id": "att_0a1b2c3d4e5f60718293a4b5",
        "kind": "worker",
        "started_ms": AS_OF - 5_000,
        "ended_ms": None,
        "end_signal": None,
        "state": "working",
        "reason": "running",
    }
    return AttemptView(**{**base, **overrides})


def window(key: str, length_ms: int, **overrides: Any) -> ActivityWindow:
    base: dict[str, Any] = {
        "key": key,
        "from_ms": AS_OF - length_ms,
        "to_ms": AS_OF,
        "window_ms": length_ms,
        "observed_from_ms": AS_OF - length_ms,
        "covered_ms": length_ms // 2,
        "gap_count": 1,
        "bot_turns_started": 1,
        "workers_started": 1,
        "sample_size": 2,
        "ended": 1,
        "still_open": 1,
        "unknown": 0,
    }
    return ActivityWindow(**{**base, **overrides})


def result(*items: AttemptView, next_cursor: str | None = None) -> AttemptsResult:
    return AttemptsResult(
        binding_id="bnd_0a1b2c3d",
        page=Page(items=items, next_cursor=next_cursor),
        activity=(window("last7d", 604_800_000), window("last24h", 86_400_000)),
        revision=7,
    )


@pytest.mark.parametrize(
    ("stored", "wire"),
    [
        ("row-idle", "row-idle"),
        ("chat_done", "chat-done"),
        (None, None),
        ("chat-done", None),
        ("other", None),
        ("", None),
    ],
)
def test_end_signal_wire_maps_the_stored_forms_and_nulls_everything_else(
    stored: str | None, wire: str | None
) -> None:
    assert end_signal_wire(stored) == wire


def test_an_attempt_item_validates_and_carries_the_wire_end_signal() -> None:
    item = attempt_item_wire(
        attempt(
            kind="bot-turn",
            ended_ms=AS_OF,
            end_signal="chat_done",
            state="ended",
            reason="ended-chat-done",
        )
    )
    VALIDATE_ITEM(item)
    assert (item["endSignal"], item["endedMs"]) == ("chat-done", AS_OF)


def test_a_malformed_stored_token_falls_back_to_a_schema_valid_value() -> None:
    item = attempt_item_wire(attempt(kind="Worker", state="WORKING", reason="has space"))
    VALIDATE_ITEM(item)
    assert (item["kind"], item["condition"]) == (
        "unknown",
        {"state": "unknown", "reasonCode": "no-coverage"},
    )


def test_window_wire_has_exactly_the_schema_property_names() -> None:
    schema = REGISTRY["urn:specter-arena:contract:attempts:v1"]
    names = set(schema["definitions"]["window"]["properties"])
    assert set(window_wire(window("last24h", 86_400_000))) == names


def test_the_body_validates_and_lists_the_windows_in_wire_order() -> None:
    body = attempts_body(result(attempt(), next_cursor="abc"), AS_OF)
    VALIDATE_BODY(body)
    assert list(body["activity"]) == ["last24h", "last7d"]  # type: ignore[call-overload]
    assert (body["bindingId"], body["rosterRevision"], body["asOfMs"]) == ("bnd_0a1b2c3d", 7, AS_OF)
    assert body["nextCursor"] == "abc"


def test_a_missing_window_key_fails_loudly() -> None:
    broken = dataclasses.replace(result(), activity=(window("last24h", 86_400_000),))
    with pytest.raises(KeyError):
        attempts_body(broken, AS_OF)


def test_the_view_type_has_no_slot_key_field() -> None:
    assert "slot_key" not in {field.name for field in dataclasses.fields(AttemptView)}
