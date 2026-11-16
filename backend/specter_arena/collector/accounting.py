from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field, fields

from .vocabulary import IGNORE_REASONS, IGNORED_TYPES, QUARANTINE_REASONS, REJECT_REASONS

UNLISTED = "unlisted"


@dataclass
class Accounting:
    """Every received unit ends in exactly one counter, or is still in flight.

    A unit is one non-`slots` socket message, or one candidate bot or worker row of a `slots`
    frame, or one unwalkable `slots` frame. Control items (bindings, roster polls, coverage
    marks) are not units.
    """

    received: int = 0
    ignored: int = 0
    coalesced: int = 0
    persisted: int = 0
    deduplicated: int = 0
    quarantined: int = 0
    rejected: int = 0
    dropped_with_gap_record: int = 0

    def balanced(self, in_flight: int) -> bool:
        return self.received == (
            self.ignored
            + self.coalesced
            + self.persisted
            + self.deduplicated
            + self.quarantined
            + self.rejected
            + self.dropped_with_gap_record
            + in_flight
        )

    def counts(self) -> dict[str, int]:
        return {item.name: getattr(self, item.name) for item in fields(self)}

    def diagnostics(self, in_flight: int, breakdown: Breakdown | None = None) -> dict[str, object]:
        """Counts, closed-set names and reason codes only; no gateway text can be a key or value."""
        body: dict[str, object] = {
            "counts": self.counts(),
            "in_flight": in_flight,
            "balanced": self.balanced(in_flight),
        }
        if breakdown is not None:
            body["breakdown"] = breakdown.as_dict()
        return body


@dataclass
class Breakdown:
    """Diagnostic split of the counters. Keys outside the closed sets collapse to `unlisted`."""

    ignored_by_type: Counter[str] = field(default_factory=Counter)
    ignored_by_reason: Counter[str] = field(default_factory=Counter)
    rejected: Counter[str] = field(default_factory=Counter)
    quarantined: Counter[str] = field(default_factory=Counter)

    def ignore_type(self, name: str, count: int = 1) -> None:
        self.ignored_by_type[name if name in IGNORED_TYPES else UNLISTED] += count

    def ignore_reason(self, reason: str, count: int = 1) -> None:
        self.ignored_by_reason[reason if reason in IGNORE_REASONS else UNLISTED] += count

    def reject(self, reason: str, count: int = 1) -> None:
        self.rejected[reason if reason in REJECT_REASONS else UNLISTED] += count

    def quarantine(self, reason: str, count: int = 1) -> None:
        self.quarantined[reason if reason in QUARANTINE_REASONS else UNLISTED] += count

    def as_dict(self) -> dict[str, dict[str, int]]:
        return {
            "ignored_by_type": dict(self.ignored_by_type),
            "ignored_by_reason": dict(self.ignored_by_reason),
            "rejected": dict(self.rejected),
            "quarantined": dict(self.quarantined),
        }
