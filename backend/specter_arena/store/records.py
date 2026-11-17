from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal

ItemKind = Literal["binding", "roster", "observation", "coverage", "quarantine"]
Outcome = Literal["persisted", "deduplicated", "quarantined", "rejected"]
Origin = Literal["live", "recorded", "fixture"]
ObsKind = Literal["row-change", "event"]
PayloadValue = bool | int | str
CoverageAction = Literal["open-covered", "close", "gap"]
Presence = Literal["present", "absent", "unknown"]

ITEM_KINDS: tuple[ItemKind, ...] = ("binding", "roster", "observation", "coverage", "quarantine")

MAX_BATCH_ITEMS = 100
MAX_PAYLOAD_BYTES = 65_536
MAX_PAYLOAD_VALUE_CHARS = 128
MAX_ROSTER_ROWS = 200
MAX_NAME_CHARS = 128
HEARTBEAT_STALE_MS = 30_000

EVENT_TYPES = frozenset({"chat_done", "chat_status", "context_usage", "tool_call", "tool_result"})

MAX_JSON_INT = 2**53 - 1
MAX_COUNT = 2**31
MAX_QUARANTINE_COUNT = 2**31 - 1
MAX_SLOT_KEY_CHARS = 256

# Value kinds follow observation.v1: "bool", "int" (0..MAX_JSON_INT), "token"
# (^[a-z][a-z0-9_-]{0,47}$), "hex" (^[0-9a-f]{1,16}$) and "slot" (^[A-Za-z0-9_.:-]{1,256}$).
# A key outside the table, or a value of the wrong kind, is `payload-shape`.
ROW_FACT_KEYS: Mapping[str, str] = {
    "slotMode": "token",
    "slotOrigin": "token",
    "running": "bool",
    "turn": "int",
    "turnGen": "hex",
    "lastActivityMs": "int",
    "createdMs": "int",
    "createdBy": "slot",
    "lineageMinted": "bool",
    "parentKey": "slot",
    "pendingApproval": "bool",
    "needsInput": "bool",
    "hasOptions": "bool",
    "waitingForInput": "bool",
    "interrupted": "bool",
    "stopping": "bool",
    "admissionQueued": "bool",
    "compacting": "bool",
    "waitStatePresent": "bool",
    "queueDepth": "int",
    "subagentsRunning": "int",
    "subagentsQueued": "int",
    "stopState": "token",
}
ROW_REQUIRED_KEYS = frozenset({"running"})

EVENT_PAYLOAD_KEYS: Mapping[str, Mapping[str, str]] = {
    "chat_done": {"continuing": "bool", "needsInput": "bool"},
    "chat_status": {},
    "context_usage": {"usedTokens": "int", "windowTokens": "int"},
    "tool_call": {"isShell": "bool"},
    "tool_result": {},
}

ROW_EVENT_TYPE = "slot-row"
OBSERVATION_SOURCE = "crew-ws"
ORIGINS = frozenset({"live", "recorded", "fixture"})

REJECT_REASONS = frozenset(
    {
        "wrong-installation",
        "unknown-binding",
        "binding-mismatch",
        "store-less-bot",
        "bad-dm-key",
        "ambiguous-store",
        "bad-field",
        "bad-origin",
        "bad-dedup",
        "unknown-event-type",
        "payload-shape",
        "payload-too-large",
        "worker-not-attributable",
        "bad-roster-row",
        "bad-reason",
        "bad-coverage-mark",
        "unknown-run",
        "constraint",
    }
)

COVERAGE_REASONS = frozenset(
    {
        "restart",
        "disconnect",
        "auth-stopped",
        "app-disabled",
        "scope-lost-or-silent",
        "overflow",
        "store-unavailable",
        "paused",
        "source-restart",
        "roster-unavailable",
        "feed-absent",
        "no-slot-yet",
        "unsupported-store-less-bot",
        "unobserved-turns",
    }
)


@dataclass(frozen=True, slots=True)
class DmKey:
    member_id: str
    memory_store: str


@dataclass(frozen=True, slots=True)
class BindingSeen:
    key: DmKey
    seen_at_ms: int
    source_time_ms: int | None = None


@dataclass(frozen=True, slots=True)
class RosterRowIn:
    memory_store: str
    name: str
    display_name: str | None
    avatar_kind: str | None
    avatar_ref: str | None


@dataclass(frozen=True, slots=True)
class RosterPoll:
    success: bool
    polled_at_ms: int
    rows: tuple[RosterRowIn, ...] = ()
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class ObservationIn:
    installation_id: str
    dm_key: str
    slot_key: str
    kind: ObsKind
    event_type: str
    received_at_ms: int
    payload: Mapping[str, PayloadValue]
    source: str = "crew-ws"
    origin: Origin = "live"
    contract_version: int = 1
    source_time_ms: int | None = None
    turn: int | None = None
    turn_gen: str | None = None
    tool_call_id: str | None = None
    dedup_key: str | None = None
    fact_digest: str | None = None
    binding_id: str | None = None


@dataclass(frozen=True, slots=True)
class CoverageMark:
    action: CoverageAction
    at_ms: int
    reason: str | None = None
    from_ms: int | None = None
    dropped: Mapping[str, int] = field(default_factory=dict)
    source_from_ms: int | None = None
    source_to_ms: int | None = None


@dataclass(frozen=True, slots=True)
class QuarantineIn:
    received_at_ms: int
    reason: str
    frame_type: str
    size_bytes: int
    digest: str | None = None
    count: int = 1
    first_received_at_ms: int | None = None


IngestItem = BindingSeen | RosterPoll | ObservationIn | CoverageMark | QuarantineIn


@dataclass(frozen=True, slots=True)
class IngestBatch:
    run_id: str
    installation_id: str
    items: tuple[IngestItem, ...]


@dataclass(frozen=True, slots=True)
class OutcomeCounts:
    persisted: int = 0
    deduplicated: int = 0
    quarantined: int = 0
    rejected: int = 0


@dataclass(frozen=True, slots=True)
class Rejection:
    index: int
    kind: ItemKind
    reason: str


@dataclass(frozen=True, slots=True)
class BindingRef:
    binding_id: str
    binding_seq: int
    dm_key: str
    memory_store: str
    created: bool


@dataclass(frozen=True, slots=True)
class IngestResult:
    counts: Mapping[ItemKind, OutcomeCounts]
    rejections: tuple[Rejection, ...]
    bindings: tuple[BindingRef, ...]
    roster_unmatched: int
    last_seq: int | None


@dataclass(frozen=True, slots=True)
class KnownBinding:
    binding_id: str
    binding_seq: int
    dm_key: str
    member_id: str
    memory_store: str
    last_turn: int | None
    last_turn_gen: str | None


@dataclass(frozen=True, slots=True)
class RunStart:
    installation_id: str
    run_id: str
    bindings: tuple[KnownBinding, ...]
    last_turn_gen: str | None
    paused: bool
    recovered_runs: int
    previous_ended_ms: int | None


@dataclass(frozen=True, slots=True)
class BotFacts:
    running: bool | None
    turn: int | None
    turn_gen: str | None
    pending_approval: bool | None
    needs_input: bool | None
    has_options: bool | None
    waiting_for_input: bool | None
    interrupted: bool | None
    last_activity_ms: int | None
    row_observed_ms: int | None
    event_observed_ms: int | None


@dataclass(frozen=True, slots=True)
class CoverageView:
    state: Literal["covered", "gap", "unknown"]
    reason: str | None
    since_ms: int | None
    open_gap_count: int


@dataclass(frozen=True, slots=True)
class RosterRow:
    binding_id: str
    binding_seq: int
    display_name: str | None
    name: str | None
    avatar_kind: str | None
    avatar_ref: str | None
    presence: Presence
    presence_since_ms: int | None
    facts: BotFacts | None
    coverage: CoverageView
    last_observed_ms: int | None
    workers_running: int
    workers_seen: int
    workers_unknown: int


@dataclass(frozen=True, slots=True)
class RebuildReport:
    as_of_ms: int
    observations_folded: int
    bot_states: int
    attempts: int
    last_seq: int | None


@dataclass(frozen=True, slots=True)
class BindingRecord:
    binding_id: str
    installation_id: str
    member_id: str
    memory_store: str
    display_name: str | None
    presence: Presence
    created_at_ms: int
    last_seen_ms: int | None


@dataclass(frozen=True, slots=True)
class QuarantineRecord:
    installation_id: str
    reason: str
    frame_type: str
    size_bytes: int
    digest: str | None
    count: int
    first_received_at_ms: int
    received_at_ms: int
