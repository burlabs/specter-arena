"""Loads the synthetic collector fixtures (SPECTER-FIXTURE-ONLY) and builds frames from them.

Test-time only. The fixtures never enter tests/recorded or contracts/cases.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "collector"
FIXTURE_MARK = "SPECTER-FIXTURE-ONLY"


@cache
def _load(name: str) -> dict[str, Any]:
    body: dict[str, Any] = json.loads((FIXTURE_DIR / name).read_text(encoding="utf-8"))
    return body


def rows() -> dict[str, dict[str, Any]]:
    table: dict[str, dict[str, Any]] = _load("rows.json")["rows"]
    return table


def row(name: str, **overrides: object) -> dict[str, Any]:
    return {**rows()[name], **overrides}


def slots_frame(shape: str = "full", *, partial: bool | None = None, **extra: object) -> str:
    body: dict[str, Any] = {
        "type": "slots",
        "data": [row(n) for n in _load("frames.json")["slots"][shape]],
    }
    if partial is not None:
        body["slotsPartial"] = partial
    body.update(extra)
    return json.dumps(body)


def event_frame(event_type: str, slot: str, **overrides: object) -> str:
    data = {**_load("frames.json")["events"][event_type], "slot": slot, **overrides}
    return json.dumps({"type": event_type, "data": data})


def event_types() -> list[str]:
    return list(_load("frames.json")["events"])


def event_data_keys(event_type: str) -> set[str]:
    return set(_load("frames.json")["events"][event_type]) | {"slot"}
