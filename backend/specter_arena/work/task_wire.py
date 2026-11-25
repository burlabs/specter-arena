from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..store import Page
    from ..store.tasks import TaskView
    from ..store.xp import XpSummaryV2

CONTRACT_VERSION = 1
XP_SUMMARY_VERSION = 2
XP_SUMMARIES_VERSION = 3


def task_item_wire(view: TaskView) -> dict[str, object]:
    """One `task-item.v1` body. `runMs` and `sizeClass` were computed by the store at the
    response's `asOfMs`; size is a label for drawing and says nothing about progress."""
    return {
        "contractVersion": CONTRACT_VERSION,
        "taskId": view.task_id,
        "bindingId": view.binding_id,
        "attemptId": view.attempt_id,
        "kind": view.kind,
        "state": view.state,
        "attemptState": view.attempt_state,
        "closeReason": view.close_reason,
        "startedAtMs": view.started_ms,
        "endedAtMs": view.ended_ms,
        "closedAtMs": view.closed_ms,
        "updatedAtMs": view.updated_ms,
        "runMs": view.run_ms,
        "sizeClass": view.size_class,
        "xpCredited": view.xp_credited,
        "policyVersion": view.policy_version,
    }


def tasks_wire(page: Page[TaskView], as_of_ms: int) -> dict[str, object]:
    """The `tasks.v1` body: one keyset page of `task-item` bodies."""
    return {
        "contractVersion": CONTRACT_VERSION,
        "items": [task_item_wire(view) for view in page.items],
        "nextCursor": page.next_cursor,
        "asOfMs": as_of_ms,
    }


def xp_summary_v2_wire(view: XpSummaryV2) -> dict[str, object]:
    """One `xp-summary.v2` body: totals over both ledgers, derived at read time."""
    return {
        "contractVersion": XP_SUMMARY_VERSION,
        "bindingId": view.binding_id,
        "totalXp": view.total_xp,
        "level": view.level,
        "levelTableVersion": view.level_table_version,
        "levelFloorXp": view.level_floor_xp,
        "nextLevelXp": view.next_level_xp,
        "acceptedWorkCount": view.accepted_work_count,
        "policyVersion": view.policy_version,
        "creditedTaskCount": view.credited_task_count,
    }


def xp_summaries_v3_wire(page: Page[XpSummaryV2], as_of_ms: int) -> dict[str, object]:
    """The `xp-summaries.v3` body: one keyset page of `xp-summary.v2` bodies by binding id."""
    return {
        "contractVersion": XP_SUMMARIES_VERSION,
        "items": [xp_summary_v2_wire(view) for view in page.items],
        "nextCursor": page.next_cursor,
        "asOfMs": as_of_ms,
    }
