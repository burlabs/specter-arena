from __future__ import annotations

import asyncio
import logging
import random
import secrets
from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING

from ..config import gateway_env, read_grants

if TYPE_CHECKING:
    from ..store import Store
    from .supervisor import Collector

_LOG = logging.getLogger("specter_arena.collector.boot")


async def boot_collector(
    store: Store,
    *,
    environment: Mapping[str, str] | None = None,
    random_source: Callable[[], float] = random.random,
) -> Collector | None:
    """Start the collector against an open store; None when it cannot start.

    The collector needs the gateway origin and app secret Crew injects. Without them (a local
    run) it is not started, and neither `websockets` nor the supervisor is imported. This never
    raises: a failure is logged by exception type only, so no path, URL or credential reaches
    a log.
    """
    env = gateway_env(environment)
    if not env.origin or not env.secret:
        _LOG.info("collector not started: gateway environment is absent")
        return None
    try:
        from .gateway import GatewayClient
        from .supervisor import Collector, SqliteStorePort, SystemClock

        collector = Collector(
            store=SqliteStorePort(store),
            gateway=GatewayClient(env),
            grants=read_grants,
            clock=SystemClock(),
            sleeper=asyncio.sleep,
            rng=random_source,
            run_id=secrets.token_hex(16),
        )
        await collector.start()
    except Exception as error:
        _LOG.warning("collector not started: %s", type(error).__name__)
        return None
    return collector
