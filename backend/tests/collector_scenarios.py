"""Builders shared by the collector supervisor tests: frames, a harness and scripted waits.

Test-time only. Frames use the shapes recorded on Crew 0.12.2 (keys only, no content).
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from dataclasses import dataclass, field, replace

from backend.specter_arena.collector.gateway import Feed, Transient
from backend.specter_arena.collector.supervisor import Collector, StorePort
from backend.specter_arena.collector.vocabulary import LIMITS, Limits
from backend.specter_arena.config import AGENTS_API_ENTRY, OWN_API_ENTRY, Grants
from backend.specter_arena.store import DmKey, build_dm_key
from backend.tests.collector_fakes import (
    FakeClock,
    FakeGateway,
    FakeSleeper,
    FakeStore,
    FixedRandom,
)

SENTINEL = "SENTINEL-prose-must-never-leave-the-parser"
GEN = "a8b8767e"
OTHER_GEN = "0c0ffee0"
STAMP = "2026-11-16T12:00:00+00:00"

KEY_A = DmKey("bot-a-9d63166ee3a3", "member-bot-a-9d63166ee3a3-aa11")
KEY_B = DmKey("bot-b-0a1b2c3d4e5f", "member-bot-b-0a1b2c3d4e5f-bb22")
DM_A = build_dm_key(KEY_A)
DM_B = build_dm_key(KEY_B)
WORKER_1 = "chat-61-1794779966"
WORKER_2 = "chat-62-1794779999"

D_P9 = Grants(frozenset({OWN_API_ENTRY, AGENTS_API_ENTRY}), frozenset({"slots:user"}), "manifest")
NARROWED = Grants(frozenset({OWN_API_ENTRY}), frozenset({"slots:user"}), "manifest")


def bot_row(dm_key: str = DM_A, **overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "key": dm_key,
        "mode": "member",
        "running": True,
        "turn": 1,
        "turn_gen": GEN,
        "last_activity_ts": STAMP,
        "title": SENTINEL,
        "last_message": SENTINEL,
        "workspace": SENTINEL,
    }
    row.update(overrides)
    return row


def worker_row(
    created_by: str = DM_A, key: str = WORKER_1, **overrides: object
) -> dict[str, object]:
    row: dict[str, object] = {
        "key": key,
        "origin": "user",
        "created_by": created_by,
        "running": False,
        "title": SENTINEL,
    }
    row.update(overrides)
    return row


def slots(*rows: object, partial: bool | None = None) -> str:
    body: dict[str, object] = {"type": "slots", "data": list(rows)}
    if partial is not None:
        body["slotsPartial"] = partial
    return json.dumps(body)


def event(event_type: str, slot: str = DM_A, **data: object) -> str:
    return json.dumps({"type": event_type, "data": {"slot": slot, **data}})


def chat_done(turn: int, slot: str = DM_A, gen: str = GEN) -> str:
    return event("chat_done", slot, turn=turn, turn_gen=gen, continuing=False, text=SENTINEL)


def agent_row(
    store: str, name: str = "bot", display: str | None = "Bot", **overrides: object
) -> dict[str, object]:
    row: dict[str, object] = {
        "scope": "global",
        "memory_store": store,
        "name": name,
        "display_name": display,
        "avatar": {"kind": "image", "file": "bot.png"},
        "workspace": SENTINEL,
    }
    row.update(overrides)
    return row


class HoldingGateway(FakeGateway):
    """A fake gateway whose feed stays open after its scripted frames instead of ending."""

    def open_feed(self):  # type: ignore[no-untyped-def]
        manager = super().open_feed()
        return _Holding(manager)


class _Holding:
    def __init__(self, manager) -> None:  # type: ignore[no-untyped-def]
        self._manager = manager

    async def __aenter__(self) -> Feed:
        feed = await self._manager.__aenter__()
        return _HeldFeed(feed)

    async def __aexit__(self, *exc: object) -> None:
        await self._manager.__aexit__(*exc)


class _HeldFeed:
    def __init__(self, feed: Feed) -> None:
        self._feed = feed

    async def recv(self) -> str | bytes:
        try:
            return await self._feed.recv()
        except Transient:
            await asyncio.Event().wait()
            raise


@dataclass
class Harness:
    collector: Collector
    store: StorePort
    gateway: FakeGateway
    clock: FakeClock
    sleeper: FakeSleeper
    grants_now: list[Grants] = field(default_factory=lambda: [D_P9])

    @property
    def fake_store(self) -> FakeStore:
        assert isinstance(self.store, FakeStore)
        return self.store


def build(
    *,
    feeds: list | None = None,  # type: ignore[type-arg]
    answers: dict | None = None,  # type: ignore[type-arg]
    exchanges: list | None = None,  # type: ignore[type-arg]
    store: StorePort | None = None,
    limits: Limits | None = None,
    holding: bool = False,
    rng: float = 0.5,
    run_ids: list[str] | None = None,
    run_id: str = "run-1",
    clock: FakeClock | None = None,
) -> Harness:
    clock = clock or FakeClock()
    sleeper = FakeSleeper(clock)
    gateway_type = HoldingGateway if holding else FakeGateway
    gateway = gateway_type(feeds=feeds, answers=answers, exchanges=exchanges, clock=clock)
    grants_now = [D_P9]
    spare = iter(run_ids or [f"run-{n}" for n in range(2, 99)])
    port = store if store is not None else FakeStore()
    collector = Collector(
        store=port,
        gateway=gateway,
        grants=lambda: grants_now[0],
        clock=clock,
        sleeper=sleeper,
        rng=FixedRandom(rng),
        limits=limits or LIMITS,
        run_id=run_id,
        run_id_factory=lambda: next(spare),
    )
    return Harness(collector, port, gateway, clock, sleeper, grants_now)


def small(**overrides: object) -> Limits:
    return replace(LIMITS, **overrides)  # type: ignore[arg-type]


async def until(condition: Callable[[], bool], timeout: float = 5.0) -> None:
    """Yield to the loop and worker threads until `condition()` holds."""
    deadline = asyncio.get_running_loop().time() + timeout
    while not condition():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.001)
