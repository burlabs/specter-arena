from dataclasses import replace
from typing import Any

import pytest

from backend.specter_arena.store.fold import (
    BOT_TURN,
    WORKER,
    BotStateRow,
    FoldObs,
    attempt_id_for,
    bot_turn_step,
    fold_event,
    fold_row,
    is_stale,
    worker_step,
)

BINDING = "bnd_000000000000000000000001"
DM = "member-alpha.memory-store"
WORKER_SLOT = "chat-1"


def obs(seq: int = 1, **fields: Any) -> FoldObs:
    base: dict[str, Any] = {
        "seq": seq,
        "binding_id": BINDING,
        "dm_key": DM,
        "slot_key": DM,
        "kind": "row-change",
        "event_type": "slot-row",
        "turn": 3,
        "turn_gen": "ab12",
        "received_at_ms": 1_000 + seq,
        "fact_digest": "0" * 64,
        "payload": {"running": True, "turn": 3, "turnGen": "ab12", "lastActivityMs": 50},
    }
    base.update(fields)
    return FoldObs(**base)


def event(seq: int, event_type: str = "chat_done", **fields: Any) -> FoldObs:
    return obs(
        seq,
        kind="event",
        event_type=event_type,
        payload={"continuing": False},
        fact_digest=None,
        **fields,
    )


def test_a_dm_row_sets_the_typed_facts_and_keeps_the_rest_as_extra_facts() -> None:
    row = obs(
        payload={
            "running": True,
            "turn": 3,
            "turnGen": "ab12",
            "lastActivityMs": 50,
            "pendingApproval": True,
            "waitStatePresent": False,
            "queueDepth": 2,
            "stopState": "idle",
        }
    )
    state = fold_row(None, row)
    assert state is not None
    assert (state.running, state.turn, state.turn_gen, state.last_activity_ms) == (
        True,
        3,
        "ab12",
        50,
    )
    assert state.pending_approval is True
    assert state.needs_input is None and state.interrupted is None
    assert state.extra_facts == {"waitStatePresent": False, "queueDepth": 2, "stopState": "idle"}
    assert (state.row_observed_ms, state.observed_seq, state.row_digest) == (1001, 1, "0" * 64)
    assert state.dm_slot_key == DM and state.binding_id == BINDING


def test_a_newer_row_replaces_every_fact_so_an_absent_flag_becomes_unknown() -> None:
    first = fold_row(
        None, obs(1, payload={"running": True, "turn": 3, "turnGen": "ab12", "interrupted": True})
    )
    second = fold_row(
        first, obs(2, payload={"running": False, "turn": 4, "turnGen": "ab12"}, turn=4)
    )
    assert second is not None
    assert (second.running, second.turn, second.interrupted) == (False, 4, None)


def test_a_row_with_a_lower_turn_in_the_same_generation_is_ignored() -> None:
    state = fold_row(None, obs(1, turn=5, payload={"running": True, "turn": 5, "turnGen": "ab12"}))
    stale = obs(2, turn=4, payload={"running": False, "turn": 4, "turnGen": "ab12"})
    assert fold_row(state, stale) is None


def test_an_equal_turn_with_lower_activity_is_ignored_and_higher_applies() -> None:
    state = fold_row(
        None, obs(1, payload={"running": True, "turn": 3, "turnGen": "ab12", "lastActivityMs": 50})
    )
    older = obs(2, payload={"running": False, "turn": 3, "turnGen": "ab12", "lastActivityMs": 49})
    newer = obs(3, payload={"running": False, "turn": 3, "turnGen": "ab12", "lastActivityMs": 51})
    assert fold_row(state, older) is None
    applied = fold_row(state, newer)
    assert applied is not None and applied.running is False


def test_a_different_generation_always_applies_even_with_a_lower_turn() -> None:
    state = fold_row(None, obs(1, turn=9, payload={"running": True, "turn": 9, "turnGen": "ab12"}))
    restarted = obs(
        2, turn=1, turn_gen="cd34", payload={"running": True, "turn": 1, "turnGen": "cd34"}
    )
    applied = fold_row(state, restarted)
    assert applied is not None and (applied.turn, applied.turn_gen) == (1, "cd34")


def test_a_state_made_only_of_events_does_not_make_the_first_row_stale() -> None:
    state, _ = fold_event(None, event(1, turn=1))
    first = fold_row(state, obs(2))
    assert first is not None and first.running is True
    assert first.event_observed_ms == 1001


@pytest.mark.parametrize(
    "state,observed,stale",
    [
        (("a", 5, 10), ("a", 4, 99), True),
        (("a", 5, 10), ("a", 6, 1), False),
        (("a", 5, 10), ("a", 5, 9), True),
        (("a", 5, 10), ("a", 5, 10), False),
        (("a", 5, 10), ("a", 5, 11), False),
        (("a", 5, None), ("a", 5, 1), False),
        (("a", 5, 10), ("a", 5, None), False),
        (("a", None, 10), ("a", None, 9), True),
        (("a", 5, 10), ("b", 1, 1), False),
        ((None, 5, 10), ("a", 1, 1), False),
        (("a", 5, 10), (None, 1, 1), False),
    ],
)
def test_the_stale_rule(
    state: tuple[str | None, int | None, int | None],
    observed: tuple[str | None, int | None, int | None],
    stale: bool,
) -> None:
    assert is_stale(*state, *observed) is stale


def test_events_never_change_running_and_chat_done_sets_the_terminal_from_the_columns() -> None:
    state = fold_row(None, obs(1))
    done, terminal = fold_event(state, event(2, turn=3))
    assert terminal is True
    assert (done.running, done.last_terminal_turn, done.last_terminal_gen) == (True, 3, "ab12")
    assert done.event_observed_ms == 1002 and done.observed_seq == 2
    status, applied = fold_event(done, event(3, "chat_status", turn=None, turn_gen=None))
    assert applied is False and status.running is True
    assert status.last_terminal_turn == 3
    assert status.event_observed_ms == 1003


def test_a_stale_chat_done_is_evidence_only() -> None:
    state = fold_row(None, obs(1, turn=5, payload={"running": True, "turn": 5, "turnGen": "ab12"}))
    late, terminal = fold_event(state, event(2, turn=4))
    assert terminal is False
    assert late.last_terminal_turn is None
    assert late.event_observed_ms == 1002


def test_the_event_clock_only_moves_forward() -> None:
    state = BotStateRow(BINDING, DM, event_observed_ms=5_000)
    late, _ = fold_event(state, event(1, "tool_call", turn=None, turn_gen=None))
    assert late.event_observed_ms == 5_000


def test_a_bot_turn_attempt_opens_on_a_running_row_and_closes_on_an_idle_row() -> None:
    opening = obs(7)
    opened = bot_turn_step(None, opening, True, "row-idle")
    assert opened is not None
    assert (opened.kind, opened.started_seq, opened.running, opened.end_signal) == (
        BOT_TURN,
        7,
        True,
        None,
    )
    assert opened.attempt_id == attempt_id_for(BINDING, DM, BOT_TURN, 7)
    assert bot_turn_step(opened, obs(8), True, "row-idle") is None
    closed = bot_turn_step(opened, obs(9), False, "row-idle")
    assert closed is not None
    assert (closed.running, closed.ended_seq, closed.end_signal) == (False, 9, "row-idle")
    assert closed.attempt_id == opened.attempt_id


def test_an_idle_row_with_no_open_attempt_opens_nothing() -> None:
    assert bot_turn_step(None, obs(1), False, "row-idle") is None
    assert bot_turn_step(None, obs(1), None, "row-idle") is None


def test_chat_done_closes_the_open_attempt() -> None:
    opened = bot_turn_step(None, obs(1), True, "row-idle")
    closed = bot_turn_step(opened, event(2), None, "chat_done")
    assert closed is not None and closed.end_signal == "chat_done" and closed.running is False


def worker(seq: int, running: bool, created: int | None = 77) -> FoldObs:
    payload: dict[str, Any] = {"running": running, "createdBy": DM}
    if created is not None:
        payload["createdMs"] = created
    return obs(seq, slot_key=WORKER_SLOT, turn=None, turn_gen=None, payload=payload)


def test_a_worker_attempt_mirrors_its_newest_row() -> None:
    first = worker_step(None, worker(1, True))
    assert (first.kind, first.running, first.started_seq) == (WORKER, True, 1)
    assert first.attempt_id == attempt_id_for(BINDING, WORKER_SLOT, WORKER, 77)
    done = worker_step(first, worker(2, False))
    assert (done.running, done.end_signal, done.ended_seq) == (False, "row-idle", 2)
    again = worker_step(done, worker(3, True))
    assert (again.running, again.ended_ms, again.end_signal) == (True, None, None)


def test_a_worker_without_a_created_time_still_gets_a_stable_id() -> None:
    one = worker_step(None, worker(1, True, created=None))
    two = worker_step(None, worker(9, True, created=None))
    assert one.attempt_id == two.attempt_id == attempt_id_for(BINDING, WORKER_SLOT, WORKER, None)


def test_attempt_ids_are_28_characters_and_depend_on_every_part() -> None:
    base = attempt_id_for(BINDING, DM, BOT_TURN, 1)
    assert len(base) == 28 and base.startswith("att_")
    assert (
        len(
            {
                base,
                attempt_id_for("bnd_x", DM, BOT_TURN, 1),
                attempt_id_for(BINDING, "s", BOT_TURN, 1),
                attempt_id_for(BINDING, DM, WORKER, 1),
                attempt_id_for(BINDING, DM, BOT_TURN, 2),
            }
        )
        == 5
    )


def test_is_bot_slot_compares_the_slot_key_with_the_dm_key() -> None:
    assert obs().is_bot_slot is True
    assert replace(obs(), slot_key=WORKER_SLOT).is_bot_slot is False
