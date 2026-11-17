from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass, replace

BOT_TURN = "bot-turn"
WORKER = "worker"
ROW_IDLE = "row-idle"
CHAT_DONE = "chat_done"

FLAG_KEYS: Mapping[str, str] = {
    "pendingApproval": "pending_approval",
    "needsInput": "needs_input",
    "hasOptions": "has_options",
    "waitingForInput": "waiting_for_input",
    "interrupted": "interrupted",
}
TYPED_KEYS = frozenset({"running", "turn", "turnGen", "lastActivityMs", *FLAG_KEYS})


@dataclass(frozen=True, slots=True)
class FoldObs:
    """One stored observation as the fold sees it; ordering fields come from the columns."""

    seq: int
    binding_id: str
    dm_key: str
    slot_key: str
    kind: str
    event_type: str
    turn: int | None
    turn_gen: str | None
    received_at_ms: int
    fact_digest: str | None
    payload: Mapping[str, bool | int | str]

    @property
    def is_bot_slot(self) -> bool:
        return self.slot_key == self.dm_key


@dataclass(frozen=True, slots=True)
class BotStateRow:
    binding_id: str
    dm_slot_key: str
    running: bool | None = None
    turn: int | None = None
    turn_gen: str | None = None
    pending_approval: bool | None = None
    needs_input: bool | None = None
    has_options: bool | None = None
    waiting_for_input: bool | None = None
    interrupted: bool | None = None
    last_activity_ms: int | None = None
    row_observed_ms: int | None = None
    event_observed_ms: int | None = None
    last_terminal_turn: int | None = None
    last_terminal_gen: str | None = None
    extra_facts: Mapping[str, bool | int | str] | None = None
    row_digest: str | None = None
    observed_seq: int = 0


@dataclass(frozen=True, slots=True)
class AttemptRow:
    attempt_id: str
    binding_id: str
    kind: str
    slot_key: str
    started_ms: int
    started_seq: int
    ended_ms: int | None
    ended_seq: int | None
    end_signal: str | None
    running: bool


def attempt_id_for(
    binding_id: str, slot_key: str, kind: str, discriminator: str | int | None
) -> str:
    """`att_` plus 24 hex of a hash of the stable parts, so a rebuild keeps every id."""
    text = "|".join(
        (binding_id, slot_key, kind, "" if discriminator is None else str(discriminator))
    )
    return "att_" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def is_stale(
    state_gen: str | None,
    state_turn: int | None,
    state_activity: int | None,
    obs_gen: str | None,
    obs_turn: int | None,
    obs_activity: int | None,
) -> bool:
    """True when the projection must ignore a row or event as older than what it holds.

    A different `turn_gen` always applies: it is random per gateway process and has no order, so
    it means the source restarted.
    """
    if state_gen is None or obs_gen is None or state_gen != obs_gen:
        return False
    if state_turn is not None and obs_turn is not None:
        if obs_turn < state_turn:
            return True
        if obs_turn > state_turn:
            return False
    return state_activity is not None and obs_activity is not None and obs_activity < state_activity


def _flag(payload: Mapping[str, bool | int | str], key: str) -> bool | None:
    value = payload.get(key)
    return value if isinstance(value, bool) else None


def _int(payload: Mapping[str, bool | int | str], key: str) -> int | None:
    value = payload.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _empty_state(obs: FoldObs) -> BotStateRow:
    return BotStateRow(binding_id=obs.binding_id, dm_slot_key=obs.dm_key)


def fold_row(state: BotStateRow | None, obs: FoldObs) -> BotStateRow | None:
    """The new bot state after a stored DM row, or None when the row is stale for it."""
    current = state or _empty_state(obs)
    activity = _int(obs.payload, "lastActivityMs")
    holds_a_row = state is not None and state.row_observed_ms is not None
    if holds_a_row and is_stale(
        current.turn_gen, current.turn, current.last_activity_ms, obs.turn_gen, obs.turn, activity
    ):
        return None
    extra = {k: v for k, v in obs.payload.items() if k not in TYPED_KEYS}
    running = _flag(obs.payload, "running")
    return replace(
        current,
        running=running,
        turn=obs.turn,
        turn_gen=obs.turn_gen,
        pending_approval=_flag(obs.payload, "pendingApproval"),
        needs_input=_flag(obs.payload, "needsInput"),
        has_options=_flag(obs.payload, "hasOptions"),
        waiting_for_input=_flag(obs.payload, "waitingForInput"),
        interrupted=_flag(obs.payload, "interrupted"),
        last_activity_ms=activity,
        row_observed_ms=obs.received_at_ms,
        extra_facts=extra,
        row_digest=obs.fact_digest,
        observed_seq=obs.seq,
    )


def fold_event(state: BotStateRow | None, obs: FoldObs) -> tuple[BotStateRow, bool]:
    """The new bot state after a stored event, and whether a `chat_done` applies as terminal.

    Events never change `running`. A `chat_done` older than the stored turn of the same
    `turn_gen` is kept as evidence but sets nothing.
    """
    current = state or _empty_state(obs)
    observed = max(obs.received_at_ms, current.event_observed_ms or 0)
    updated = replace(
        current, event_observed_ms=observed, observed_seq=max(obs.seq, current.observed_seq)
    )
    if obs.event_type != CHAT_DONE:
        return updated, False
    if is_stale(current.turn_gen, current.turn, None, obs.turn_gen, obs.turn, None):
        return updated, False
    return replace(updated, last_terminal_turn=obs.turn, last_terminal_gen=obs.turn_gen), True


def bot_turn_step(
    open_attempt: AttemptRow | None, obs: FoldObs, running: bool | None, signal: str
) -> AttemptRow | None:
    """The attempt to write after an applied DM row or `chat_done`, or None for no change.

    `running` is the row's flag (None for a `chat_done`, which always closes).
    """
    if open_attempt is None:
        if running is not True:
            return None
        return AttemptRow(
            attempt_id=attempt_id_for(obs.binding_id, obs.slot_key, BOT_TURN, obs.seq),
            binding_id=obs.binding_id,
            kind=BOT_TURN,
            slot_key=obs.slot_key,
            started_ms=obs.received_at_ms,
            started_seq=obs.seq,
            ended_ms=None,
            ended_seq=None,
            end_signal=None,
            running=True,
        )
    if running is True:
        return None
    return replace(
        open_attempt,
        ended_ms=obs.received_at_ms,
        ended_seq=obs.seq,
        end_signal=signal,
        running=False,
    )


def worker_step(existing: AttemptRow | None, obs: FoldObs) -> AttemptRow:
    """A worker attempt mirrors its newest stored row; `running = false` records `row-idle`."""
    running = _flag(obs.payload, "running") is True
    if existing is None:
        created = _int(obs.payload, "createdMs")
        existing = AttemptRow(
            attempt_id=attempt_id_for(obs.binding_id, obs.slot_key, WORKER, created),
            binding_id=obs.binding_id,
            kind=WORKER,
            slot_key=obs.slot_key,
            started_ms=obs.received_at_ms,
            started_seq=obs.seq,
            ended_ms=None,
            ended_seq=None,
            end_signal=None,
            running=True,
        )
    if running:
        return replace(existing, ended_ms=None, ended_seq=None, end_signal=None, running=True)
    return replace(
        existing, ended_ms=obs.received_at_ms, ended_seq=obs.seq, end_signal=ROW_IDLE, running=False
    )
