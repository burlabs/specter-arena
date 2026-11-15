# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Protocol
from urllib.parse import quote

from ..config import Grants
from .events import MAX_KEPT_ROWS, PendingEvent, PendingEvents, event_label
from .frames import (
    Attempt,
    AttemptKind,
    Row,
    Signal,
    diff_slots,
    event_signal_kind,
    is_bot_dm_key,
    is_bot_root,
    json_type_name,
    outcome_evidence,
    probe_keys,
    slot_role,
)
from .frames import slot_rows as frame_rows
from .matrix import (
    DENIAL_STATUSES,
    BodyShape,
    Observation,
    Run,
    apply_observation,
)
from .observers import RenameObserver, closed_tab_verdict, resync_summary
from .options import DEFAULT_AGENTS_POLL_SECONDS
from .sanitise import digest, redact_text, sanitise_frame

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

# A path outside the grant set the overlay declares (agents, chat slots, member records).
UNGRANTED_PATH = "/api/config"
ERROR_KEYS = ("error", "detail", "message", "reason")
MAX_LISTED_KEYS = 20
REASON_KEYS = ("code", "error")
MAX_REASON_CHARS = 200
SLOTS_EVENT = "slots:user"
SUBAGENT_EVENT = "subagent:user"
CHAT_SLOTS_PATH = "/api/chat/slots"
AGENTS_PATH = "/api/agents"
USAGE_PATH = "/api/usage"
SESSIONS_USAGE_PATH = "/api/sessions/usage"
# Produced only by live.py after it re-dials; any other frame type starting with "_" is dropped.
RECONNECT_MARKER = "_probe_reconnect"
SUBSCRIBE_SUBAGENTS = '{"type":"subscribe_subagents"}'
ALLOWED_CLIENT_TEXT = (SUBSCRIBE_SUBAGENTS,)
REPLAY_SECONDS = 10.0
PER_BOT_KEYS = frozenset({"slot", "session", "member", "bot", "agent"})
MAX_USAGE_KEY_DEPTH = 3


class PortError(Exception):
    """The gateway could not be reached or answered unusably. Messages never carry URLs."""


class TokenExchangeError(PortError):
    def __init__(self, status: int | None = None) -> None:
        super().__init__(f"token exchange failed (status {status})")
        self.status = status


class FeedRejected(PortError):
    """The feed handshake was refused; `status` is the HTTP status of the refusal."""

    def __init__(self, status: int) -> None:
        super().__init__(f"feed handshake rejected (status {status})")
        self.status = status


class GatewayPort(Protocol):
    """Everything a probe step may do to the gateway. `live.py` implements it; tests fake it."""

    @property
    def token_transport(self) -> str | None:
        """The token transport the feed opened with, once one has worked."""
        ...

    async def exchange_token(self) -> str: ...

    async def http(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        *,
        token: bool = True,
        local: bool = False,
    ) -> tuple[int, bytes]:
        """Send a request. `token=False` sends none; `local=True` targets the backend itself."""
        ...

    def open_feed(self) -> AsyncIterator[dict[str, object]]: ...

    async def send_text(self, text: str) -> None:
        """Send one client message on the feed, now and after every reconnect."""
        ...

    def drop_feed(self) -> None:
        """Close the feed's current connection so it reconnects; a no-op when not connected."""
        ...


def is_allowed_client_text(text: str) -> bool:
    """The only client message the probe may send on the feed."""
    return text in ALLOWED_CLIENT_TEXT


def is_reserved_frame_type(frame_type: object) -> bool:
    """Frame types starting with `_` belong to the probe itself (the reconnect marker); a gateway
    frame of such a type is dropped so the host can never forge one."""
    return isinstance(frame_type, str) and frame_type.startswith("_")


def _epoch_ms() -> int:
    return time.time_ns() // 1_000_000


def _no_requests() -> list[str]:
    return []


@dataclass
class StepContext:
    run: Run
    now: Callable[[], str]
    grants: Grants = field(default_factory=lambda: Grants.assumed("default"))
    gateway_available: bool = True
    other_app: str = "specter-other"
    cli_slot_key: str = ""
    capture_seconds: float = 30.0
    max_kept_rows: int = MAX_KEPT_ROWS
    reconnect_after_start: float | None = None
    agents_poll_seconds: float = DEFAULT_AGENTS_POLL_SECONDS
    # ISO receive times of signed page requests; the closed-tab cell looks for gaps in them.
    page_requests: Callable[[], list[str]] = _no_requests
    clock_ms: Callable[[], int] = _epoch_ms
    monotonic: Callable[[], float] = time.monotonic


StepRunner = Callable[[GatewayPort, StepContext], Awaitable[list[Observation]]]


@dataclass(frozen=True)
class Step:
    id: str
    cells: tuple[str, ...]
    run: StepRunner
    needs_gateway: bool = True


class UnknownStep(KeyError):
    pass


_MALFORMED = object()


def _parse(body: bytes) -> object:
    try:
        return json.loads(body)
    except ValueError:
        return _MALFORMED


def body_shape(status: int, parsed: object) -> BodyShape:
    if parsed is _MALFORMED:
        return "other"
    if 200 <= status < 300:
        return "expected" if isinstance(parsed, dict | list) else "other"
    if status in DENIAL_STATUSES and isinstance(parsed, dict):
        return "error" if any(key in parsed for key in ERROR_KEYS) else "other"
    return "other"


def describe(parsed: object) -> str:
    """Shape only: field names and counts, never values."""
    if parsed is _MALFORMED:
        return "malformed JSON"
    if isinstance(parsed, dict):
        keys = sorted(str(key) for key in parsed)[:MAX_LISTED_KEYS]
        return f"object with fields {', '.join(keys)}"
    if isinstance(parsed, list):
        return f"list of {len(parsed)}"
    return type(parsed).__name__


def refusal_reasons(status: int, parsed: object) -> str:
    """The host's own `code` and `error` strings from a refusal (status >= 400), else empty.

    Each value is redacted, then cut to MAX_REASON_CHARS. Every other field stays shape-only,
    and a success body never reaches this function's output.
    """
    if status < 400 or not isinstance(parsed, dict):
        return ""
    reasons = [
        f"{name}={json.dumps(redact_text(value)[:MAX_REASON_CHARS])}"
        for name in REASON_KEYS
        if isinstance(value := parsed.get(name), str)
    ]
    return f"; {'; '.join(reasons)}" if reasons else ""


def _answered(method: str, path: str, status: int, body: bytes) -> str:
    parsed = _parse(body)
    shape = describe(parsed) if body else "empty body"
    return f"{method} {path} answered {status}; {shape}{refusal_reasons(status, parsed)}"


def _ref(ctx: StepContext, step_id: str) -> str:
    return f"run/{ctx.run.run_id}/{step_id}"


def _untested(ctx: StepContext, cell_id: str, reason: str) -> Observation:
    return Observation(cell_id, "APP-TOKEN", ctx.now(), "", "", untested_reason=reason, status=None)


def _http_observation(
    ctx: StepContext,
    step_id: str,
    cell_id: str,
    method: str,
    path: str,
    status: int,
    body: bytes,
    *,
    any_2xx: bool = False,
) -> Observation:
    parsed = _parse(body)
    shape: BodyShape = "expected" if any_2xx and 200 <= status < 300 else body_shape(status, parsed)
    return Observation(
        cell_id,
        "APP-TOKEN",
        ctx.now(),
        _ref(ctx, step_id),
        _answered(method, path, status, body),
        status=status,
        body_shape=shape,
    )


async def _token_exchange(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    cell = "app-owned-token-exchange"
    try:
        token = await port.exchange_token()
    except TokenExchangeError as error:
        if error.status in DENIAL_STATUSES:
            return [
                Observation(
                    cell,
                    "APP-TOKEN",
                    ctx.now(),
                    _ref(ctx, "token-exchange"),
                    f"token exchange refused with {error.status}",
                    status=error.status,
                    body_shape="error",
                )
            ]
        raise
    if not token:
        return [_untested(ctx, cell, "token exchange returned an empty token")]
    return [
        Observation(
            cell,
            "APP-TOKEN",
            ctx.now(),
            _ref(ctx, "token-exchange"),
            f"token received ({len(token)} characters, value not recorded)",
            state="ALLOWED",
        )
    ]


async def _own_proxy_unauth(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    status, body = await port.http("GET", "/api/ping", token=False, local=True)
    return [
        _http_observation(
            ctx,
            "own-proxy-unauth",
            "app-owned-unsigned-direct-rejected",
            "GET",
            "/api/ping (unsigned, backend loopback)",
            status,
            body,
        )
    ]


async def _other_app_proxy(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    path = f"/apps/{quote(ctx.other_app, safe='')}/api/ping"
    status, body = await port.http("GET", path)
    return [
        _http_observation(
            ctx, "other-app-proxy", "other-app-proxy-denied", "GET", path, status, body
        )
    ]


def _member_paths(slug: str) -> tuple[tuple[str, str], ...]:
    base = f"/api/members/{quote(slug, safe='')}"
    return (
        ("bot-ledger-read", f"{base}/projections"),
        ("bot-goals-read", f"{base}/goals"),
        ("bot-key-results-read", f"{base}/goals/key-results"),
        ("bot-activity-read", f"{base}/activity"),
        ("bot-notes-memory-private", f"{base}/notes"),
    )


async def _deny_matrix(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    probes = [
        ("other-app-api-denied", UNGRANTED_PATH),
        ("bot-list-members-denied", "/api/members"),
    ]
    slug = ctx.run.probe_slug
    probes.extend(_member_paths(slug) if slug else ())
    observations = []
    for cell_id, path in probes:
        status, body = await port.http("GET", path)
        observations.append(
            _http_observation(ctx, "deny-matrix", cell_id, "GET", path, status, body)
        )
    if not slug:
        observations.extend(
            _untested(ctx, cell_id, "probe slug not set") for cell_id, _ in _member_paths("")
        )
    return observations


def _roster_rows(parsed: object) -> list[Row]:
    if isinstance(parsed, list):
        return [row for row in parsed if isinstance(row, dict)]
    if isinstance(parsed, dict):
        for value in parsed.values():
            if isinstance(value, list) and value and all(isinstance(row, dict) for row in value):
                return [row for row in value if isinstance(row, dict)]
    return []


def _is_probe_row(row: Row, slug: str) -> bool:
    names = {slug, f"member-{slug}"}
    return any(isinstance(value, str) and value in names for value in row.values())


async def _agents_roster(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    path = "/api/agents"
    status, body = await port.http("GET", path)
    parsed = _parse(body)
    listed = _http_observation(
        ctx, "agents-roster", "bot-list-via-agents", "GET", path, status, body
    )
    named = _http_observation(ctx, "agents-roster", "bot-name-avatar", "GET", path, status, body)
    if listed.body_shape != "expected":
        return [listed, named]
    slug = ctx.run.probe_slug
    rows = _roster_rows(parsed)
    row = next((r for r in rows if slug and _is_probe_row(r, slug)), None)
    if row is None:
        why = "probe slug not set" if not slug else "probe bot not found in the roster rows"
        reason = f"{why}; {_answered('GET', path, status, body)}; roster rows: {len(rows)}"
        return [_untested(ctx, listed.cell_id, reason), _untested(ctx, named.cell_id, reason)]
    fields = sorted(str(key) for key in row)
    listing = Observation(
        listed.cell_id,
        "APP-TOKEN",
        listed.at,
        listed.ref,
        f"{path} answered {status}; probe bot row fields {', '.join(fields)}",
        state="ALLOWED",
    )
    if any("name" in f for f in fields) and any("avatar" in f for f in fields):
        return [
            listing,
            Observation(
                named.cell_id,
                "APP-TOKEN",
                named.at,
                named.ref,
                f"probe bot row has name-like and avatar-like fields: {', '.join(fields)}",
                state="ALLOWED",
            ),
        ]
    return [
        listing,
        _untested(ctx, named.cell_id, f"no name and avatar fields among {', '.join(fields)}"),
    ]


def _worker_slot_key(run: Run) -> str:
    for key, row in run.last_rows.items():
        if slot_role(row, run.probe_slug) == "worker":
            return key
    return ""


async def _chat_slots(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    path = CHAT_SLOTS_PATH
    if not ctx.grants.has_api(path):
        reason = f"no {path} grant declared"
        return [
            _untested(ctx, "user-chat-slots-api", reason),
            _untested(ctx, "user-chat-slot-history", reason),
        ]
    status, body = await port.http("GET", path)
    observations = [
        _http_observation(ctx, "chat-slots", "user-chat-slots-api", "GET", path, status, body)
    ]
    worker = _worker_slot_key(ctx.run)
    if not worker:
        observations.append(
            _untested(ctx, "user-chat-slot-history", "no worker slot observed yet; run ws-capture")
        )
        return observations
    history_path = f"{path}/{quote(worker, safe='')}"
    status, body = await port.http("GET", history_path)
    observations.append(
        _http_observation(
            ctx, "chat-slots", "user-chat-slot-history", "GET", history_path, status, body
        )
    )
    return observations


@dataclass
class _FeedTally:
    frames: int = 0
    slot_frames: int = 0
    first_slot_rows: int | None = None
    most_rows: int = 0
    signal_kinds: set[str] = field(default_factory=set)
    dm_row: Row | None = None
    worker_row: Row | None = None
    source_links: bool = False
    terminal_outcome: str | None = None
    terminal_seen: bool = False
    window_start: str = ""
    probe_signals: list[Signal] = field(default_factory=list)
    started: asyncio.Event = field(default_factory=asyncio.Event)
    pending: PendingEvents = field(default_factory=PendingEvents)
    rename: RenameObserver = field(default_factory=RenameObserver)
    tool_results: int = 0
    tool_error_seen: bool = False
    question_cards: int = 0
    subagent_frames: int = 0
    subagent_attributed: int = 0
    batch_id_seen: bool = False
    reconnects: int = 0
    pre_drop_rows: dict[str, Row] = field(default_factory=dict)
    marker_at: float | None = None
    resync_text: str | None = None
    replayed: dict[str, int] = field(default_factory=dict)
    turns_before: dict[str, int] = field(default_factory=dict)
    seen_turns: set[tuple[str, int]] = field(default_factory=set)
    refilled: int = 0


def _attempt_for(run: Run, key: str, row: Row) -> Attempt:
    if key not in run.attempts:
        role = slot_role(row, run.probe_slug)
        kind: AttemptKind = "app-session"
        if role == "bot-dm":
            kind = "bot-turn"
        elif role == "worker":
            kind = "worker-session"
        run.attempts[key] = Attempt(key, kind, bot_ref=run.probe_slug if role == "bot-dm" else None)
    return run.attempts[key]


def _keyed(rows: list[Row]) -> list[Row]:
    return [row for row in rows if isinstance(row.get("key"), str)]


START_KINDS = frozenset({"start", "chat-status"})
PROGRESS_KINDS = frozenset(
    {"progress", "tool-call", "tool-result", "context-usage", "subagent-status"}
)
TERMINAL_KINDS = frozenset({"terminal", "chat-done"})
APPROVAL_KINDS = frozenset({"approval", "needs-input"})


def _note_signal(attempt: Attempt, signal: Signal, tally: _FeedTally) -> None:
    attempt.signals.append(signal)
    tally.signal_kinds.add(signal.kind)
    tally.probe_signals.append(signal)
    if signal.kind in START_KINDS:
        tally.started.set()


def absorb_slots(frame: dict[str, object], ctx: StepContext, tally: _FeedTally) -> None:
    """A `slots` frame: the only frame that moves the diff baseline (`run.last_rows`).

    The baseline holds sanitised probe rows. Outcome text is read from the raw row of the frame
    that ends a turn, masked, and kept on the attempt only; the raw row is not held. The first
    `slots` frame after a deliberate reconnect re-baselines without diffing, so a reconnect
    never reads as a start or a removal.
    """
    run = ctx.run
    clean = sanitise_frame(frame, run.probe_slug, run.salt, run.stats)
    if clean is None:
        return
    run.record_frame(clean)
    rows = _keyed(frame_rows(clean))
    tally.slot_frames += 1
    tally.most_rows = max(tally.most_rows, len(rows))
    if tally.first_slot_rows is None:
        tally.first_slot_rows = len(rows)
    probes = probe_keys(rows, run.probe_slug)
    run.probe_slots = frozenset(probes)
    current = {str(row["key"]): row for row in rows if row["key"] in probes}
    run.bot_slots = frozenset(k for k, row in current.items() if is_bot_root(row, run.probe_slug))
    raw = {str(row["key"]): row for row in _keyed(frame_rows(frame)) if row["key"] in probes}
    for row in current.values():
        if "last_activity_ts" in row:
            run.field_types["last_activity_ts"] = json_type_name(row["last_activity_ts"])
    at = ctx.now()
    if run.resync_pending:
        run.resync_pending = False
        tally.resync_text = resync_summary(tally.pre_drop_rows, current)
        for key, row in current.items():
            _note_signal(_attempt_for(run, key, row), Signal("resync", key, at), tally)
    else:
        for signal in diff_slots(run.last_rows, current, at=at):
            attempt = _attempt_for(run, signal.slot_key, current.get(signal.slot_key, {}))
            _note_signal(attempt, signal, tally)
            if signal.kind == "terminal":
                tally.terminal_seen = True
                text = outcome_evidence(raw.get(signal.slot_key, {}))
                attempt.outcome_evidence = text
                tally.terminal_outcome = tally.terminal_outcome or text
    run.last_rows = current
    for key, row in current.items():
        role = slot_role(row, run.probe_slug)
        _attempt_for(run, key, row)
        if role == "bot-dm":
            tally.dm_row = row
        elif role == "worker":
            tally.worker_row = row
        if isinstance(row.get("source_links"), list) and row["source_links"]:
            tally.source_links = True
    promoted, unresolved = tally.pending.resolve(run.probe_slots)
    for event in promoted:
        _keep_event(ctx, tally, event, "probe")
    for event in unresolved:
        _keep_event(ctx, tally, event, "non-probe")


def _is_bot_slot(run: Run, slot: str) -> bool:
    """Whether an event's slot is one the bot runs itself, by DM key form or by the latest
    `slots` frame (event frames carry no `agent` field of their own)."""
    return slot in run.bot_slots or is_bot_dm_key(slot, run.probe_slug)


def _event_attempt(run: Run, event_type: str, slot: str, data: dict[str, object]) -> Attempt:
    """A subagent frame belongs to a worker attempt named by its (digested) id; every other
    event belongs to its slot's attempt."""
    worker_id = data.get("id")
    if event_type.startswith("subagent_") and isinstance(worker_id, str):
        key = f"subagent:{worker_id}"
        if key not in run.attempts:
            bot_ref = run.probe_slug if _is_bot_slot(run, slot) else None
            run.attempts[key] = Attempt(key, "worker-session", bot_ref=bot_ref)
        return run.attempts[key]
    return _attempt_for(run, slot, run.last_rows.get(slot, {"key": slot}))


def _probe_event(
    ctx: StepContext, tally: _FeedTally, event_type: str, data: dict[str, object]
) -> None:
    """Signals and tallies from one sanitised event on a probe slot."""
    run = ctx.run
    slot = str(data.get("slot"))
    kind = event_signal_kind(event_type)
    if kind is not None:
        attempt = _event_attempt(run, event_type, slot, data)
        _note_signal(attempt, Signal(kind, slot, ctx.now()), tally)
    if event_type == "tool_result":
        tally.tool_results += 1
        tally.tool_error_seen = tally.tool_error_seen or isinstance(data.get("is_error"), bool)
    elif event_type == "question_card":
        tally.question_cards += 1
    elif event_type.startswith("subagent_"):
        tally.subagent_frames += 1
        rooted = _is_bot_slot(run, slot)
        if event_type in ("subagent_spawn", "subagent_done") and rooted:
            tally.subagent_attributed += 1
            tally.batch_id_seen = tally.batch_id_seen or "batch_id" in data
    elif event_type == "chat_done" and isinstance(turn := data.get("turn"), int):
        _note_turn(tally, slot, turn)


def _note_turn(tally: _FeedTally, slot: str, turn: int) -> None:
    """Before a reconnect, remember the latest turn per slot; after it, a turn that is not newer
    than that and was never seen is history the host refilled."""
    if tally.reconnects == 0:
        tally.turns_before[slot] = max(turn, tally.turns_before.get(slot, turn))
    elif (slot, turn) not in tally.seen_turns and turn <= tally.turns_before.get(slot, -1):
        tally.refilled += 1
    tally.seen_turns.add((slot, turn))


def _keep_event(ctx: StepContext, tally: _FeedTally, event: PendingEvent, row_kind: str) -> None:
    data = event.probe_form if row_kind == "probe" else event.plain_form
    ctx.run.events.keep(event.frame_seq, event.event_type, row_kind, event.received_at_ms, data)
    if row_kind == "probe":
        _probe_event(ctx, tally, event.event_type, data)


def _reduced(
    frame: dict[str, object], ctx: StepContext, probe_slots: frozenset[str]
) -> dict[str, object] | None:
    run = ctx.run
    clean = sanitise_frame(frame, run.probe_slug, run.salt, run.stats, probe_slots)
    data = clean.get("data") if clean is not None else None
    return data if isinstance(data, dict) else None


def absorb_event(
    frame: dict[str, object], ctx: StepContext, tally: _FeedTally, seq: int, received_ms: int
) -> None:
    """Any frame other than `slots`: kept in allow-listed form; never touches the baseline.

    An event whose slot is not yet a probe slot waits in the pending buffer (the host may send
    it before the slot row) and is written in non-probe form unless the next `slots` frame
    makes its slot a probe slot.
    """
    run = ctx.run
    clean = sanitise_frame(frame, run.probe_slug, run.salt, run.stats, run.probe_slots)
    if clean is None:
        return
    run.record_frame(clean)
    data = clean.get("data")
    event_type = str(clean["type"])
    if not isinstance(data, dict):
        return
    now = ctx.monotonic()
    for expired in tally.pending.expire(now):
        _keep_event(ctx, tally, expired, "non-probe")
    raw = frame.get("data")
    slot = raw.get("slot") if isinstance(raw, dict) else None
    if isinstance(slot, str) and slot in run.probe_slots:
        event = PendingEvent(slot, now, data, {}, seq, event_type, received_ms)
        _keep_event(ctx, tally, event, "probe")
    elif isinstance(slot, str) and (held := _reduced(frame, ctx, frozenset({slot}))) is not None:
        event = PendingEvent(slot, now, held, data, seq, event_type, received_ms)
        evicted = tally.pending.hold(event)
        if evicted is not None:
            _keep_event(ctx, tally, evicted, "non-probe")
    else:
        event = PendingEvent("", now, {}, data, seq, event_type, received_ms)
        _keep_event(ctx, tally, event, "non-probe")
    replaying = tally.marker_at is not None and now - tally.marker_at <= REPLAY_SECONDS
    if replaying and event_type in ("subagent_snapshot", "subagent_done"):
        tally.replayed[event_type] = tally.replayed.get(event_type, 0) + 1


def _absorb_marker(frame: dict[str, object], ctx: StepContext, tally: _FeedTally) -> None:
    """The reconnect marker from live.py: the next `slots` frame re-baselines."""
    data = frame.get("data")
    generation = data.get("generation") if isinstance(data, dict) else None
    if isinstance(generation, bool) or not isinstance(generation, int) or generation < 2:
        return
    run = ctx.run
    tally.reconnects += 1
    tally.marker_at = ctx.monotonic()
    tally.pre_drop_rows = dict(run.last_rows)
    run.resync_pending = True
    at = ctx.now()
    for key, row in run.last_rows.items():
        _note_signal(_attempt_for(run, key, row), Signal("reconnect", key, at), tally)


def _frame_size(frame: dict[str, object]) -> int:
    return len(json.dumps(frame, default=str))


async def _poll_agents(port: GatewayPort, ctx: StepContext, tally: _FeedTally) -> None:
    """Reads the roster on a timer for the rename cell; keeps a digest of the display name."""
    run = ctx.run
    while True:
        try:
            status, body = await port.http("GET", AGENTS_PATH)
        except (PortError, TimeoutError):
            status, body = 0, b""
        if 200 <= status < 300:
            rows = _roster_rows(_parse(body))
            row = next((r for r in rows if _is_probe_row(r, run.probe_slug)), None)
            name = row.get("display_name") if row is not None else None
            if isinstance(name, str):
                dm_keys = frozenset(run.bot_slots)
                tally.rename.record(digest(run.salt, name), dm_keys)
        await asyncio.sleep(ctx.agents_poll_seconds)


async def _reconnect_after_start(port: GatewayPort, tally: _FeedTally, delay: float) -> None:
    """One deliberate reconnect per window, landing inside the first probe turn."""
    await tally.started.wait()
    await asyncio.sleep(delay)
    port.drop_feed()


async def _drain_feed(port: GatewayPort, ctx: StepContext, tally: _FeedTally) -> None:
    run = ctx.run
    run.events.max_rows = ctx.max_kept_rows
    if ctx.grants.has_event(SUBAGENT_EVENT):
        await port.send_text(SUBSCRIBE_SUBAGENTS)
    helpers: list[asyncio.Task[None]] = []
    if run.probe_slug and ctx.grants.has_api(AGENTS_PATH):
        helpers.append(asyncio.create_task(_poll_agents(port, ctx, tally)))
    if ctx.reconnect_after_start is not None:
        delay = ctx.reconnect_after_start
        helpers.append(asyncio.create_task(_reconnect_after_start(port, tally, delay)))
    feed = port.open_feed()
    try:
        async for frame in feed:
            tally.frames += 1
            frame_type = frame.get("type")
            if frame_type == RECONNECT_MARKER:
                _absorb_marker(frame, ctx, tally)
                continue
            if is_reserved_frame_type(frame_type):
                continue
            received_ms = ctx.clock_ms()
            seq = run.events.seen(event_label(frame_type), _frame_size(frame), received_ms)
            if frame_type == "slots":
                absorb_slots(frame, ctx, tally)
            else:
                absorb_event(frame, ctx, tally, seq, received_ms)
    finally:
        for task in helpers:
            task.cancel()
        await asyncio.gather(*helpers, return_exceptions=True)
        for event in tally.pending.resolve(frozenset())[1]:
            _keep_event(ctx, tally, event, "non-probe")
        close = getattr(feed, "aclose", None)
        if close is not None:
            await close()


WS_CELLS = (
    "app-owned-ws-token-transport",
    "user-slots-no-grant-denied",
    "user-slots-visible",
    "user-signal-start",
    "user-signal-progress",
    "user-signal-terminal",
    "user-signal-approval",
    "user-outcome-evidence",
    "user-source-links",
    "bot-id-observable",
    "bot-own-session-attribution",
    "bot-worker-session-attribution",
    "user-signal-tool-error",
    "closed-tab-collection",
    "reconnect-snapshot",
    "reconnect-cursor-history",
    "bot-id-stable-across-rename",
    "subagent-events-visible",
    "bot-worker-session-attribution-subagent",
)


def _seen(ctx: StepContext, cell_id: str, excerpt: str) -> Observation:
    return Observation(
        cell_id, "APP-TOKEN", ctx.now(), _ref(ctx, "ws-capture"), excerpt, state="ALLOWED"
    )


def _decided(ctx: StepContext, cell_id: str, decided: bool, text: str) -> Observation:
    return _seen(ctx, cell_id, text) if decided else _untested(ctx, cell_id, text)


def _signal_cells(ctx: StepContext, tally: _FeedTally) -> list[Observation]:
    stamp_type = ctx.run.field_types.get("last_activity_ts")
    out: list[Observation] = []
    for cell_id, wanted in (
        ("user-signal-start", START_KINDS),
        ("user-signal-progress", PROGRESS_KINDS),
        ("user-signal-terminal", TERMINAL_KINDS),
        ("user-signal-approval", APPROVAL_KINDS),
    ):
        hit = sorted(tally.signal_kinds & wanted)
        excerpt = f"signal observed on a probe slot: {', '.join(hit)}"
        reason = "signal not observed in the capture window"
        if cell_id == "user-signal-progress" and stamp_type:
            excerpt += f"; last_activity_ts is JSON {stamp_type}"
        if cell_id == "user-signal-terminal":
            excerpt += "; a turn boundary, not an outcome"
        if cell_id == "user-signal-approval":
            cards = f"; question_card frames: {tally.question_cards}"
            excerpt, reason = excerpt + cards, reason + cards
        out.append(_seen(ctx, cell_id, excerpt) if hit else _untested(ctx, cell_id, reason))
    return out


def _reconnect_cells(ctx: StepContext, tally: _FeedTally) -> list[Observation]:
    if not tally.reconnects:
        reason = "no reconnect happened in the window"
        if ctx.reconnect_after_start is None:
            reason += "; no deliberate reconnect was configured"
        return [
            _untested(ctx, "reconnect-snapshot", reason),
            _untested(ctx, "reconnect-cursor-history", reason),
        ]
    replay = ", ".join(f"{name} {count}" for name, count in sorted(tally.replayed.items()))
    snapshot = (
        f"{tally.reconnects} reconnect(s); {tally.resync_text}; replayed within "
        f"{REPLAY_SECONDS:g} s: {replay or 'none'}"
        if tally.resync_text
        else "reconnected but no slots frame followed"
    )
    history = (
        f"{tally.refilled} earlier-turn chat_done frame(s) arrived after the reconnect"
        if tally.refilled
        else "no history frames after reconnect"
    )
    return [
        _decided(ctx, "reconnect-snapshot", tally.resync_text is not None, snapshot),
        _decided(ctx, "reconnect-cursor-history", tally.refilled > 0, history),
    ]


def _window_cells(ctx: StepContext, tally: _FeedTally) -> list[Observation]:
    """The cells only the long capture window decides: tool error, closed tab, reconnect,
    rename and the two subagent cells."""
    out: list[Observation] = []
    if tally.tool_error_seen:
        tool = (True, "tool_result on a probe slot carried a boolean is_error field")
    elif tally.tool_results:
        tool = (False, f"{tally.tool_results} tool_result frame(s) carried no error indicator")
    else:
        tool = (False, "no tool_result on a probe slot in the window")
    out.append(_decided(ctx, "user-signal-tool-error", *tool))

    timed = [s.at for s in tally.probe_signals if s.kind in PROGRESS_KINDS | TERMINAL_KINDS]
    if timed:
        verdict = closed_tab_verdict(timed, ctx.page_requests(), (tally.window_start, ctx.now()))
        out.append(_decided(ctx, "closed-tab-collection", verdict.decided, verdict.text))
    else:
        out.append(_untested(ctx, "closed-tab-collection", "no probe-slot progress or terminal"))

    out.extend(_reconnect_cells(ctx, tally))

    rename_cell = "bot-id-stable-across-rename"
    if not ctx.run.probe_slug:
        out.append(_untested(ctx, rename_cell, "probe slug not set"))
    elif not ctx.grants.has_api(AGENTS_PATH):
        out.append(_untested(ctx, rename_cell, f"no {AGENTS_PATH} grant declared"))
    else:
        rename = tally.rename.verdict()
        out.append(_decided(ctx, rename_cell, rename.decided, rename.text))

    if not ctx.grants.has_event(SUBAGENT_EVENT):
        out.append(_untested(ctx, "subagent-events-visible", "no subagent grant declared"))
    else:
        visible = (
            f"{tally.subagent_frames} subagent frame(s) carried a probe slot"
            if tally.subagent_frames
            else "no subagent frame rooted at the probe bot's slot; a quiet bot and a denial "
            "look the same"
        )
        out.append(_decided(ctx, "subagent-events-visible", tally.subagent_frames > 0, visible))
    batch = "yes" if tally.batch_id_seen else "no"
    attributed = (
        f"{tally.subagent_attributed} subagent_spawn/subagent_done frame(s) carried the probe DM "
        f"slot; batch_id present: {batch}; nesting depth unknown (frames carry the root slot only)"
        if tally.subagent_attributed
        else "no subagent_spawn or subagent_done carried the probe DM slot"
    )
    out.append(
        _decided(
            ctx,
            "bot-worker-session-attribution-subagent",
            tally.subagent_attributed > 0,
            attributed,
        )
    )
    return out


def _feed_observations(ctx: StepContext, port: GatewayPort, tally: _FeedTally) -> list[Observation]:
    slug = ctx.run.probe_slug
    window = f"no matching frame in the {ctx.capture_seconds:g} s window"
    out: list[Observation] = []
    transport = port.token_transport
    if tally.frames and transport:
        out.append(
            _seen(
                ctx, WS_CELLS[0], f"feed opened with token via {transport}; {tally.frames} frames"
            )
        )
    else:
        out.append(_untested(ctx, WS_CELLS[0], "no frame received or transport not reported"))

    first = tally.first_slot_rows
    slots_granted = ctx.grants.has_event(SLOTS_EVENT)
    if slots_granted:
        out.append(
            _untested(ctx, "user-slots-no-grant-denied", "a slots grant is declared; run phase v0")
        )
    elif first is None:
        out.append(_untested(ctx, "user-slots-no-grant-denied", window))
    elif first == 0:
        out.append(
            Observation(
                "user-slots-no-grant-denied",
                "APP-TOKEN",
                ctx.now(),
                _ref(ctx, "ws-capture"),
                "first slots frame held 0 rows without a slots grant",
                state="DENIED",
            )
        )
    else:
        out.append(
            _seen(ctx, "user-slots-no-grant-denied", f"{first} rows visible without a slots grant")
        )

    if not slots_granted:
        out.append(_untested(ctx, "user-slots-visible", "no slots grant declared"))
    elif tally.most_rows:
        out.append(_seen(ctx, "user-slots-visible", f"snapshots held up to {tally.most_rows} rows"))
    else:
        out.append(_untested(ctx, "user-slots-visible", window))

    out.extend(_signal_cells(ctx, tally))

    if tally.terminal_outcome:
        out.append(_seen(ctx, "user-outcome-evidence", f"outcome text: {tally.terminal_outcome}"))
    elif tally.terminal_seen:
        out.append(_untested(ctx, "user-outcome-evidence", "terminal seen with no outcome text"))
    else:
        out.append(_untested(ctx, "user-outcome-evidence", "no terminal signal in the window"))

    out.append(
        _seen(ctx, "user-source-links", "a probe slot carried source_links")
        if tally.source_links
        else _untested(ctx, "user-source-links", "no probe slot carried source_links")
    )
    if tally.dm_row is not None:
        form = (
            f"DM slot key member-{slug}"
            if is_bot_dm_key(str(tally.dm_row.get("key", "")), slug)
            else "a slot whose agent field is the probe slug"
        )
        out.append(_seen(ctx, "bot-id-observable", f"probe bot slot present: {form}"))
        has_agent = "agent" in tally.dm_row
        out.append(
            _seen(ctx, "bot-own-session-attribution", "DM slot carries key and agent fields")
            if has_agent
            else _untested(ctx, "bot-own-session-attribution", "DM slot has no agent field")
        )
    else:
        reason = "probe slug not set" if not slug else "probe DM slot not in the snapshots"
        out.append(_untested(ctx, "bot-id-observable", reason))
        out.append(_untested(ctx, "bot-own-session-attribution", reason))
    if tally.worker_row is not None:
        minted = tally.worker_row.get("lineage_minted")
        out.append(
            _seen(
                ctx,
                "bot-worker-session-attribution",
                f"created_by chain reaches the probe bot; lineage_minted={minted}",
            )
        )
    else:
        out.append(
            _untested(ctx, "bot-worker-session-attribution", "no probe worker slot observed")
        )
    out.extend(_window_cells(ctx, tally))
    return out


async def _ws_capture(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    tally = _FeedTally(window_start=ctx.now())
    try:
        async with asyncio.timeout(ctx.capture_seconds):
            await _drain_feed(port, ctx, tally)
    except TimeoutError:
        pass
    except FeedRejected as rejected:
        denied = Observation(
            "app-owned-ws-token-transport",
            "APP-TOKEN",
            ctx.now(),
            _ref(ctx, "ws-capture"),
            f"feed handshake refused with {rejected.status}",
            status=rejected.status,
            body_shape="error",
        )
        reason = f"feed handshake refused with {rejected.status}"
        return [denied, *(_untested(ctx, cell, reason) for cell in WS_CELLS[1:])]
    return _feed_observations(ctx, port, tally)


def _usage_keys(value: object, depth: int = 0) -> set[str]:
    """Which of PER_BOT_KEYS appear as a field name, or as a `_`-separated part of one, within
    MAX_USAGE_KEY_DEPTH levels. Only those canonical words come back, never a raw key."""
    if depth > MAX_USAGE_KEY_DEPTH:
        return set()
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            found |= PER_BOT_KEYS & set(str(key).lower().replace("-", "_").split("_"))
            found |= _usage_keys(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            found |= _usage_keys(child, depth + 1)
    return found


async def _usage_endpoints(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    """Exactly one GET to each usage path the grants allow; never a child path or a POST (a
    child path can trigger a credit re-read). The bodies carry the OS username and billing data,
    so only field names are recorded."""
    out: list[Observation] = []
    answered: list[tuple[str, object]] = []
    for cell_id, path in (
        ("usage-api-app-token", USAGE_PATH),
        ("sessions-usage-api-app-token", SESSIONS_USAGE_PATH),
    ):
        if not ctx.grants.has_api(path):
            out.append(_untested(ctx, cell_id, f"no {path} grant declared"))
            continue
        status, body = await port.http("GET", path)
        out.append(_http_observation(ctx, "usage-endpoints", cell_id, "GET", path, status, body))
        parsed = _parse(body)
        if 200 <= status < 300 and isinstance(parsed, dict | list):
            answered.append((path, parsed))
    kept = ctx.run.events.rows_kept
    seen = (
        f"capture so far: context_usage rows {kept.get('context_usage', 0)}, "
        f"subagent_done rows {kept.get('subagent_done', 0)}"
    )
    cell = "bot-token-usage-per-bot"
    if not answered:
        out.append(_untested(ctx, cell, f"no usage endpoint answered with a body; {seen}"))
        return out
    found = sorted(set().union(*(_usage_keys(parsed) for _, parsed in answered)))
    if not found:
        shapes = "; ".join(f"{path} {describe(parsed)}" for path, parsed in answered)
        out.append(_untested(ctx, cell, f"no per-slot or per-bot field names: {shapes}; {seen}"))
        return out
    paths = ", ".join(path for path, _ in answered)
    excerpt = (
        f"{paths}: per-slot or per-bot field names present ({', '.join(found)}); what the "
        f"figures mean is not concluded here; {seen}"
    )
    out.append(
        Observation(
            cell, "APP-TOKEN", ctx.now(), _ref(ctx, "usage-endpoints"), excerpt, state="ALLOWED"
        )
    )
    return out


def _member_record_path(slug: str) -> str:
    return f"/api/member-records/{quote(slug, safe='')}"


async def _member_record_write(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    cell = "bot-dashboard-member-record"
    slug = ctx.run.probe_slug
    if not slug:
        return [_untested(ctx, cell, "probe slug not set")]
    path = _member_record_path(slug)
    if not ctx.grants.has_api(path):
        return [_untested(ctx, cell, "no member-records grant declared; see phase v1")]
    payload = json.dumps({"source": "specter-probe", "at": ctx.now()}).encode()
    status, body = await port.http("POST", path, payload)
    observation = _http_observation(
        ctx, "member-record-write", cell, "POST", path, status, body, any_2xx=True
    )
    return [observation]


async def _member_record_ungranted(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    cell = "bot-dashboard-record-ungranted"
    slug = ctx.run.probe_slug
    if not slug:
        return [_untested(ctx, cell, "probe slug not set")]
    path = _member_record_path(slug)
    if ctx.grants.has_api(path):
        return [
            _untested(ctx, cell, "a member-records grant is declared; the refusal is probed in v0")
        ]
    payload = json.dumps({"source": "specter-probe", "at": ctx.now()}).encode()
    status, body = await port.http("POST", path, payload)
    return [_http_observation(ctx, "member-record-ungranted", cell, "POST", path, status, body)]


def _slot_keys(parsed: object) -> set[str]:
    return {str(row["key"]) for row in _roster_rows(parsed) if isinstance(row.get("key"), str)}


async def _cli_compare(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    cell = "external-cli-slot-appears"
    cli_key = ctx.cli_slot_key
    if not cli_key:
        return [_untested(ctx, cell, "no external CLI slot key supplied")]
    hidden = digest(ctx.run.salt, cli_key)
    found = []
    if any(row.get("key") == hidden for frame in ctx.run.frames for row in frame_rows(frame)):
        found.append("the feed snapshot")
    api_granted = ctx.grants.has_api(CHAT_SLOTS_PATH)
    if api_granted:
        _, body = await port.http("GET", CHAT_SLOTS_PATH)
        if cli_key in _slot_keys(_parse(body)):
            found.append(f"GET {CHAT_SLOTS_PATH}")
    if not found:
        where = (
            "the feed or the API" if api_granted else f"the feed ({CHAT_SLOTS_PATH} not granted)"
        )
        return [_untested(ctx, cell, f"the external CLI slot was not seen in {where}")]
    return [_seen(ctx, cell, f"external CLI slot present in {' and '.join(found)}")]


STEPS: tuple[Step, ...] = (
    Step("token-exchange", ("app-owned-token-exchange",), _token_exchange),
    Step("own-proxy-unauth", ("app-owned-unsigned-direct-rejected",), _own_proxy_unauth),
    Step("other-app-proxy", ("other-app-proxy-denied",), _other_app_proxy),
    Step(
        "deny-matrix",
        (
            "other-app-api-denied",
            "bot-list-members-denied",
            "bot-ledger-read",
            "bot-goals-read",
            "bot-key-results-read",
            "bot-activity-read",
            "bot-notes-memory-private",
        ),
        _deny_matrix,
    ),
    Step("agents-roster", ("bot-list-via-agents", "bot-name-avatar"), _agents_roster),
    Step(
        "usage-endpoints",
        ("usage-api-app-token", "sessions-usage-api-app-token", "bot-token-usage-per-bot"),
        _usage_endpoints,
    ),
    Step("chat-slots", ("user-chat-slots-api", "user-chat-slot-history"), _chat_slots),
    Step("ws-capture", WS_CELLS, _ws_capture),
    Step("member-record-write", ("bot-dashboard-member-record",), _member_record_write),
    Step("member-record-ungranted", ("bot-dashboard-record-ungranted",), _member_record_ungranted),
    Step("cli-compare", ("external-cli-slot-appears",), _cli_compare),
)

STEP_IDS = tuple(step.id for step in STEPS)
# Steps whose grants the D-P1 overlay dropped: selectable by id, not part of the default run.
OPT_IN_STEP_IDS = ("chat-slots", "member-record-write", "member-record-ungranted", "cli-compare")
DEFAULT_STEP_IDS = tuple(step_id for step_id in STEP_IDS if step_id not in OPT_IN_STEP_IDS)


def select_steps(step_ids: list[str] | None) -> list[Step]:
    """Steps in canonical order, the default run when no ids are given; an unknown id raises
    UnknownStep."""
    if step_ids is None:
        return [step for step in STEPS if step.id in DEFAULT_STEP_IDS]
    unknown = [step_id for step_id in step_ids if step_id not in STEP_IDS]
    if unknown:
        raise UnknownStep(unknown[0])
    wanted = set(step_ids)
    return [step for step in STEPS if step.id in wanted]


def _failure_reason(error: Exception) -> str:
    if isinstance(error, TimeoutError):
        return "request timed out"
    if isinstance(error, TokenExchangeError):
        return f"token exchange failed (status {error.status})"
    return f"step failed: {type(error).__name__}"


async def execute_step(step: Step, port: GatewayPort, ctx: StepContext) -> None:
    """Run one step and store its cells. A fault becomes UNTESTED with a reason, never a guess."""
    if step.needs_gateway and not ctx.gateway_available:
        observations = [
            _untested(ctx, cell, "gateway origin unavailable (not loopback)") for cell in step.cells
        ]
    else:
        try:
            observations = await step.run(port, ctx)
        except Exception as error:
            reason = _failure_reason(error)
            observations = [_untested(ctx, cell, reason) for cell in step.cells]
    for observation in observations:
        apply_observation(ctx.run, observation)


async def run_steps(port: GatewayPort, ctx: StepContext, step_ids: list[str] | None = None) -> None:
    for step in select_steps(step_ids):
        await execute_step(step, port, ctx)
