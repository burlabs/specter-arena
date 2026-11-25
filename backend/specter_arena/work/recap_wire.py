from __future__ import annotations

from typing import TYPE_CHECKING

from ..store.recap import RECAP_TASK_CAP
from .task_wire import task_item_wire

if TYPE_CHECKING:
    from ..store.recap import RecapResult

CONTRACT_VERSION = 1


def recap_wire(result: RecapResult) -> dict[str, object]:
    """The `recap.v1` body. Span reasons come from the store's closed set, never stored text."""
    return {
        "contractVersion": CONTRACT_VERSION,
        "asOfMs": result.as_of_ms,
        "fromMs": result.from_ms,
        "toMs": result.to_ms,
        "tasks": [task_item_wire(view) for view in result.tasks],
        "taskCap": RECAP_TASK_CAP,
        "truncated": result.truncated,
        "omittedCount": result.omitted,
        "coverage": {
            "firstRunMs": result.first_run_ms,
            "purgeHorizonMs": result.purge_horizon_ms,
            "spans": [
                {"fromMs": start, "toMs": end, "state": state, "reason": reason}
                for state, reason, start, end in result.spans
            ],
        },
    }
