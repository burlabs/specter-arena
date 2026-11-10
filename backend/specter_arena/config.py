from __future__ import annotations

import json
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


MANIFEST_FILE = "app.json"
OWN_API_ENTRY = "/apps/specter-arena/api/*"


def detect_grants(manifest_path: Path | None = None) -> tuple[bool, str]:
    """Whether the installed app.json declares anything beyond the app's own api entry.

    Returns the answer and the basis it rests on. A manifest that cannot be read or does not have
    the expected shape fails closed to "declared" so the grant-dependent cells are never skipped.
    """
    path = APP_ROOT / MANIFEST_FILE if manifest_path is None else manifest_path
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        permissions = manifest.get("permissions", {})
        api = permissions.get("api", [])
        events = permissions.get("events", [])
        if not (isinstance(api, list) and isinstance(events, list)):
            raise TypeError
    except (OSError, ValueError, AttributeError, TypeError) as error:
        return True, f"manifest-unreadable: {type(error).__name__}"
    return any(entry != OWN_API_ENTRY for entry in api) or bool(events), "manifest"
