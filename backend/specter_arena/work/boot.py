from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..store import Store
    from .service import WorkService

_LOG = logging.getLogger("specter_arena.work.boot")


def _now_ms() -> int:
    return int(time.time() * 1000)


def boot_work(store: Store) -> WorkService | None:
    """The work service, or None when it cannot be built; logged by exception type only, so no
    path or message reaches a log. A None leaves every work route answering 503."""
    try:
        from .service import WorkService

        return WorkService(store, clock=_now_ms)
    except Exception as error:
        _LOG.warning("work not started: %s", type(error).__name__)
        return None


async def boot_tasks(store: Store) -> None:
    """Backfill and close out tasks once at boot, in one write transaction off the event loop.

    Never raises: a failure is logged by exception type only and the next ingest sweeps again."""
    try:
        from ..store.tasks import run_sweep

        await asyncio.to_thread(run_sweep, store, _now_ms())
    except Exception as error:
        _LOG.warning("task sweep at boot failed: %s", type(error).__name__)
