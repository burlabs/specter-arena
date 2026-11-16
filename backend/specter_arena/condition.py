from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from .store import RosterRow

CONDITION_RULES_VERSION = 1

Basis = Literal["row", "event"]


@dataclass(frozen=True)
class Condition:
    """A labelled state with its reason. `state` is `working`, `settled` or `unknown`.

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
