from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .errors import SchemaNewer, SqliteTooOld, StoreUnconfigured
from .migrate import latest_version

StoreState = Literal[
    "ready",
    "unconfigured",
    "migrating",
    "schema-newer",
    "sqlite-too-old",
    "unavailable",
    "disabled",
]


@dataclass(frozen=True)
class StoreStatus:
    """What readiness reports about the store. Never carries a path or exception text."""

    state: StoreState
    store_version: int | None
    latest_version: int


def unconfigured_status() -> StoreStatus:
    return StoreStatus("unconfigured", None, latest_version())


def migrating_status() -> StoreStatus:
    return StoreStatus("migrating", None, latest_version())


def disabled_status() -> StoreStatus:
    """Kept for completeness; under the probe switch the store package is never imported."""
    return StoreStatus("disabled", None, latest_version())


def status_for_error(error: BaseException, store_version: int | None = None) -> StoreStatus:
    """Map any failure to a state by its type only, so no message or path can leak."""
    state: StoreState = "unavailable"
    if isinstance(error, StoreUnconfigured):
        state = "unconfigured"
    elif isinstance(error, SchemaNewer):
        state = "schema-newer"
    elif isinstance(error, SqliteTooOld):
        state = "sqlite-too-old"
    return StoreStatus(state, store_version, latest_version())
