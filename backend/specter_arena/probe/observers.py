# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from .frames import Row

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

CLOSED_TAB_GAP_SECONDS = 60.0


@dataclass(frozen=True)
class Verdict:
    """An observer's answer for one cell: decided (with an excerpt) or not (with a reason)."""

    decided: bool
    text: str


@dataclass
class RenameObserver:
    """Compares successive `/api/agents` reads of the probe bot. It holds digests of the display
    name, never the name, next to the probe DM slot keys seen when each read was made."""

    reads: list[tuple[str, frozenset[str]]] = field(default_factory=list)

    def record(self, name_digest: str, dm_keys: frozenset[str]) -> None:
        self.reads.append((name_digest, dm_keys))

    def verdict(self) -> Verdict:
        changes = [
            (before, after)
            for before, after in zip(self.reads, self.reads[1:], strict=False)
            if before[0] != after[0]
        ]
        if not changes:
            return Verdict(False, f"display_name did not change across {len(self.reads)} reads")
        for (_, keys_before), (_, keys_after) in changes:
            if keys_before and keys_before == keys_after:
                return Verdict(
                    True, "display_name changed (values not recorded); DM slot key unchanged"
                )
        return Verdict(False, "display_name changed but the DM slot key was not seen unchanged")


def _seconds(stamp: str) -> float:
    return datetime.fromisoformat(stamp).timestamp()


def closed_tab_verdict(
    signal_times: list[str], request_times: list[str], window: tuple[str, str]
) -> Verdict:
    """Whether a probe-slot signal arrived inside a gap of at least CLOSED_TAB_GAP_SECONDS with
    no page request. The page sends no background requests, so the gap shows the page was idle,
    not that the tab was closed; the owner attests the closed interval."""
    start, end = _seconds(window[0]), _seconds(window[1])
    marks = sorted([start, end, *(t for t in map(_seconds, request_times) if start < t < end)])
    for low, high in zip(marks, marks[1:], strict=False):
        if high - low < CLOSED_TAB_GAP_SECONDS:
            continue
        inside = [t for t in map(_seconds, signal_times) if low < t < high]
        if inside:
            return Verdict(
                True,
                f"{len(inside)} probe-slot signal(s) arrived in a {high - low:.0f} s gap with "
                "no page request; the tab-closed interval is operator-attested",
            )
    return Verdict(False, f"no probe-slot signal inside a {CLOSED_TAB_GAP_SECONDS:g} s idle gap")


def resync_summary(before: dict[str, Row], after: dict[str, Row]) -> str:
    """Counts only: how the first `slots` frame after a reconnect compares with the last one
    before it."""
    kept = sorted(set(before) & set(after))
    carried = sum(
        1 for key in kept if bool(before[key].get("running")) == bool(after[key].get("running"))
    )
    return (
        f"probe rows before {len(before)}, after {len(after)}, present in both {len(kept)}; "
        f"running state carried over for {carried} of {len(kept)}"
    )
