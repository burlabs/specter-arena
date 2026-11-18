"""Test doubles for the Specter service: a scripted `Summoner`, a clock, and real-store helpers.

The service tests run against the real work-ledger store (`store/specters.py` and migration 0005)
in a temp directory; only the model is faked. Test-time only."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from backend.specter_arena.store import (
    BindingSeen,
    DmKey,
    IngestBatch,
    RosterPoll,
    RosterRowIn,
    Store,
    ingest,
    start_run,
)
from backend.specter_arena.store.bindings import store_id
from backend.specter_arena.summoner import SummonFailure, SummonReply

START_MS = 1_800_000_000_000  # same epoch the store tests use
ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
BETA = DmKey("beta-0123456789ab", "memory-beta")


class FakeClock:
    def __init__(self, start_ms: int = START_MS) -> None:
        self.now = start_ms

    def __call__(self) -> int:
        return self.now


def bind(opened: Store, key: DmKey, display: str, *, at_ms: int = START_MS) -> str:
    """Create (or update the display name of) a bot binding through the real ingest path."""
    with opened.read() as conn:
        started = conn.execute("SELECT count(*) FROM collector_run").fetchone()[0]
        installation = store_id(conn)
    if not started:
        start_run(opened, run_id="run-00000001", now_ms=at_ms - 1)
    poll = RosterPoll(
        True, at_ms + 1, (RosterRowIn(key.memory_store, display, display, None, None),)
    )
    result = ingest(
        opened, IngestBatch("run-00000001", installation, (BindingSeen(key, at_ms), poll))
    )
    return result.bindings[0].binding_id


def table_counts(opened: Store, *, except_prefixes: tuple[str, ...]) -> dict[str, int]:
    """Row count of every table except the ones whose name starts with a given prefix."""
    with opened.read() as conn:
        names = [
            r[0]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            if not r[0].startswith("sqlite_") and not r[0].startswith(except_prefixes)
        ]
        return {n: conn.execute(f'SELECT count(*) FROM "{n}"').fetchone()[0] for n in names}


def good_reply(name: str = "Wick Hollowlamp", **override: Any) -> str:
    body: dict[str, Any] = {
        "name": name,
        "epithet": "keeper of the unlit corridor",
        "personality": "Patient and a little smug.",
        "appearance": "A lantern-headed figure in a patched grey coat.",
        "mannerism": "Taps its glass head twice before answering.",
        "signatureAction": "Snuffs its own flame, then relights it.",
        "assignmentRationale": "Chosen for the quiet tone of the brief.",
        "artBrief": "Full body, soft rim light, muted background.",
    }
    body.update(override)
    return json.dumps(body)


class ScriptedSummoner:
    """Each call takes the next step: reply text, a `SummonFailure`, `HANG`, or `(Event, text)` that
    waits for the event first. Records every prompt and every request id."""

    HANG = object()

    def __init__(self, *steps: Any) -> None:
        self.steps = list(steps)
        self.prompts: list[str] = []
        self.request_ids: list[str] = []
        self.started = asyncio.Event()

    async def summon(self, prompt: str, *, request_id: str, timeout_s: float) -> SummonReply:
        self.prompts.append(prompt)
        self.request_ids.append(request_id)
        self.started.set()
        step = self.steps.pop(0) if self.steps else good_reply()
        if isinstance(step, SummonFailure):
            raise step
        if step is self.HANG:
            await asyncio.sleep(3600)
        if isinstance(step, tuple):
            gate, text = step
            await gate.wait()
            return SummonReply(str(text), "fake-model")
        return SummonReply(str(step), "fake-model")


def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "data"
