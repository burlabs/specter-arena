from __future__ import annotations

from collections.abc import Sequence

from .errors import StoreUsageError

# Policy `xp-policy-1`: pure constants and arithmetic, no I/O (FP0809-WL-01).
POLICY_VERSION = "xp-policy-1"
BOUNTY_XP = 100
MAX_CONTRIBUTORS = 8
MAX_ATTEMPTS_PER_WORK = 16
MAX_MILESTONES = 8
MAX_TITLE = 120
MAX_CONDITION = 280
MAX_NOTE = 280
MAX_MILESTONE_LABEL = 80
MAX_DEPTH = 3

# Policy `xp-policy-2` (PA-3): a task the backend closed as credited earns its own bot
# `min(TASK_CAP_XP, TASK_BASE_XP + run_ms // TASK_STEP_MS)` XP, once. Migration 0010 enforces the
# same amount, the cap and the single award in SQL, so the constants here and the trigger agree.
TASK_POLICY_VERSION = "xp-policy-2"
TASK_BASE_XP = 10
TASK_STEP_MS = 120_000
TASK_CAP_XP = 30
# A bot's own turn becomes a task only once it has run this long (chat replies stay out).
BOT_TURN_TASK_MIN_MS = 60_000
# Minion size on the observed run time of a task: presentation only.
SIZE_SMALL_BELOW_MS = 120_000
SIZE_MEDIUM_BELOW_MS = 900_000

LEVEL_TABLE_VERSION = "levels-1"
# Level n starts at LEVEL_FLOORS[n - 1] cumulative XP; level 10 is the last.
LEVEL_FLOORS: tuple[int, ...] = (0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200)


def split_bounty(bounty: int, contributor_ids: Sequence[str]) -> dict[str, int]:
    """Split an integer bounty: ids sorted ascending, each gets `bounty // n`, the first
    `bounty % n` ids one more. The shares always sum to `bounty`; the same set in any order gives
    the same map."""
    if isinstance(bounty, bool) or not isinstance(bounty, int) or bounty < 0:
        raise StoreUsageError("bounty must be a non-negative integer")
    ids = list(contributor_ids)
    if not 1 <= len(ids) <= MAX_CONTRIBUTORS:
        raise StoreUsageError("contributors must number 1 to 8")
    if not all(isinstance(i, str) and i for i in ids):
        raise StoreUsageError("contributor ids must be non-empty strings")
    if len(set(ids)) != len(ids):
        raise StoreUsageError("duplicate contributor")
    base, extra = divmod(bounty, len(ids))
    return {
        contributor: base + (1 if index < extra else 0)
        for index, contributor in enumerate(sorted(ids))
    }


def level_for(total_xp: int) -> tuple[int, int, int | None]:
    """`(level, floor_xp, next_level_xp)`; `next_level_xp` is None at the last level."""
    if isinstance(total_xp, bool) or not isinstance(total_xp, int) or total_xp < 0:
        raise StoreUsageError("total xp must be a non-negative integer")
    level = 1
    for number, floor in enumerate(LEVEL_FLOORS, start=1):
        if total_xp >= floor:
            level = number
    following = LEVEL_FLOORS[level] if level < len(LEVEL_FLOORS) else None
    return level, LEVEL_FLOORS[level - 1], following


def task_bounty(run_ms: int) -> int:
    """The `xp-policy-2` award for a task that ran `run_ms`: 10 XP plus 1 per full 2 minutes,
    at most 30."""
    if isinstance(run_ms, bool) or not isinstance(run_ms, int) or run_ms < 0:
        raise StoreUsageError("run time must be a non-negative integer")
    return min(TASK_CAP_XP, TASK_BASE_XP + run_ms // TASK_STEP_MS)


def size_class(run_ms: int) -> str:
    """`small` below 2 min, `medium` below 15 min, else `large`; a label for drawing only."""
    if run_ms < SIZE_SMALL_BELOW_MS:
        return "small"
    return "medium" if run_ms < SIZE_MEDIUM_BELOW_MS else "large"
