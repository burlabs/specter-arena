from __future__ import annotations

import re
from collections.abc import Sequence
from typing import TYPE_CHECKING

from ..attempts_view import end_signal_wire

if TYPE_CHECKING:
    from ..store import Page, WorkRecord, XpEntryView, XpHistory, XpSummary
    from ..store.work import WorkAttemptView

CONTRACT_VERSION = 1
MAX_DECISIONS = 50
MAX_BLOCKERS = 8

_TOKEN = re.compile(r"[a-z][a-z0-9-]{0,31}")
_KIND = re.compile(r"[a-z][a-z0-9-]{0,15}")
_BLOCKER = re.compile(r"[a-z][a-z0-9-]{0,47}")


def _token(value: str) -> str:
    return value if _TOKEN.fullmatch(value) else "unknown"


def _attempt_wire(view: WorkAttemptView) -> dict[str, object]:
    """A missing attempt (`present` false) has no times and is never ended."""
    present = view.present
    return {
        "attemptId": view.attempt_id,
        "bindingId": view.binding_id,
        "kind": view.kind if _KIND.fullmatch(view.kind) else "unknown",
        "startedMs": view.started_ms if present else None,
        "endedMs": view.ended_ms if present else None,
        "endSignal": end_signal_wire(view.end_signal) if present else None,
        "ended": present and view.ended,
        "present": present,
    }


def work_item_wire(view: WorkRecord) -> dict[str, object]:
    """One `work-item.v1` body. Progress is null (unknown) without milestones; there is no
    percentage. `canAccept` follows the store's own review, which owns the accept rule."""
    blockers = [blocker for blocker in view.review.blockers if _BLOCKER.fullmatch(blocker)]
    return {
        "contractVersion": CONTRACT_VERSION,
        "workId": view.work_id,
        "parentId": view.parent_id,
        "title": view.title,
        "acceptanceCondition": view.acceptance_condition,
        "rewardable": view.rewardable,
        "bountyXp": view.bounty_xp,
        "policyVersion": view.policy_version,
        "state": _token(view.state),
        "version": view.version,
        "createdAtMs": view.created_ms,
        "updatedAtMs": view.updated_ms,
        "attempts": [_attempt_wire(attempt) for attempt in view.attempts],
        "contributors": [
            {
                "bindingId": contributor.binding_id,
                "attemptCount": contributor.attempt_count,
                "xpNet": contributor.xp_net,
            }
            for contributor in view.contributors
        ],
        "milestones": [
            {"position": m.position, "label": m.label, "doneAtMs": m.done_ms}
            for m in view.milestones
        ],
        "progress": (
            None
            if view.progress is None
            else {"done": view.progress.done, "total": view.progress.total}
        ),
        "evidenceRevision": view.evidence_revision,
        "childCount": view.child_count,
        "childrenAccepted": view.children_accepted,
        "review": {
            "canAccept": view.review.can_accept and not view.review.blockers,
            "blockers": blockers[:MAX_BLOCKERS],
        },
        "decisions": [
            {
                "decisionId": d.decision_id,
                "seq": d.seq,
                "action": _token(d.action),
                "fromState": _token(d.from_state),
                "toState": _token(d.to_state),
                "actor": d.actor,
                "atMs": d.at_ms,
                "note": d.note,
                "evidenceRevision": d.evidence_revision,
            }
            for d in view.decisions[-MAX_DECISIONS:]
        ],
    }


def work_items_wire(page: Page[WorkRecord], as_of_ms: int) -> dict[str, object]:
    """The `work-items.v1` body: one keyset page of full `work-item` bodies."""
    return {
        "contractVersion": CONTRACT_VERSION,
        "items": [work_item_wire(view) for view in page.items],
        "nextCursor": page.next_cursor,
        "asOfMs": as_of_ms,
    }


def xp_summary_wire(view: XpSummary) -> dict[str, object]:
    """One `xp-summary.v1` body. The store derives the level from net XP at read time."""
    return {
        "contractVersion": CONTRACT_VERSION,
        "bindingId": view.binding_id,
        "totalXp": view.total_xp,
        "level": view.level,
        "levelTableVersion": view.level_table_version,
        "levelFloorXp": view.level_floor_xp,
        "nextLevelXp": view.next_level_xp,
        "acceptedWorkCount": view.accepted_work_count,
        "policyVersion": view.policy_version,
    }


def xp_summaries_wire(views: Sequence[XpSummary], as_of_ms: int) -> dict[str, object]:
    return {
        "contractVersion": CONTRACT_VERSION,
        "items": [xp_summary_wire(view) for view in views],
        "asOfMs": as_of_ms,
    }


def _entry_wire(entry: XpEntryView) -> dict[str, object]:
    return {
        "entryId": entry.entry_id,
        "workId": entry.work_id,
        "workTitle": entry.work_title,
        "kind": _token(entry.kind),
        "amount": entry.amount,
        "policyVersion": entry.policy_version,
        "decisionId": entry.decision_id,
        "createdAtMs": entry.created_ms,
    }


def xp_history_wire(result: XpHistory, as_of_ms: int) -> dict[str, object]:
    """The `xp-history.v1` body: the summary and one newest-first page of ledger entries."""
    return {
        "contractVersion": CONTRACT_VERSION,
        "bindingId": result.summary.binding_id,
        "summary": xp_summary_wire(result.summary),
        "items": [_entry_wire(entry) for entry in result.page.items],
        "nextCursor": result.page.next_cursor,
        "asOfMs": as_of_ms,
    }
