# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Protocol
from urllib.parse import quote

from .frames import Attempt, AttemptKind, Row, diff_slots, outcome_evidence, probe_keys, slot_role
from .frames import slot_rows as frame_rows
from .matrix import (
    DENIAL_STATUSES,
    BodyShape,
    Observation,
    Run,
    apply_observation,
)
from .sanitise import digest, redact_text, sanitise_frame

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

# A path outside the grant set the overlay declares (agents, chat slots, member records).
UNGRANTED_PATH = "/api/config"
ERROR_KEYS = ("error", "detail", "message", "reason")
MAX_LISTED_KEYS = 20
REASON_KEYS = ("code", "error")
MAX_REASON_CHARS = 200


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


@dataclass
class StepContext:
    run: Run
    now: Callable[[], str]
    grants_declared: bool = True
    gateway_available: bool = True
    other_app: str = "specter-other"
    cli_slot_key: str = ""
    capture_seconds: float = 30.0
    max_frames: int = 200


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
    path = "/api/chat/slots"
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


def _absorb_frame(frame: dict[str, object], ctx: StepContext, tally: _FeedTally) -> None:
    run = ctx.run
    clean = sanitise_frame(frame, run.probe_slug, run.salt, run.stats)
    if clean is None:
        return
    run.record_frame(clean)
    rows = [row for row in frame_rows(clean) if isinstance(row.get("key"), str)]
    if clean.get("type") == "slots":
        tally.slot_frames += 1
        tally.most_rows = max(tally.most_rows, len(rows))
        if tally.first_slot_rows is None:
            tally.first_slot_rows = len(rows)
    probes = probe_keys(rows, run.probe_slug)
    current = {str(row["key"]): row for row in rows if row["key"] in probes}
    at = ctx.now()
    for signal in diff_slots(run.last_rows, current, at=at):
        attempt = _attempt_for(run, signal.slot_key, current.get(signal.slot_key, {}))
        attempt.signals.append(signal)
        tally.signal_kinds.add(signal.kind)
        if signal.kind == "terminal":
            tally.terminal_seen = True
            text = outcome_evidence(current.get(signal.slot_key, {}))
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


async def _drain_feed(port: GatewayPort, ctx: StepContext, tally: _FeedTally) -> None:
    feed = port.open_feed()
    try:
        async for frame in feed:
            tally.frames += 1
            _absorb_frame(frame, ctx, tally)
            if tally.frames >= ctx.max_frames:
                break
    finally:
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
)


def _seen(ctx: StepContext, cell_id: str, excerpt: str) -> Observation:
    return Observation(
        cell_id, "APP-TOKEN", ctx.now(), _ref(ctx, "ws-capture"), excerpt, state="ALLOWED"
    )


def _feed_observations(ctx: StepContext, port: GatewayPort, tally: _FeedTally) -> list[Observation]:
    slug = ctx.run.probe_slug
    kinds = tally.signal_kinds
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
    if ctx.grants_declared:
        out.append(
            _untested(ctx, "user-slots-no-grant-denied", "a grant is declared; run phase v0")
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

    if not ctx.grants_declared:
        out.append(_untested(ctx, "user-slots-visible", "no slots grant declared"))
    elif tally.most_rows:
        out.append(_seen(ctx, "user-slots-visible", f"snapshots held up to {tally.most_rows} rows"))
    else:
        out.append(_untested(ctx, "user-slots-visible", window))

    for cell_id, wanted in (
        ("user-signal-start", {"start"}),
        ("user-signal-progress", {"progress"}),
        ("user-signal-terminal", {"terminal"}),
        ("user-signal-approval", {"approval", "needs-input"}),
    ):
        hit = sorted(kinds & wanted)
        out.append(
            _seen(ctx, cell_id, f"signal observed on a probe slot: {', '.join(hit)}")
            if hit
            else _untested(ctx, cell_id, "signal not observed in the capture window")
        )

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
        out.append(_seen(ctx, "bot-id-observable", f"DM slot key member-{slug} present"))
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
    return out


async def _ws_capture(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    tally = _FeedTally()
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


def _member_record_path(slug: str) -> str:
    return f"/api/member-records/{quote(slug, safe='')}"


async def _member_record_write(port: GatewayPort, ctx: StepContext) -> list[Observation]:
    cell = "bot-dashboard-member-record"
    slug = ctx.run.probe_slug
    if not slug:
        return [_untested(ctx, cell, "probe slug not set")]
    if not ctx.grants_declared:
        return [_untested(ctx, cell, "no member-records grant declared; see phase v1")]
    path = _member_record_path(slug)
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
    if ctx.grants_declared:
        return [_untested(ctx, cell, "a grant is declared; the refusal is probed in phase v0")]
    path = _member_record_path(slug)
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
    _, body = await port.http("GET", "/api/chat/slots")
    if cli_key in _slot_keys(_parse(body)):
        found.append("GET /api/chat/slots")
    if not found:
        return [_untested(ctx, cell, "the external CLI slot was not seen in the feed or the API")]
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
    Step("chat-slots", ("user-chat-slots-api", "user-chat-slot-history"), _chat_slots),
    Step("ws-capture", WS_CELLS, _ws_capture),
    Step("member-record-write", ("bot-dashboard-member-record",), _member_record_write),
    Step("member-record-ungranted", ("bot-dashboard-record-ungranted",), _member_record_ungranted),
    Step("cli-compare", ("external-cli-slot-appears",), _cli_compare),
)

STEP_IDS = tuple(step.id for step in STEPS)


def select_steps(step_ids: list[str] | None) -> list[Step]:
    """Steps in canonical order; an unknown id raises UnknownStep."""
    if step_ids is None:
        return list(STEPS)
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
