from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


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


PROBE_SWITCH_FILE = ".probe-enabled"
APP_ROOT = Path(__file__).resolve().parents[2]


def probe_enabled(environ: Mapping[str, str] | None = None, root: Path | None = None) -> bool:
    """The dev switch for the diagnostic probe routes: off unless explicitly turned on.

    On when SPECTER_PROBE is "1", or when `.probe-enabled` exists at the app root. Crew gives the
    backend a minimal environment, so the file is the switch an owner can actually set; the
    staging script writes it into the staged probe app and nowhere else.
    """
    env = os.environ if environ is None else environ
    if env.get("SPECTER_PROBE") == "1":
        return True
    return ((APP_ROOT if root is None else root) / PROBE_SWITCH_FILE).is_file()
