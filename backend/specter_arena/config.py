from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class GatewayEnv:
    secret: str
    origin: str
    port: str
    app_name: str


def gateway_env(environ: Mapping[str, str] | None = None) -> GatewayEnv:
    """Values Crew injects when it spawns the backend; every field is "" when absent."""
    env = os.environ if environ is None else environ
    return GatewayEnv(
        secret=env.get("KIROCREW_PROXY_SECRET", ""),
        origin=env.get("KIROCREW_GATEWAY_ORIGIN", ""),
        port=env.get("PORT", ""),
        app_name=env.get("KIROCREW_APP_NAME", ""),
    )
