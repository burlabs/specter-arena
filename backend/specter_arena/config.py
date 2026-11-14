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
RUN_OPTIONS_FILE = ".probe-run.json"
_CHILDREN_SUFFIX = "/*"


@dataclass(frozen=True)
class Grants:
    """The api and event entries an installed app.json declares.

    `unknown` is set when the grants could not be read (or a caller asserted them wholesale):
    every `has_*` then answers True, so a grant-dependent step runs and its cell names the basis
    instead of being skipped on a guess.
    """

    api: frozenset[str]
    events: frozenset[str]
    basis: str
    unknown: bool = False

    @classmethod
    def none(cls, basis: str = "none") -> Grants:
        return cls(frozenset(), frozenset(), basis)

    @classmethod
    def assumed(cls, basis: str) -> Grants:
        return cls(frozenset(), frozenset(), basis, unknown=True)

    @property
    def beyond_own_entry(self) -> bool:
        return self.unknown or any(e != OWN_API_ENTRY for e in self.api) or bool(self.events)

    def has_event(self, name: str) -> bool:
        return self.unknown or name in self.events

    def has_api(self, path: str) -> bool:
        """The host's matching rule: a bare entry matches the path and any child path;
        `<prefix>/*` matches children of the prefix only."""
        if self.unknown:
            return True
        for entry in self.api:
            if entry.endswith(_CHILDREN_SUFFIX):
                if path.startswith(entry[:-1]):
                    return True
            elif path == entry or path.startswith(f"{entry}/"):
                return True
        return False


def read_grants(manifest_path: Path | None = None) -> Grants:
    """The grants the installed app.json declares, entry by entry.

    A manifest that cannot be read or does not have the expected shape fails closed to
    `Grants.assumed`, with the exception type recorded as the basis.
    """
    path = APP_ROOT / MANIFEST_FILE if manifest_path is None else manifest_path
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        permissions = manifest.get("permissions", {})
        api = permissions.get("api", [])
        events = permissions.get("events", [])
        if not (isinstance(api, list) and isinstance(events, list)):
            raise TypeError
        if not all(isinstance(entry, str) for entry in [*api, *events]):
            raise TypeError
    except (OSError, ValueError, AttributeError, TypeError) as error:
        return Grants.assumed(f"manifest-unreadable: {type(error).__name__}")
    return Grants(frozenset(api), frozenset(events), "manifest")


def detect_grants(manifest_path: Path | None = None) -> tuple[bool, str]:
    """Whether the installed app.json declares anything beyond the app's own api entry, and the
    basis that answer rests on."""
    grants = read_grants(manifest_path)
    return grants.beyond_own_entry, grants.basis
