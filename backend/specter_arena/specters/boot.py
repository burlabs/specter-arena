from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..store import Store
    from .service import SpecterService

_LOG = logging.getLogger("specter_arena.specters.boot")


def _now_ms() -> int:
    return int(time.time() * 1000)


async def boot_specters(store: Store) -> SpecterService | None:
    """The service, or None when it cannot start (a bad roster file, a failing store);
    logged by exception type only."""
    try:
        from .service import SpecterService

        service = SpecterService(store, clock=_now_ms)
        await service.start()
    except Exception as error:
        _LOG.warning("specters not started: %s", type(error).__name__)
        return None
    return service
