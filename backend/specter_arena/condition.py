from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from .store import RosterRow

# The newest rules. `roster-item.v1` is still served from `condition_rules_v1`, which never reads
# a flag; `roster-item.v2` is served from `condition_rules_v2`.
CONDITION_RULES_VERSION = 2

WAITING = "waiting"
APPROVAL_PENDING = "approval-pending"
QUESTION_PENDING = "question-pending"

Basis = Literal["row", "event"]


@dataclass(frozen=True)
class Condition:
    """A labelled state with its reason.

    `state` is `working`, `settled`, `unknown` or (rules v2) `waiting`.

    Never numeric except the two timestamps, so no score or health value can be derived from it.
    """

    state: str
    reason_code: str
    basis: Basis | None
    source_time_ms: int | None
    observed_at_ms: int | None
    signals: Mapping[str, bool | None]


def condition_rules_v1(row: RosterRow, as_of_ms: int) -> Condition:
    """Derive a condition from stored facts and coverage.

    An absent or unknown-presence bot, a bot with no stored facts and a bot outside covered
    time is `unknown` even when its last stored fact says `running`. `settled` means not
    running; the four flags are reported as signals and never mapped to a state.
    `as_of_ms` keeps the function pure and is not read by v1.
    """
    facts = row.facts
    signals: dict[str, bool | None] = {
        "needsInput": facts.needs_input if facts else None,
        "hasOptions": facts.has_options if facts else None,
        "pendingApproval": facts.pending_approval if facts else None,
        "waitingForInput": facts.waiting_for_input if facts else None,
    }
    basis: Basis | None = "row" if facts else None
    source_time = facts.last_activity_ms if facts else None
    observed = facts.row_observed_ms if facts else None

    def build(state: str, reason: str) -> Condition:
        return Condition(state, reason, basis, source_time, observed, signals)

    if row.presence in ("absent", "unknown"):
        return build("unknown", f"presence-{row.presence}")
    if facts is None or facts.running is None:
        return build("unknown", "never-observed")
    if row.coverage.state != "covered":
        return build("unknown", row.coverage.reason or "no-coverage")
    if facts.running:
        return build("working", "running")
    return build("settled", "not-running")


def condition_rules_v2(row: RosterRow, as_of_ms: int) -> Condition:
    """Rules v1, plus `waiting` when Crew says the person owes the bot an answer.

    `waiting` reads two flags and nothing else: `pendingApproval` (an approval future is open on
    the DM slot, `kiro_crew/dashboard/slot_projection.py:381-382`) and `needsInput` (a question
    card is open, `slot_projection.py:422`). `waitingForInput` is true for any bot whose last row
    is an assistant reply (`slot_projection.py:415-420`) and `hasOptions` for any reply that ends
    in options, so neither is read. Presence, never-observed and coverage rules come first and win:
    a bot the collector is not covering stays `unknown` whatever its last flags said. A pending
    approval needs a turn in flight, so it counts only while the row says `running`; a flag left
    on a settled row is a stale reading and stays a signal. A question card outlives the turn
    that asked it, so `needsInput` counts on a running or settled row.
    """
    base = condition_rules_v1(row, as_of_ms)
    facts = row.facts
    if base.state == "unknown" or facts is None:
        return base
    if facts.pending_approval is True and facts.running is True:
        return Condition(
            WAITING,
            APPROVAL_PENDING,
            base.basis,
            base.source_time_ms,
            base.observed_at_ms,
            base.signals,
        )
    if facts.needs_input is True:
        return Condition(
            WAITING,
            QUESTION_PENDING,
            base.basis,
            base.source_time_ms,
            base.observed_at_ms,
            base.signals,
        )
    return base
