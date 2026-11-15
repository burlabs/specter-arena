# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import re
from dataclasses import dataclass

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

HOST_VERSION_PATTERN = re.compile(r"\d+\.\d+\.\d+")
DEFAULT_AGENTS_POLL_SECONDS = 15.0
FILE_SOURCE = ".probe-run.json"

# Option key: (lowest, highest, nullable).
_RANGES: dict[str, tuple[float, float, bool]] = {
    "captureSeconds": (1, 900, False),
    "reconnectAfterStartSeconds": (1, 120, True),
    "agentsPollSeconds": (5, 120, False),
}
OPTION_KEYS = frozenset({"hostVersion", *_RANGES})


class OptionsError(ValueError):
    """A run option is unknown, of the wrong type, or out of range. The message names the key."""


@dataclass(frozen=True)
class RunOptions:
    host_version: str | None
    capture_seconds: float
    reconnect_after_start: float | None
    agents_poll_seconds: float


def _checked(source: str, options: object) -> dict[str, object]:
    if options is None:
        return {}
    if not isinstance(options, dict):
        raise OptionsError(f"{source}: run options must be a JSON object")
    unknown = sorted(set(options) - OPTION_KEYS)
    if unknown:
        raise OptionsError(f"{source}: unknown run option {unknown[0]}")
    for key, (low, high, nullable) in _RANGES.items():
        if key not in options or (nullable and options[key] is None):
            continue
        value = options[key]
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise OptionsError(f"{source}: {key} must be a number")
        if not low <= value <= high:
            raise OptionsError(f"{source}: {key} must be between {low:g} and {high:g}")
    version = options.get("hostVersion")
    if "hostVersion" in options and not (
        isinstance(version, str) and HOST_VERSION_PATTERN.fullmatch(version)
    ):
        raise OptionsError(f"{source}: hostVersion must look like 0.12.2")
    return {str(key): value for key, value in options.items()}


def load_run_options(
    body: dict[str, object], staged: object, *, default_capture_seconds: float
) -> RunOptions:
    """Run options for one start, key by key: the request body, else the staged
    `.probe-run.json` (already parsed; None when absent), else the defaults."""
    merged = {**_checked(FILE_SOURCE, staged), **_checked("request", body)}
    capture = merged.get("captureSeconds", default_capture_seconds)
    reconnect = merged.get("reconnectAfterStartSeconds")
    poll = merged.get("agentsPollSeconds", DEFAULT_AGENTS_POLL_SECONDS)
    version = merged.get("hostVersion")
    assert isinstance(capture, int | float) and isinstance(poll, int | float)
    assert reconnect is None or isinstance(reconnect, int | float)
    assert version is None or isinstance(version, str)
    return RunOptions(
        host_version=version,
        capture_seconds=float(capture),
        reconnect_after_start=None if reconnect is None else float(reconnect),
        agents_poll_seconds=float(poll),
    )
