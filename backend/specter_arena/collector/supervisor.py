from __future__ import annotations

import asyncio
import re
import secrets
import time
from collections import Counter, deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Protocol

from ..config import Grants
from ..store import (
    BindingSeen,
    CoverageMark,
    IngestBatch,
    IngestItem,
    IngestResult,
    ObservationIn,
    QuarantineIn,
    RosterPoll,
    RosterRowIn,
    RunStart,
    Store,
    StoreClosed,
    StoreUnavailable,
    UnknownRun,
    build_dm_key,
    end_run,
    heartbeat,
    ingest,
    set_paused,
    start_run,
)
from .accounting import Accounting, Breakdown
from .gateway import AuthRejected, Feed, GatewayPort, MalformedAnswer, PolicyClose, Transient
from .identity import bot_dm_key
from .lanes import DropRecord, EventLane, RowLane
from .parse import (
    EventParse,
    RowFact,
    load_frame,
    parse_event,
    parse_slots,
    peek_type,
    raw_within_cap,
)
from .vocabulary import LIMITS, Limits, classify_type

AGENTS_PATH = "/api/agents"
ROSTER_UNAVAILABLE = "roster-unavailable"
STORE_LESS_NOTE = "unsupported-store-less-bot"
MAX_NAME_CHARS = 128
MAX_WRITER_PASSES = 50
INVALID_FRAME_TYPE = "invalid"

_TYPE_NAME = re.compile(r"[a-z][a-z0-9_]{0,63}")
_AVATAR_KIND = re.compile(r"[a-z][a-z0-9_-]{0,31}")
_AVATAR_REF = re.compile(r"[A-Za-z0-9._-]{1,128}")


class State(StrEnum):
    STARTING = "starting"
    RUNNING = "running"
    RECONNECTING = "reconnecting"
    PAUSED = "paused"
    STOPPED = "stopped"


@dataclass(frozen=True)
class CollectorStatus:
    state: State
    reason_code: str | None
    since_ms: int
    notes: tuple[tuple[str, int | None], ...]


class CollectionStopped(Exception):
    """Collection must end for `reason`, a member of the store's coverage reasons."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class Clock(Protocol):
    def now_ms(self) -> int: ...

    def monotonic(self) -> float: ...


class SystemClock:
    def now_ms(self) -> int:
        return time.time_ns() // 1_000_000

    def monotonic(self) -> float:
        return time.monotonic()


class StorePort(Protocol):
    """The SC3-2 functions, bound to one store."""

    def start_run(self, *, run_id: str, now_ms: int) -> RunStart: ...

    def heartbeat(self, *, run_id: str, now_ms: int) -> None: ...

    def end_run(self, *, run_id: str, now_ms: int, reason: str) -> None: ...

    def ingest(self, batch: IngestBatch) -> IngestResult: ...

    def set_paused(self, paused: bool, now_ms: int) -> None: ...


class SqliteStorePort:
    """Adapts an open `Store` to `StorePort`."""

    def __init__(self, store: Store) -> None:
        self._store = store

    def start_run(self, *, run_id: str, now_ms: int) -> RunStart:
        return start_run(self._store, run_id=run_id, now_ms=now_ms)

    def heartbeat(self, *, run_id: str, now_ms: int) -> None:
        heartbeat(self._store, run_id=run_id, now_ms=now_ms)

    def end_run(self, *, run_id: str, now_ms: int, reason: str) -> None:
        end_run(self._store, run_id=run_id, now_ms=now_ms, reason=reason)

    def ingest(self, batch: IngestBatch) -> IngestResult:
        return ingest(self._store, batch)

    def set_paused(self, paused: bool, now_ms: int) -> None:
        set_paused(self._store, paused, now_ms)


@dataclass
class _Bound:
    memory_store: str
    last_turn: int | None = None
    last_turn_gen: str | None = None


@dataclass
class _Bucket:
    first_ms: int
    last_ms: int
    size: int
    count: int = 0


@dataclass
class _PendingEvent:
    event: EventParse
    received_ms: int
    deadline: float


@dataclass
class _Drops:
    total: int = 0
    first_ms: int | None = None
    last_ms: int | None = None

    def add(self, record: DropRecord) -> None:
        self.total += record.count
        self.first_ms = (
            record.first_received_ms
            if self.first_ms is None
            else min(self.first_ms, record.first_received_ms)
        )
        self.last_ms = (
            record.last_received_ms
            if self.last_ms is None
            else max(self.last_ms, record.last_received_ms)
        )


@dataclass
class _Batch:
    bindings: list[BindingSeen] = field(default_factory=list)
    rows: list[tuple[RowFact, int]] = field(default_factory=list)
    events: list[tuple[EventParse, str, int]] = field(default_factory=list)
    generated: list[CoverageMark] = field(default_factory=list)
    control: list[CoverageMark | RosterPoll | QuarantineIn] = field(default_factory=list)
    drop_total: int = 0

    def empty(self) -> bool:
        return not (self.bindings or self.rows or self.events or self.generated or self.control)

    def units(self) -> int:
        quarantined = sum(i.count for i in self.control if isinstance(i, QuarantineIn))
        return len(self.rows) + len(self.events) + quarantined


def _dm_key_of(row: RowFact) -> str:
    if row.dm is not None:
        return build_dm_key(row.dm)
    return row.created_by or ""


def _agent_rows(answer: object) -> list[dict[str, object]] | None:
    """The roster rows of an `/api/agents` answer, or None when it has no recognisable list."""
    if isinstance(answer, list):
        return [row for row in answer if isinstance(row, dict)]
    if isinstance(answer, dict):
        for value in answer.values():
            if isinstance(value, list) and value and all(isinstance(r, dict) for r in value):
                return [row for row in value if isinstance(row, dict)]
    return None


def _text(value: object, limit: int = MAX_NAME_CHARS) -> str | None:
    return value[:limit] if isinstance(value, str) else None


def _avatar_parts(value: object) -> tuple[str | None, str | None]:
    if not isinstance(value, dict):
        return None, None
    kind = value.get("kind")
    if not isinstance(kind, str) or _AVATAR_KIND.fullmatch(kind) is None:
        return None, None
    for key in ("file", "id"):
        ref = value.get(key)
        if isinstance(ref, str) and _AVATAR_REF.fullmatch(ref) is not None:
            return kind, ref
    return kind, None


class Collector:
    """Reads the gateway feed and writes allow-listed observations to the store.

    One writer loop is the only caller of `ingest`. Nothing here reads a page, a request or any
    credential other than the one the gateway client holds.
    """

    def __init__(
        self,
        *,
        store: StorePort,
        gateway: GatewayPort,
        grants: Callable[[], Grants],
        clock: Clock,
        sleeper: Callable[[float], Awaitable[None]],
        rng: Callable[[], float],
        limits: Limits = LIMITS,
        run_id: str,
        run_id_factory: Callable[[], str] = lambda: secrets.token_hex(16),
    ) -> None:
        self._store = store
        self._gateway = gateway
        self._grants = grants
        self._clock = clock
        self._sleeper = sleeper
        self._rng = rng
        self._limits = limits
        self._run_id = run_id
        self._run_id_factory = run_id_factory
        self._installation_id = ""

        self._rows: RowLane[RowFact] = RowLane()
        self._events: EventLane[EventParse] = EventLane(limits.event_queue_max)
        self._pending: deque[_PendingEvent] = deque()
        self._new_bindings: deque[BindingSeen] = deque()
        self._control: deque[CoverageMark | RosterPoll | QuarantineIn] = deque()
        self._buckets: dict[tuple[str, str], _Bucket] = {}
        self._drops = _Drops()

        self._bound: dict[str, _Bound] = {}
        self._gap_pending: set[str] = set()
        self._store_less: set[str] = set()
        self._gen: str | None = None

        self._covered = False
        self._covered_since: int | None = None
        self._scope_closed = False
        self._prev_visible = 0
        self._awaiting_full = False
        self._partial_deadline = 0.0
        self._redialed_partial = False
        self._failures = 0
        self._store_failures = 0
        self._store_down_from: int | None = None
        self._fresh_token_used = False
        self._roster_refresh = False
        self._last_poll = float("-inf")
        self._writing = 0

        self._accounting = Accounting()
        self._breakdown = Breakdown()
        self._counters: Counter[str] = Counter()

        self._state = State.STARTING
        self._reason: str | None = None
        self._since_ms = 0
        self._paused = False
        self._halted = False
        self._token_lock = asyncio.Lock()
        self._flush_lock = asyncio.Lock()
        self._first_snapshot = asyncio.Event()
        self._stop_event = asyncio.Event()
        self._stop_args: tuple[str | None, str] = (None, "restart")
        self._main: asyncio.Task[None] | None = None
        self._feed_task: asyncio.Task[None] | None = None
        self._loops: list[asyncio.Task[None]] = []

    # --- lifecycle -------------------------------------------------------------------------

    async def start(self) -> None:
        if await self.begin():
            self._main = asyncio.get_running_loop().create_task(self._supervise())

    async def begin(self) -> bool:
        """Open the run. False when the store is unavailable; the app keeps serving."""
        now = self._clock.now_ms()
        self._since_ms = now
        try:
            started = await asyncio.to_thread(
                self._store.start_run, run_id=self._run_id, now_ms=now
            )
        except StoreUnavailable:
            self._set_state(State.STOPPED, "store-unavailable")
            return False
        self._adopt(started)
        self._paused = started.paused
        self._set_state(State.PAUSED if started.paused else State.STARTING, None)
        return True

    def _adopt(self, started: RunStart) -> None:
        self._installation_id = started.installation_id
        self._run_id = started.run_id
        for known in started.bindings:
            self._bound[known.dm_key] = _Bound(
                known.memory_store, known.last_turn, known.last_turn_gen
            )
        if started.last_turn_gen is not None:
            self._gen = started.last_turn_gen
        self._gap_pending = set(self._bound)
        self._covered = False
        self._covered_since = None

    async def stop(self) -> None:
        """Clean shutdown. Idempotent and never raises."""
        self._request_stop(None, "restart")
        if self._main is not None:
            await asyncio.gather(self._main, return_exceptions=True)
        else:
            await self.halt(None, "restart")

    async def wait_closed(self) -> None:
        """Return once collection has fully ended and the run is closed in the store."""
        if self._main is not None:
            await asyncio.gather(self._main, return_exceptions=True)

    def status(self) -> CollectorStatus:
        notes: tuple[tuple[str, int | None], ...] = ()
        if self._store_less:
            notes = ((STORE_LESS_NOTE, len(self._store_less)),)
        return CollectorStatus(self._state, self._reason, self._since_ms, notes)

    def diagnostics(self) -> dict[str, object]:
        """Counts, closed-set names and reason codes only."""
        body = self._accounting.diagnostics(self._in_flight(), self._breakdown)
        body.update(
            {
                "state": self._state.value,
                "reason": self._reason,
                "row_lane": len(self._rows),
                "event_lane": len(self._events),
                "pending_events": len(self._pending),
                "open_quarantine_buckets": len(self._buckets),
                "store_less_bots": len(self._store_less),
                "counters": dict(self._counters),
            }
        )
        return body

    def _set_state(self, state: State, reason: str | None) -> None:
        if state != self._state or reason != self._reason:
            self._since_ms = self._clock.now_ms()
        self._state, self._reason = state, reason

    def _in_flight(self) -> int:
        buckets = sum(bucket.count for bucket in self._buckets.values())
        queued_quarantine = sum(i.count for i in self._control if isinstance(i, QuarantineIn))
        return (
            len(self._rows)
            + len(self._events)
            + len(self._pending)
            + buckets
            + queued_quarantine
            + self._writing
        )

    # --- supervision -----------------------------------------------------------------------

    def _request_stop(self, status_reason: str | None, coverage_reason: str) -> None:
        if not self._stop_event.is_set():
            self._stop_args = (status_reason, coverage_reason)
            self._stop_event.set()

    async def _supervise(self) -> None:
        loop = asyncio.get_running_loop()
        self._loops = [
            loop.create_task(self._guarded(self._writer_loop)),
            loop.create_task(self._guarded(self._heartbeat_loop)),
            loop.create_task(self._guarded(self._roster_loop)),
        ]
        if not self._paused:
            self._feed_task = loop.create_task(self._guarded(self._feed_loop))
        await self._stop_event.wait()
        tasks = [*self._loops, *([self._feed_task] if self._feed_task else [])]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.halt(*self._stop_args)

    async def _guarded(self, work: Callable[[], Awaitable[None]]) -> None:
        try:
            await work()
        except CollectionStopped as stopped:
            self._request_stop(stopped.reason, stopped.reason)
        except Exception as error:
            self._counters[f"internal-error:{type(error).__name__}"[:64]] += 1
            self._request_stop("internal-error", "restart")

    async def halt(self, status_reason: str | None, coverage_reason: str) -> None:
        """End the run: close coverage, flush what can be flushed, end the run. Never raises."""
        if self._halted:
            return
        self._halted = True
        if self._state is not State.STOPPED:
            self._set_state(State.STOPPED, status_reason or "shutdown")
        if self._covered:
            self._enqueue_close(coverage_reason, self._clock.now_ms())
        self._flush_all_buckets()
        try:
            await self._drain()
        except Exception:
            self._counters["halt-flush-failed"] += 1
        try:
            await asyncio.to_thread(
                self._store.end_run,
                run_id=self._run_id,
                now_ms=self._clock.now_ms(),
                reason=coverage_reason,
            )
        except (StoreUnavailable, StoreClosed, UnknownRun):
            self._counters["end-run-failed"] += 1

    async def pause(self) -> None:
        if self._paused or self._halted:
            return
        self._paused = True
        if self._feed_task is not None:
            self._feed_task.cancel()
            await asyncio.gather(self._feed_task, return_exceptions=True)
            self._feed_task = None
        now = self._clock.now_ms()
        await self._set_paused(True, now)
        if self._covered:
            self._enqueue_close("paused", now)
        self._set_state(State.PAUSED, None)
        await self._drain()

    async def resume(self) -> None:
        if not self._paused or self._halted:
            return
        await self._set_paused(False, self._clock.now_ms())
        self._paused = False
        self._set_state(State.STARTING, None)
        if self._main is not None:
            self._feed_task = asyncio.get_running_loop().create_task(self._guarded(self._feed_loop))

    async def _set_paused(self, paused: bool, now: int) -> None:
        try:
            await asyncio.to_thread(self._store.set_paused, paused, now)
        except StoreUnavailable:
            self._counters["set-paused-failed"] += 1

    # --- feed ------------------------------------------------------------------------------

    async def _feed_loop(self) -> None:
        while True:
            if await self.feed_once():
                continue
            await self._sleep_backoff(self._failures)
            self._failures += 1

    def _check_grants(self) -> None:
        grants = self._grants()
        if grants.missing():
            raise CollectionStopped("scope-lost-or-silent")
        if grants.unknown:
            self._counters["grants-unverified"] += 1

    async def feed_once(self) -> bool:
        """One connection from dial to disconnect.

        True means re-enter at once (a fresh token was just obtained); False means the feed ended
        and the caller should back off. Raises `CollectionStopped` when collection must end.
        """
        self._check_grants()
        try:
            await self._renew_if_stale()
            async with self._gateway.open_feed() as feed:
                self._on_connect()
                await self._read(feed)
        except AuthRejected as error:
            try:
                await self._refresh_once_or_stop(error)
            except Transient:
                pass
            else:
                return True
        except PolicyClose:
            raise CollectionStopped("app-disabled") from None
        except (Transient, MalformedAnswer):
            pass
        await self._mark_close("disconnect")
        return False

    def _on_connect(self) -> None:
        self._awaiting_full = False
        self._redialed_partial = False

    async def _read(self, feed: Feed) -> None:
        while True:
            self._handle(await self._recv(feed))

    async def _recv(self, feed: Feed) -> str | bytes:
        if not self._awaiting_full or self._redialed_partial:
            return await feed.recv()
        remaining = max(self._partial_deadline - self._clock.monotonic(), 0.0)
        try:
            return await asyncio.wait_for(feed.recv(), remaining)
        except TimeoutError:
            self._redialed_partial = True
            self._counters["partial-resnapshot-redial"] += 1
            raise Transient("partial-no-snapshot") from None

    def _note_ok(self) -> None:
        self._fresh_token_used = False

    async def _renew_if_stale(self) -> None:
        if self._gateway.token_age_s < self._limits.token_renew_s:
            return
        async with self._token_lock:
            if self._gateway.token_age_s >= self._limits.token_renew_s:
                try:
                    await self._gateway.exchange_token()
                except AuthRejected:
                    raise CollectionStopped("auth-stopped") from None

    async def _refresh_once_or_stop(self, error: AuthRejected) -> None:
        """One fresh exchange per failure episode, then stop. A transient error propagates."""
        if error.exchange or self._fresh_token_used:
            raise CollectionStopped("auth-stopped")
        self._fresh_token_used = True
        async with self._token_lock:
            try:
                await self._gateway.exchange_token()
            except AuthRejected:
                raise CollectionStopped("auth-stopped") from None

    async def _sleep_backoff(self, failures: int) -> None:
        steps = self._limits.backoff_s
        base = steps[min(failures, len(steps) - 1)]
        spread = self._limits.jitter * (2 * self._rng() - 1)
        await self._sleeper(max(base * (1 + spread), 0.0))

    async def _mark_close(self, reason: str) -> None:
        now = self._clock.now_ms()
        self._gap_pending |= set(self._bound)
        self._awaiting_full = False
        self._scope_closed = False
        if self._covered:
            self._enqueue_close(reason, now)
        self._set_state(State.RECONNECTING, reason)
        await self._drain()

    def _enqueue_close(self, reason: str, now: int) -> None:
        self._control.append(CoverageMark("close", now, reason=reason))
        self._covered = False
        self._covered_since = None

    # --- frames ----------------------------------------------------------------------------

    def _count(self, name: str, amount: int = 1) -> None:
        if amount:
            self._counters[name] += amount

    def _unit(self, count: int = 1) -> None:
        self._accounting.received += count

    def _quarantine(self, reason: str, frame_type: str, size: int, now: int) -> None:
        safe = frame_type if _TYPE_NAME.fullmatch(frame_type) else INVALID_FRAME_TYPE
        bucket = self._buckets.get((reason, safe))
        if bucket is None:
            bucket = self._buckets[(reason, safe)] = _Bucket(now, now, size)
        bucket.last_ms = now
        bucket.size = max(bucket.size, size)
        bucket.count += 1

    def _handle(self, message: str | bytes) -> None:
        now = self._clock.now_ms()
        self._note_ok()
        self._sweep_pending()
        if isinstance(message, bytes):
            self._unit()
            self._quarantine("malformed-frame", "binary", len(message), now)
            return
        frame_type = peek_type(message)
        frame: dict[str, object] | None = None
        if frame_type is None:
            frame, reason = load_frame(message)
            if frame is None:
                self._unit()
                self._quarantine(reason or "malformed-frame", INVALID_FRAME_TYPE, len(message), now)
                return
            frame_type = str(frame["type"])
        if _TYPE_NAME.fullmatch(frame_type) is None:
            self._unit()
            self._quarantine("malformed-frame", INVALID_FRAME_TYPE, len(message), now)
            return
        kind = classify_type(frame_type)
        if kind == "ignored":
            self._unit()
            self._accounting.ignored += 1
            self._breakdown.ignore_type(frame_type)
            return
        if kind == "quarantine":
            self._unit()
            self._quarantine("unknown-event-type", frame_type, len(message), now)
            return
        if frame_type != "slots" and not raw_within_cap(message):
            self._unit()
            self._quarantine("oversize-frame", frame_type, len(message), now)
            return
        if frame is None:
            frame, reason = load_frame(message)
            if frame is None:
                self._unit()
                self._quarantine(reason or "malformed-frame", frame_type, len(message), now)
                return
        if frame_type == "slots":
            self._on_slots(frame, now, len(message))
        else:
            self._on_event(frame_type, frame, now, len(message))

    def _on_slots(self, frame: dict[str, object], now: int, size: int) -> None:
        parsed = parse_slots(frame, frozenset(self._bound))
        if parsed.frame_reason is not None:
            self._unit()
            self._quarantine(parsed.frame_reason, "slots", size, now)
            return
        rows = (*parsed.bots, *parsed.workers)
        self._unit(len(rows) + len(parsed.rejected))
        for reason in parsed.rejected:
            self._accounting.rejected += 1
            self._breakdown.reject(reason)
        self._count("other-rows", parsed.other_rows)
        self._count("facts-nulled", sum(row.nulled for row in rows))
        for digest in parsed.store_less:
            if len(self._store_less) < self._limits.known_binding_max:
                self._store_less.add(digest)
        self._bind_new(parsed.bots, now)
        self._mark_source_restart(parsed.bots, now)
        for row in rows:
            self._note_turns(row, now)
            if self._rows.put(row, now):
                self._accounting.coalesced += 1
        self._release_pending()
        if parsed.partial:
            self._partial_snapshot()
            return
        self._full_snapshot(len(parsed.bots), now)

    def _bind_new(self, bots: tuple[RowFact, ...], now: int) -> None:
        for bot in bots:
            dm_key = _dm_key_of(bot)
            if dm_key in self._bound or bot.dm is None:
                continue
            if len(self._bound) >= self._limits.known_binding_max:
                self._counters["binding-limit"] += 1
                continue
            self._bound[dm_key] = _Bound(bot.dm.memory_store)
            self._gap_pending.add(dm_key)
            self._new_bindings.append(BindingSeen(bot.dm, now, bot.source_time_ms))
            self._roster_refresh = True

    def _mark_source_restart(self, bots: tuple[RowFact, ...], now: int) -> None:
        for bot in bots:
            if bot.turn_gen is None:
                continue
            previous, self._gen = self._gen, bot.turn_gen
            if previous is not None and previous != bot.turn_gen:
                self._control.append(self._point_gap("source-restart", now))
                return

    def _note_turns(self, row: RowFact, now: int) -> None:
        if row.dm is None or row.turn is None or row.turn_gen is None:
            return
        dm_key = _dm_key_of(row)
        bound = self._bound.get(dm_key)
        if bound is None:
            return
        if (
            dm_key in self._gap_pending
            and bound.last_turn is not None
            and bound.last_turn_gen == row.turn_gen
            and row.turn > bound.last_turn + 1
        ):
            self._control.append(
                self._point_gap("unobserved-turns", now, {"turns": row.turn - bound.last_turn - 1})
            )
        self._gap_pending.discard(dm_key)
        bound.last_turn, bound.last_turn_gen = row.turn, row.turn_gen

    @staticmethod
    def _point_gap(reason: str, now: int, dropped: dict[str, int] | None = None) -> CoverageMark:
        return CoverageMark("gap", now, reason=reason, from_ms=now, dropped=dropped or {})

    def _partial_snapshot(self) -> None:
        if not self._awaiting_full:
            self._awaiting_full = True
            self._partial_deadline = self._clock.monotonic() + self._limits.partial_resnapshot_s

    def _full_snapshot(self, bot_count: int, now: int) -> None:
        self._awaiting_full = False
        self._failures = 0
        self._first_snapshot.set()
        if not self._covered and not (self._scope_closed and bot_count == 0):
            self._control.append(CoverageMark("open-covered", now))
            self._covered, self._covered_since = True, now
            self._scope_closed = False
            self._set_state(State.RUNNING, None)
        if bot_count == 0 and self._prev_visible > 0 and self._covered:
            self._enqueue_close("scope-lost-or-silent", now)
            self._scope_closed = True
        self._prev_visible = bot_count

    def _on_event(self, frame_type: str, frame: dict[str, object], now: int, size: int) -> None:
        self._unit()
        parsed = parse_event(frame_type, frame)
        if isinstance(parsed, str):
            self._quarantine(parsed, frame_type, size, now)
            return
        self._count("facts-nulled", parsed.nulled)
        if parsed.slot_key in self._bound:
            self._events.put(parsed, parsed.slot_key, now)
        elif bot_dm_key(parsed.slot_key) is not None:
            self._hold(parsed, now)
        else:
            self._accounting.ignored += 1
            self._breakdown.ignore_reason("worker-event")

    def _hold(self, event: EventParse, now: int) -> None:
        if len(self._pending) >= self._limits.pending_event_max:
            self._expire_oldest()
        deadline = self._clock.monotonic() + self._limits.pending_event_ttl_s
        self._pending.append(_PendingEvent(event, now, deadline))

    def _expire_oldest(self) -> None:
        self._pending.popleft()
        self._accounting.ignored += 1
        self._breakdown.ignore_reason("unbound-expired")

    def _sweep_pending(self) -> None:
        now = self._clock.monotonic()
        while self._pending and self._pending[0].deadline <= now:
            self._expire_oldest()

    def _release_pending(self) -> None:
        kept: deque[_PendingEvent] = deque()
        for held in self._pending:
            if held.event.slot_key in self._bound:
                self._events.put(held.event, held.event.slot_key, held.received_ms)
            else:
                kept.append(held)
        self._pending = kept

    # --- writer ----------------------------------------------------------------------------

    async def _writer_loop(self) -> None:
        while True:
            await self._sleeper(self._limits.flush_interval_s)
            await self._drain()
            if self._store_failures:
                await self._sleep_backoff(self._store_failures - 1)

    async def _drain(self) -> None:
        for _ in range(MAX_WRITER_PASSES):
            if not await self.flush():
                return

    def _flush_all_buckets(self) -> None:
        for key in list(self._buckets):
            self._move_bucket(key)

    def _flush_expired_buckets(self, now: int) -> None:
        window_ms = int(self._limits.quarantine_window_s * 1000)
        for key, bucket in list(self._buckets.items()):
            if now - bucket.first_ms >= window_ms:
                self._move_bucket(key)

    def _move_bucket(self, key: tuple[str, str]) -> None:
        bucket = self._buckets.pop(key)
        reason, frame_type = key
        self._control.append(
            QuarantineIn(
                received_at_ms=bucket.last_ms,
                reason=reason,
                frame_type=frame_type,
                size_bytes=bucket.size,
                digest=None,
                count=bucket.count,
                first_received_at_ms=bucket.first_ms,
            )
        )

    def _take_batch(self, now: int) -> _Batch:
        batch = _Batch()
        room = self._limits.batch_max
        while self._new_bindings and room > 0:
            batch.bindings.append(self._new_bindings.popleft())
            room -= 1
        batch.rows = self._rows.drain(room)
        room -= len(batch.rows)
        batch.events = self._events.drain(room)
        room -= len(batch.events)
        for record in self._events.take_drops():
            self._drops.add(record)
        if self._drops.total and room > 0:
            batch.generated.append(self._overflow_mark())
            batch.drop_total = self._drops.total
            room -= 1
        if self._store_down_from is not None and room > 0:
            batch.generated.append(self._store_down_mark(now))
            room -= 1
        if not len(self._rows) and not len(self._events):
            while self._control and room > 0:
                batch.control.append(self._control.popleft())
                room -= 1
        return batch

    def _clamped_from(self, start_ms: int) -> int:
        return start_ms if self._covered_since is None else max(start_ms, self._covered_since)

    def _overflow_mark(self) -> CoverageMark:
        first = self._drops.first_ms if self._drops.first_ms is not None else 0
        last = self._drops.last_ms if self._drops.last_ms is not None else first
        from_ms = self._clamped_from(first)
        return self._span_gap(
            "overflow", from_ms, max(last, from_ms), {"events": self._drops.total}
        )

    def _store_down_mark(self, now: int) -> CoverageMark:
        from_ms = self._clamped_from(self._store_down_from or now)
        return self._span_gap("store-unavailable", from_ms, max(now, from_ms), {})

    def _span_gap(
        self, reason: str, from_ms: int, at_ms: int, dropped: dict[str, int]
    ) -> CoverageMark:
        """A gap over [from_ms, at_ms]; the store starts a new covered interval at `at_ms`."""
        if self._covered and at_ms > from_ms:
            self._covered_since = at_ms
        return CoverageMark("gap", at_ms, reason=reason, from_ms=from_ms, dropped=dropped)

    def _requeue(self, batch: _Batch) -> None:
        self._new_bindings.extendleft(reversed(batch.bindings))
        self._accounting.coalesced += self._rows.requeue(batch.rows)
        self._events.requeue_front(batch.events)
        self._control.extendleft(reversed(batch.control))

    @staticmethod
    def _items(batch: _Batch, installation_id: str) -> list[IngestItem]:
        items: list[IngestItem] = list(batch.bindings)
        for row, received_ms in batch.rows:
            items.append(
                ObservationIn(
                    installation_id=installation_id,
                    dm_key=_dm_key_of(row),
                    slot_key=row.slot_key,
                    kind="row-change",
                    event_type="slot-row",
                    received_at_ms=received_ms,
                    payload=dict(row.facts),
                    source_time_ms=row.source_time_ms,
                    turn=row.turn,
                    turn_gen=row.turn_gen,
                    fact_digest=row.fact_digest,
                )
            )
        for event, dm_key, received_ms in batch.events:
            items.append(
                ObservationIn(
                    installation_id=installation_id,
                    dm_key=dm_key,
                    slot_key=event.slot_key,
                    kind="event",
                    event_type=event.event_type,
                    received_at_ms=received_ms,
                    payload=dict(event.payload),
                    turn=event.turn,
                    turn_gen=event.turn_gen,
                    tool_call_id=event.tool_call_id,
                    dedup_key=event.dedup_key,
                )
            )
        marks: list[CoverageMark] = [m for m in batch.control if isinstance(m, CoverageMark)]
        marks.extend(batch.generated)
        ordered_marks = sorted(marks, key=lambda mark: mark.at_ms)
        items.extend(ordered_marks)
        items.extend(i for i in batch.control if not isinstance(i, CoverageMark))
        return items

    async def flush(self) -> bool:
        """Write one batch. True when a batch was written, False when idle or the store is down."""
        async with self._flush_lock:
            now = self._clock.now_ms()
            self._sweep_pending()
            self._flush_expired_buckets(now)
            batch = self._take_batch(now)
            if batch.empty():
                return False
            items = self._items(batch, self._installation_id)
            self._writing = batch.units()
            try:
                result, interrupted = await self._write(batch, items, now)
            finally:
                self._writing = 0
            if result is not None:
                self._store_failures = 0
                self._store_down_from = None
                self._account(result, batch, items)
            if interrupted is not None:
                raise interrupted
            return result is not None

    async def _write(
        self, batch: _Batch, items: list[IngestItem], now: int
    ) -> tuple[IngestResult | None, asyncio.CancelledError | None]:
        """Run one ingest on a worker thread and always settle its outcome.

        A cancellation (shutdown, pause) while the thread is writing does not abandon the
        result: the write is awaited to its end so the items are accounted for or requeued, and
        the cancellation is handed back to the caller to re-raise.
        """
        work = asyncio.ensure_future(
            asyncio.to_thread(
                self._store.ingest, IngestBatch(self._run_id, self._installation_id, tuple(items))
            )
        )
        interrupted: asyncio.CancelledError | None = None
        try:
            try:
                return await asyncio.shield(work), None
            except asyncio.CancelledError as cancelled:
                interrupted = cancelled
                return await work, interrupted
        except StoreUnavailable:
            self._requeue(batch)
            self._store_failures += 1
            if self._store_down_from is None:
                self._store_down_from = now
        except StoreClosed:
            self._requeue(batch)
            self._counters["store-closed"] += 1
        return None, interrupted

    def _account(self, result: IngestResult, batch: _Batch, items: list[IngestItem]) -> None:
        acc = self._accounting
        counts = result.counts["observation"]
        acc.persisted += counts.persisted
        acc.deduplicated += counts.deduplicated
        acc.rejected += counts.rejected
        rejected_indexes = {r.index for r in result.rejections}
        rejected_quarantine = 0
        for rejection in result.rejections:
            item = items[rejection.index]
            if rejection.kind == "observation":
                self._breakdown.reject(rejection.reason)
            elif rejection.kind == "quarantine" and isinstance(item, QuarantineIn):
                acc.rejected += item.count
                rejected_quarantine += item.count
                self._breakdown.reject(rejection.reason, item.count)
            elif rejection.kind == "binding" and isinstance(item, BindingSeen):
                self._bound.pop(build_dm_key(item.key), None)
                self._counters["binding-rejected"] += 1
            else:
                self._counters[f"{rejection.kind}-rejected"] += 1
        for item in batch.control:
            if isinstance(item, QuarantineIn):
                self._breakdown.quarantine(item.reason, item.count)
        persisted_quarantine = (
            sum(i.count for i in batch.control if isinstance(i, QuarantineIn)) - rejected_quarantine
        )
        acc.quarantined += persisted_quarantine
        self._account_overflow(batch, items, rejected_indexes)

    def _account_overflow(
        self, batch: _Batch, items: list[IngestItem], rejected_indexes: set[int]
    ) -> None:
        if not batch.drop_total:
            return
        for index, item in enumerate(items):
            if not any(item is mark for mark in batch.generated):
                continue
            if not isinstance(item, CoverageMark) or item.reason != "overflow":
                continue
            if index in rejected_indexes:
                self._accounting.rejected += batch.drop_total
                self._breakdown.reject("bad-coverage-mark", batch.drop_total)
            else:
                self._accounting.dropped_with_gap_record += batch.drop_total
            self._drops = _Drops()

    # --- heartbeat -------------------------------------------------------------------------

    async def _heartbeat_loop(self) -> None:
        while True:
            await self._sleeper(self._limits.heartbeat_interval_s)
            await self.beat()

    async def beat(self) -> None:
        try:
            await asyncio.to_thread(
                self._store.heartbeat, run_id=self._run_id, now_ms=self._clock.now_ms()
            )
        except StoreUnavailable:
            if self._store_down_from is None:
                self._store_down_from = self._clock.now_ms()
        except UnknownRun:
            await self._new_run()
        except StoreClosed:
            self._counters["store-closed"] += 1

    async def _new_run(self) -> None:
        self._counters["new-run"] += 1
        run_id = self._run_id_factory()
        try:
            started = await asyncio.to_thread(
                self._store.start_run, run_id=run_id, now_ms=self._clock.now_ms()
            )
        except (StoreUnavailable, StoreClosed):
            return
        self._adopt(started)

    # --- roster ----------------------------------------------------------------------------

    async def _roster_loop(self) -> None:
        await self._first_snapshot.wait()
        while True:
            if not self._paused:
                due = self._clock.monotonic() - self._last_poll >= self._limits.roster_interval_s
                refresh = (
                    self._roster_refresh
                    and self._clock.monotonic() - self._last_poll
                    >= self._limits.roster_refresh_min_s
                )
                if due or refresh:
                    await self.poll_roster()
            await self._sleeper(self._limits.roster_refresh_min_s)

    async def poll_roster(self) -> None:
        """Read `/api/agents` once and queue the result as a roster poll."""
        self._check_grants()
        self._last_poll = self._clock.monotonic()
        self._roster_refresh = False
        now = self._clock.now_ms()
        answer = await self._fetch_agents()
        rows = None if answer is None else self._roster_rows(answer)
        if rows is None:
            self._control.append(RosterPoll(False, now, (), ROSTER_UNAVAILABLE))
        else:
            self._control.append(RosterPoll(True, now, rows))
            self._reopen_if_all_absent(rows, now)
        await self._drain()

    async def _fetch_agents(self) -> object | None:
        try:
            await self._renew_if_stale()
            answer = await self._gateway.get_json(AGENTS_PATH)
        except AuthRejected as error:
            try:
                await self._refresh_once_or_stop(error)
                answer = await self._gateway.get_json(AGENTS_PATH)
            except AuthRejected:
                raise CollectionStopped("auth-stopped") from None
            except (Transient, MalformedAnswer):
                return None
        except (Transient, MalformedAnswer):
            return None
        self._note_ok()
        return answer

    def _roster_rows(self, answer: object) -> tuple[RosterRowIn, ...] | None:
        listed = _agent_rows(answer)
        if listed is None or len(listed) > self._limits.roster_rows_max:
            return None
        known = {bound.memory_store for bound in self._bound.values()}
        matched: dict[str, RosterRowIn] = {}
        for row in listed:
            store = row.get("memory_store")
            name = _text(row.get("name"))
            if row.get("scope") != "global" or not isinstance(store, str) or name is None:
                continue
            if store not in known or store in matched:
                continue
            kind, ref = _avatar_parts(row.get("avatar"))
            matched[store] = RosterRowIn(store, name, _text(row.get("display_name")), kind, ref)
        ordered = [matched[store] for store in sorted(matched)]
        if len(ordered) > self._limits.roster_poll_rows_max:
            self._counters["roster-truncated"] += 1
        return tuple(ordered[: self._limits.roster_poll_rows_max])

    def _reopen_if_all_absent(self, rows: tuple[RosterRowIn, ...], now: int) -> None:
        if self._scope_closed and not self._covered and not rows:
            self._control.append(CoverageMark("open-covered", now))
            self._covered, self._covered_since = True, now
            self._scope_closed = False
