"""Test doubles for the collector: a clock, a sleeper, a random source, a gateway and a store.

Test-time only: release code never imports this module. The store fake follows the SC3-2
function signatures (without the leading `store` argument), returns the real record types and
applies the per-item reject codes the real store documents, so a collector bug such as a missing
`installation_id` fails here and not only against the real store.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable, Mapping
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass, field

from backend.specter_arena.collector.gateway import Feed, MalformedAnswer, Transient
from backend.specter_arena.store import (
    BindingRef,
    BindingSeen,
    CoverageMark,
    DmKey,
    IngestBatch,
    IngestResult,
    ItemKind,
    KnownBinding,
    ObservationIn,
    Outcome,
    OutcomeCounts,
    QuarantineIn,
    Rejection,
    RosterPoll,
    RunStart,
    StoreUnavailable,
    UnknownRun,
    build_dm_key,
    parse_dm_key,
)
from backend.specter_arena.store.records import ITEM_KINDS

START_MS = 1_760_000_000_000
SCRIPT_END = "scripted-end"


class FakeClock:
    def __init__(self, start_ms: int = START_MS) -> None:
        self._now_ms = float(start_ms)
        self._monotonic = 1_000.0

    def now_ms(self) -> int:
        return int(self._now_ms)

    def monotonic(self) -> float:
        return self._monotonic

    def advance(self, seconds: float) -> None:
        self._now_ms += seconds * 1_000
        self._monotonic += seconds


class FakeSleeper:
    """An awaitable sleep that records the requested delay and advances the clock by it."""

    def __init__(self, clock: FakeClock | None = None) -> None:
        self.delays: list[float] = []
        self._clock = clock

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)
        if self._clock is not None:
            self._clock.advance(delay)
        await asyncio.sleep(0)


class FixedRandom:
    """Returns the scripted values in order, then repeats the last one."""

    def __init__(self, *values: float) -> None:
        self._values = values or (0.5,)
        self._index = 0

    def __call__(self) -> float:
        value = self._values[min(self._index, len(self._values) - 1)]
        self._index += 1
        return value


@dataclass(frozen=True)
class GatewayCall:
    kind: str
    target: str | None
    credential: str | None


FeedScript = list[str | bytes | BaseException | Callable[[], None]]
JsonAnswer = object | BaseException


class _ScriptedFeed:
    def __init__(self, items: FeedScript) -> None:
        self._items = list(items)

    async def recv(self) -> str | bytes:
        while self._items:
            item = self._items.pop(0)
            if isinstance(item, BaseException):
                raise item
            if callable(item):
                item()
                continue
            return item
        raise Transient(SCRIPT_END)


class FakeGateway:
    """A scripted gateway port.

    `feeds` holds one script per `open_feed()` call; a script is a list of frames and exceptions
    consumed by `recv()`, and an exception in place of a script makes `open_feed()` itself raise.
    `exchanges` scripts each `exchange_token()` call (None succeeds). `answers` maps a path to the
    answers `get_json` returns in order, repeating the last. Every call and the credential used
    are recorded.
    """

    def __init__(
        self,
        *,
        feeds: list[FeedScript | BaseException] | None = None,
        exchanges: list[BaseException | None] | None = None,
        answers: Mapping[str, list[JsonAnswer]] | None = None,
        clock: FakeClock | None = None,
    ) -> None:
        self._feeds = list(feeds or [])
        self._exchanges = list(exchanges or [])
        self._answers = {path: list(items) for path, items in (answers or {}).items()}
        self._clock = clock or FakeClock()
        self.calls: list[GatewayCall] = []
        self.exchange_count = 0
        self._token = ""
        self._token_at = 0.0

    @property
    def credential(self) -> str:
        return self._token

    @property
    def token_age_s(self) -> float:
        return self._clock.monotonic() - self._token_at if self._token else float("inf")

    async def exchange_token(self) -> None:
        self.calls.append(GatewayCall("exchange", None, self._token or None))
        outcome = self._exchanges.pop(0) if self._exchanges else None
        if outcome is not None:
            raise outcome
        self.exchange_count += 1
        self._token = f"token-{self.exchange_count}"
        self._token_at = self._clock.monotonic()

    async def get_json(self, path: str) -> object:
        self.calls.append(GatewayCall("get", path, self._token or None))
        queue = self._answers.get(path)
        if not queue:
            raise MalformedAnswer
        answer = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(answer, BaseException):
            raise answer
        return answer

    def open_feed(self) -> AbstractAsyncContextManager[Feed]:
        return self._open()

    @asynccontextmanager
    async def _open(self) -> AsyncIterator[Feed]:
        self.calls.append(GatewayCall("feed", None, self._token or None))
        script = self._feeds.pop(0) if self._feeds else Transient(SCRIPT_END)
        if isinstance(script, BaseException):
            raise script
        yield _ScriptedFeed(script)

    def calls_of(self, kind: str) -> list[GatewayCall]:
        return [call for call in self.calls if call.kind == kind]


@dataclass
class _Binding:
    binding_id: str
    seq: int
    dm_key: str
    member_id: str
    memory_store: str
    last_turn: int | None = None
    last_turn_gen: str | None = None


@dataclass
class _Run:
    run_id: str
    started_ms: int
    heartbeat_ms: int
    ended_ms: int | None = None
    end_reason: str | None = None


@dataclass
class FakeStore:
    """In-memory SC3-2: `start_run`, `heartbeat`, `end_run`, `ingest`, `roster_*`, `set_paused`."""

    installation_id: str = "inst_fake_01"
    fail_next: int = 0
    bindings: list[_Binding] = field(default_factory=list)
    runs: dict[str, _Run] = field(default_factory=dict)
    observations: list[ObservationIn] = field(default_factory=list)
    coverage: list[CoverageMark] = field(default_factory=list)
    quarantine: list[QuarantineIn] = field(default_factory=list)
    polls: list[RosterPoll] = field(default_factory=list)
    batches: list[IngestBatch] = field(default_factory=list)
    paused: bool = False
    _revision: int = 0

    def _check_available(self) -> None:
        if self.fail_next > 0:
            self.fail_next -= 1
            raise StoreUnavailable("scripted store failure")

    def start_run(self, *, run_id: str, now_ms: int) -> RunStart:
        self._check_available()
        recovered = [run for run in self.runs.values() if run.ended_ms is None]
        previous = max((run.heartbeat_ms for run in recovered), default=None)
        for run in recovered:
            run.ended_ms, run.end_reason = run.heartbeat_ms, "restart"
        self.runs[run_id] = _Run(run_id, now_ms, now_ms)
        known = tuple(
            KnownBinding(
                b.binding_id,
                b.seq,
                b.dm_key,
                b.member_id,
                b.memory_store,
                b.last_turn,
                b.last_turn_gen,
            )
            for b in self.bindings
        )
        newest_gen = next(
            (b.last_turn_gen for b in reversed(self.bindings) if b.last_turn_gen), None
        )
        return RunStart(
            installation_id=self.installation_id,
            run_id=run_id,
            bindings=known,
            last_turn_gen=newest_gen,
            paused=self.paused,
            recovered_runs=len(recovered),
            previous_ended_ms=previous,
        )

    def _run(self, run_id: str) -> _Run:
        run = self.runs.get(run_id)
        if run is None:
            raise UnknownRun("unknown run")
        return run

    def heartbeat(self, *, run_id: str, now_ms: int) -> None:
        self._check_available()
        self._run(run_id).heartbeat_ms = now_ms

    def end_run(self, *, run_id: str, now_ms: int, reason: str) -> None:
        self._check_available()
        run = self._run(run_id)
        run.ended_ms, run.end_reason = now_ms, reason

    def set_paused(self, paused: bool, now_ms: int) -> None:
        self._check_available()
        self.paused = paused

    def roster_revision(self) -> int:
        self._check_available()
        return self._revision

    def ingest(self, batch: IngestBatch) -> IngestResult:
        self._check_available()
        self.batches.append(batch)
        counts: dict[ItemKind, dict[Outcome, int]] = {
            kind: {"persisted": 0, "deduplicated": 0, "quarantined": 0, "rejected": 0}
            for kind in ITEM_KINDS
        }
        rejections: list[Rejection] = []
        refs: list[BindingRef] = []
        unmatched = 0

        def record(index: int, kind: ItemKind, outcome: Outcome, reason: str | None = None) -> None:
            counts[kind][outcome] += 1
            if outcome == "rejected":
                rejections.append(Rejection(index, kind, reason or "constraint"))

        for index, item in enumerate(batch.items):
            kind = self._kind(item)
            if batch.installation_id != self.installation_id:
                record(index, kind, "rejected", "wrong-installation")
            elif isinstance(item, BindingSeen):
                outcome, reason = self._bind(item, refs)
                record(index, kind, outcome, reason)
            elif isinstance(item, RosterPoll):
                outcome, reason, miss = self._poll(batch.run_id, item)
                unmatched += miss
                record(index, kind, outcome, reason)
            elif isinstance(item, ObservationIn):
                outcome, reason = self._observe(item)
                record(index, kind, outcome, reason)
            elif isinstance(item, CoverageMark):
                self.coverage.append(item)
                record(index, kind, "persisted")
            else:
                self.quarantine.append(item)
                record(index, kind, "quarantined")
        return IngestResult(
            counts={k: OutcomeCounts(**v) for k, v in counts.items()},
            rejections=tuple(rejections),
            bindings=tuple(refs),
            roster_unmatched=unmatched,
            last_seq=None,
        )

    @staticmethod
    def _kind(item: object) -> ItemKind:
        if isinstance(item, BindingSeen):
            return "binding"
        if isinstance(item, RosterPoll):
            return "roster"
        if isinstance(item, ObservationIn):
            return "observation"
        if isinstance(item, CoverageMark):
            return "coverage"
        return "quarantine"

    def _by_dm_key(self, dm_key: str) -> _Binding | None:
        return next((b for b in self.bindings if b.dm_key == dm_key), None)

    def _bind(self, item: BindingSeen, refs: list[BindingRef]) -> tuple[Outcome, str | None]:
        key: DmKey = item.key
        if key.memory_store == "":
            return "rejected", "store-less-bot"
        dm_key = build_dm_key(key)
        if parse_dm_key(dm_key) != key:
            return "rejected", "bad-dm-key"
        existing = self._by_dm_key(dm_key)
        if existing is not None:
            refs.append(
                BindingRef(existing.binding_id, existing.seq, dm_key, key.memory_store, False)
            )
            return "deduplicated", None
        if any(b.memory_store == key.memory_store for b in self.bindings):
            return "rejected", "ambiguous-store"
        seq = len(self.bindings) + 1
        created = _Binding(f"bnd_{seq:08d}", seq, dm_key, key.member_id, key.memory_store)
        self.bindings.append(created)
        refs.append(BindingRef(created.binding_id, seq, dm_key, key.memory_store, True))
        return "persisted", None

    def _poll(self, run_id: str, item: RosterPoll) -> tuple[Outcome, str | None, int]:
        if run_id not in self.runs:
            return "rejected", "unknown-run", 0
        known = {b.memory_store for b in self.bindings}
        unmatched = sum(1 for row in item.rows if row.memory_store not in known)
        changed = (
            not self.polls
            or self.polls[-1].rows != item.rows
            or self.polls[-1].success != item.success
        )
        self.polls.append(item)
        if changed:
            self._revision += 1
        return ("persisted" if changed else "deduplicated"), None, unmatched

    def _observe(self, item: ObservationIn) -> tuple[Outcome, str | None]:
        if item.installation_id != self.installation_id:
            return "rejected", "wrong-installation"
        binding = self._by_dm_key(item.dm_key)
        if binding is None:
            return "rejected", "unknown-binding"
        if item.kind == "row-change":
            if item.dedup_key is not None or item.fact_digest is None:
                return "rejected", "bad-dedup"
            latest = next(
                (
                    seen
                    for seen in reversed(self.observations)
                    if seen.kind == "row-change"
                    and seen.dm_key == item.dm_key
                    and seen.slot_key == item.slot_key
                ),
                None,
            )
            if latest is not None and latest.fact_digest == item.fact_digest:
                return "deduplicated", None
        else:
            if item.fact_digest is not None:
                return "rejected", "bad-dedup"
            if item.dedup_key is not None and any(
                seen.dm_key == item.dm_key
                and seen.event_type == item.event_type
                and seen.dedup_key == item.dedup_key
                for seen in self.observations
            ):
                return "deduplicated", None
        self.observations.append(item)
        if item.turn is not None:
            binding.last_turn, binding.last_turn_gen = item.turn, item.turn_gen
        return "persisted", None
