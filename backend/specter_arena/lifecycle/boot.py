from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..store import Store
    from .service import DataService

_LOG = logging.getLogger("specter_arena.lifecycle.boot")


def _now_ms() -> int:
    return int(time.time() * 1000)


def boot_lifecycle(store: Store) -> DataService | None:
    """The data lifecycle service, or None when it cannot be built; logged by exception type
    only. A None leaves every data route answering 503 `store_not_ready`."""
    try:
        from .service import DataService

        return DataService(store, clock=_now_ms)
    except Exception as error:
        _LOG.warning("data lifecycle not started: %s", type(error).__name__)
        return None
