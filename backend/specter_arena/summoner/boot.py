from __future__ import annotations

import logging
import time
from collections.abc import Mapping
from typing import TYPE_CHECKING

from ..config import gateway_env, read_grants

if TYPE_CHECKING:
    from ..specters.service import SpecterService
    from ..store import Store

_LOG = logging.getLogger("specter_arena.summoner.boot")
CHAT_GRANT_PROBE = "/api/chat/slots"


def _now_ms() -> int:
    return int(time.time() * 1000)


async def boot_specters(
    store: Store, *, environment: Mapping[str, str] | None = None
) -> SpecterService | None:
    """The service with the real summoner when the gateway env and the /api/chat grant are
    present, else with UnavailableSummoner (manual entry and portraits still work). None only
    when the service cannot start; logged by exception type only."""
    try:
        from ..specters.service import Limits, SpecterService
        from . import Summoner, UnavailableSummoner

        env = gateway_env(environment)
        summoner: Summoner = UnavailableSummoner()
        if env.origin and env.secret and read_grants().has_api(CHAT_GRANT_PROBE):
            from .client import CrewChatSummoner

            summoner = CrewChatSummoner(env)
        service = SpecterService(store, summoner, clock=_now_ms, limits=Limits())
        await service.start()
    except Exception as error:
        _LOG.warning("specters not started: %s", type(error).__name__)
        return None
    return service
