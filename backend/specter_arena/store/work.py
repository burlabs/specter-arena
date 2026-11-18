from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from . import xp
from .errors import (
    AttemptAlreadyLinked,
    AttemptNotEligible,
    AttemptsNotEnded,
    ChildrenNotAccepted,
    ContributorsFrozen,
    InvalidCursor,
    InvalidTransition,
    LimitReached,
    NoEvidence,
    ParentLocked,
    RequestReused,
    StaleEvidence,
    StoreUsageError,
    UnknownAttempt,
    UnknownBinding,
    UnknownWork,
    VersionConflict,
)
from .guard import translate_errors
from .paging import Page, build_page, clamp_limit, decode_cursor
from .store import Store
from .validate import is_time_ms
from .xp_policy import (
    BOUNTY_XP,
    MAX_ATTEMPTS_PER_WORK,
    MAX_CONDITION,
    MAX_CONTRIBUTORS,
    MAX_DEPTH,
    MAX_MILESTONE_LABEL,
    MAX_MILESTONES,
    MAX_NOTE,
    MAX_TITLE,
    POLICY_VERSION,
    split_bounty,
)

ACTOR = "app-owner"
MAX_LIST_PAGE = 25
MAX_DECISIONS_SHOWN = 50

STATES: tuple[str, ...] = (
    "open",
    "awaiting-review",
    "blocked",
    "rejected",
    "cancelled",
    "accepted",
    "reopened",
)
ACTIONS: tuple[str, ...] = (
    "submit",
    "accept",
    "reject",
    "block",
    "unblock",
    "cancel",
    "reopen",
)
# action -> (states it may start from, state it ends in). The single source for the Python side;
# the `work_decision_transition` trigger repeats it and a test compares all 49 pairs.
TRANSITIONS: Mapping[str, tuple[frozenset[str], str]] = {
    "submit": (frozenset({"open", "reopened"}), "awaiting-review"),
    "accept": (frozenset({"awaiting-review"}), "accepted"),
    "reject": (frozenset({"awaiting-review"}), "rejected"),
    "block": (frozenset({"open", "reopened", "awaiting-review"}), "blocked"),
    "unblock": (frozenset({"blocked"}), "open"),
    "cancel": (
        frozenset({"open", "awaiting-review", "blocked", "rejected", "reopened"}),
        "cancelled",
    ),
    "reopen": (frozenset({"accepted", "rejected"}), "reopened"),
}
EVIDENCE_ACTIONS = frozenset({"accept", "reject"})
BLOCKERS: tuple[str, ...] = (
    "no-evidence",
    "attempts-not-ended",
    "attempt-missing",
    "children-not-accepted",
    "wrong-state",
)

_WORK_ID = re.compile(r"wrk_[0-9a-f]{24}")
_ATTEMPT_ID = re.compile(r"att_[0-9a-f]{24}")
_BINDING_ID = re.compile(r"bnd_[0-9a-f]{24}")
_TOKEN = re.compile(r"[A-Za-z0-9_-]{8,64}")
_REVISION = re.compile(r"[0-9a-f]{24}")


@dataclass(frozen=True, slots=True)
class WorkAttemptView:
    """A linked attempt as read from the `attempt` projection now. `present` is False when the
    projection no longer holds the id; the time and signal fields are then None."""

    attempt_id: str
    binding_id: str
    kind: str
    started_ms: int | None
    ended_ms: int | None
    end_signal: str | None
    ended: bool
    present: bool


@dataclass(frozen=True, slots=True)
class WorkContributorView:
    binding_id: str
    attempt_count: int
    xp_net: int


@dataclass(frozen=True, slots=True)
class WorkMilestoneView:
    position: int
    label: str
    done_ms: int | None


@dataclass(frozen=True, slots=True)
class WorkDecisionView:
    decision_id: str
    seq: int
    action: str
    from_state: str
    to_state: str
    actor: str
    at_ms: int
    note: str | None
    evidence_revision: str | None


@dataclass(frozen=True, slots=True)
class WorkProgress:
    done: int
    total: int


@dataclass(frozen=True, slots=True)
class WorkReview:
    can_accept: bool
    blockers: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class WorkRecord:
    work_id: str
    parent_id: str | None
    title: str
    acceptance_condition: str
    rewardable: bool
    bounty_xp: int
    policy_version: str
    state: str
    version: int
    created_ms: int
    updated_ms: int
    attempts: tuple[WorkAttemptView, ...]
    contributors: tuple[WorkContributorView, ...]
    milestones: tuple[WorkMilestoneView, ...]
    progress: WorkProgress | None
    evidence_revision: str
    child_count: int
    children_accepted: int
    review: WorkReview
    decisions: tuple[WorkDecisionView, ...]


@dataclass(frozen=True, slots=True)
class CreatedWork:
    record: WorkRecord
    created: bool


@dataclass(frozen=True, slots=True)
class WorkDecisionResult:
    record: WorkRecord
    replayed: bool


@dataclass(frozen=True, slots=True)
class _Item:
    work_id: str
    parent_id: str | None
    title: str
    acceptance_condition: str
    rewardable: bool
    bounty_xp: int
    policy_version: str
    state: str
    version: int
    request_token: str
    created_ms: int
    updated_ms: int


_ITEM_COLUMNS = (
    "work_id, parent_id, title, acceptance_condition, rewardable, bounty_xp, policy_version,"
    " state, version, request_token, created_ms, updated_ms"
)


def new_work_id() -> str:
    return "wrk_" + secrets.token_hex(12)


def new_decision_id() -> str:
    return "dec_" + secrets.token_hex(12)


def _need_id(pattern: re.Pattern[str], value: object, what: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise StoreUsageError(what)
    return value


def _need_time(value: object) -> int:
    if not is_time_ms(value):
        raise StoreUsageError("time")
    assert isinstance(value, int)
    return value


def _need_version(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise StoreUsageError("expected version")
    return value


def _clean_text(
    value: object, what: str, maximum: int, *, multiline: bool = False, allow_empty: bool = False
) -> str:
    """NFC-normalised, trimmed text of 1..maximum code points. C0 controls and DEL are refused,
    except a newline where `multiline`. These are the rules the wire schemas state."""
    if not isinstance(value, str):
        raise StoreUsageError(what)
    for char in value:
        if char == "\n" and multiline:
            continue
        if ord(char) < 0x20 or char == "\x7f":
            raise StoreUsageError(what)
    cleaned = unicodedata.normalize("NFC", value).strip()
    try:
        cleaned.encode("utf-8")
    except UnicodeEncodeError:
        raise StoreUsageError(what) from None
    if len(cleaned) > maximum or (not cleaned and not allow_empty):
        raise StoreUsageError(what)
    return cleaned


def _clean_note(value: object) -> str | None:
    """A note is optional; one that is empty after trimming is stored and sent as null."""
    if value is None:
        return None
    return _clean_text(value, "note", MAX_NOTE, multiline=True, allow_empty=True) or None


EvidenceRow = list[object]


def evidence_rows(conn: sqlite3.Connection, work_id: str) -> list[EvidenceRow]:
    """`[attempt_id, binding_id, kind, started_ms, ended_ms, running, end_signal]` for each linked
    attempt as read from `attempt` now (`running` is 0 or 1). A linked attempt the projection no
    longer holds is `[attempt_id, null, null, null, null, null, null]`. Sorted by attempt id."""
    rows = conn.execute(
        "SELECT w.attempt_id, a.binding_id, a.kind, a.started_ms, a.ended_ms, a.running,"
        " a.end_signal FROM work_attempt w LEFT JOIN attempt a ON a.attempt_id = w.attempt_id"
        " WHERE w.work_id = ? ORDER BY w.attempt_id",
        (work_id,),
    ).fetchall()
    return [list(row) for row in rows]


def canonical_evidence(rows: Sequence[Sequence[object]]) -> str:
    ordered = sorted((list(r) for r in rows), key=lambda r: str(r[0]))
    return json.dumps(ordered, separators=(",", ":"), sort_keys=True, ensure_ascii=True)


def evidence_revision_of(rows: Sequence[Sequence[object]]) -> str:
    """24 hex of the sha256 of the canonical JSON of the evidence rows; `[]` hashes the empty
    list, so an item with no attempts has a fixed revision."""
    return hashlib.sha256(canonical_evidence(rows).encode("ascii")).hexdigest()[:24]


def _item(conn: sqlite3.Connection, work_id: str) -> _Item | None:
    row = conn.execute(
        f"SELECT {_ITEM_COLUMNS} FROM work_item WHERE work_id = ?", (work_id,)
    ).fetchone()
    if row is None:
        return None
    return _Item(
        row[0],
        row[1],
        row[2],
        row[3],
        bool(row[4]),
        row[5],
        row[6],
        row[7],
        row[8],
        row[9],
        row[10],
        row[11],
    )


def _need_item(conn: sqlite3.Connection, work_id: str) -> _Item:
    found = _item(conn, work_id)
    if found is None:
        raise UnknownWork
    return found


def _blockers(
    state: str,
    child_count: int,
    open_children: int,
    accepted_children: int,
    attempts: Sequence[WorkAttemptView],
) -> tuple[str, ...]:
    found: list[str] = []
    if state != "awaiting-review":
        found.append("wrong-state")
    if child_count > 0:
        if open_children > 0 or accepted_children == 0:
            found.append("children-not-accepted")
    elif not attempts:
        found.append("no-evidence")
    else:
        if any(not a.present for a in attempts):
            found.append("attempt-missing")
        if any(a.present and not a.ended for a in attempts):
            found.append("attempts-not-ended")
    return tuple(found)


def _load(conn: sqlite3.Connection, item: _Item) -> WorkRecord:
    work_id = item.work_id
    attempt_rows = conn.execute(
        "SELECT w.attempt_id, w.binding_id, w.kind, a.started_ms, a.ended_ms, a.running,"
        " a.end_signal, a.attempt_id IS NOT NULL FROM work_attempt w"
        " LEFT JOIN attempt a ON a.attempt_id = w.attempt_id WHERE w.work_id = ?"
        " ORDER BY w.rowid",
        (work_id,),
    ).fetchall()
    attempts = tuple(
        WorkAttemptView(
            attempt_id=r[0],
            binding_id=r[1],
            kind=r[2],
            started_ms=r[3],
            ended_ms=r[4],
            end_signal=r[6],
            ended=bool(r[7]) and r[5] == 0,
            present=bool(r[7]),
        )
        for r in attempt_rows
    )
    net = {
        str(b): int(total)
        for b, total in conn.execute(
            "SELECT binding_id, sum(amount) FROM xp_entry WHERE work_id = ? GROUP BY binding_id",
            (work_id,),
        )
    }
    counts: dict[str, int] = {}
    for view in attempts:
        counts[view.binding_id] = counts.get(view.binding_id, 0) + 1
    contributors = tuple(WorkContributorView(b, counts[b], net.get(b, 0)) for b in sorted(counts))
    milestones = tuple(
        WorkMilestoneView(int(p), str(label), None if done is None else int(done))
        for p, label, done in conn.execute(
            "SELECT position, label, done_ms FROM work_milestone WHERE work_id = ?"
            " ORDER BY position",
            (work_id,),
        )
    )
    progress = (
        WorkProgress(sum(1 for m in milestones if m.done_ms is not None), len(milestones))
        if milestones
        else None
    )
    child_count, open_children, accepted_children = conn.execute(
        "SELECT count(*), COALESCE(sum(state NOT IN ('accepted', 'cancelled')), 0),"
        " COALESCE(sum(state = 'accepted'), 0) FROM work_item WHERE parent_id = ?",
        (work_id,),
    ).fetchone()
    decisions = tuple(
        WorkDecisionView(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8])
        for r in reversed(
            conn.execute(
                "SELECT decision_id, seq, action, from_state, to_state, actor, at_ms, note,"
                " evidence_revision FROM work_decision WHERE work_id = ? ORDER BY seq DESC"
                " LIMIT ?",
                (work_id, MAX_DECISIONS_SHOWN),
            ).fetchall()
        )
    )
    blockers = _blockers(
        item.state, int(child_count), int(open_children), int(accepted_children), attempts
    )
    return WorkRecord(
        work_id=work_id,
        parent_id=item.parent_id,
        title=item.title,
        acceptance_condition=item.acceptance_condition,
        rewardable=item.rewardable,
        bounty_xp=item.bounty_xp,
        policy_version=item.policy_version,
        state=item.state,
        version=item.version,
        created_ms=item.created_ms,
        updated_ms=item.updated_ms,
        attempts=attempts,
        contributors=contributors,
        milestones=milestones,
        progress=progress,
        evidence_revision=evidence_revision_of(evidence_rows(conn, work_id)),
        child_count=int(child_count),
        children_accepted=int(accepted_children),
        review=WorkReview(not blockers, blockers),
        decisions=decisions,
    )


def _check_attempt(conn: sqlite3.Connection, attempt_id: str) -> tuple[str, str]:
    """`(binding_id, kind)` of an attempt a work item may take. Order of refusal: unknown id,
    wrong kind, already linked to any work item."""
    row = conn.execute(
        "SELECT binding_id, kind FROM attempt WHERE attempt_id = ?", (attempt_id,)
    ).fetchone()
    if row is None:
        raise UnknownAttempt
    if row[1] not in ("bot-turn", "worker"):
        raise AttemptNotEligible
    taken = conn.execute(
        "SELECT 1 FROM work_attempt WHERE attempt_id = ?", (attempt_id,)
    ).fetchone()
    if taken is not None:
        raise AttemptAlreadyLinked
    return str(row[0]), str(row[1])


def _insert_attempt(
    conn: sqlite3.Connection, work_id: str, attempt_id: str, binding_id: str, kind: str, at_ms: int
) -> None:
    conn.execute(
        "INSERT INTO work_attempt (attempt_id, work_id, binding_id, kind, linked_ms)"
        " VALUES (?, ?, ?, ?, ?)",
        (attempt_id, work_id, binding_id, kind, at_ms),
    )


def _depth_of(conn: sqlite3.Connection, work_id: str) -> int:
    """Levels from the root down to and including `work_id` (a root is 1)."""
    depth = 0
    cursor: str | None = work_id
    while cursor is not None:
        depth += 1
        row = conn.execute(
            "SELECT parent_id FROM work_item WHERE work_id = ?", (cursor,)
        ).fetchone()
        cursor = None if row is None else row[0]
    return depth


def _same_creation(
    conn: sqlite3.Connection,
    item: _Item,
    *,
    title: str,
    acceptance_condition: str,
    rewardable: bool,
    parent_id: str | None,
    attempt_ids: Sequence[str],
    milestones: Sequence[str],
) -> bool:
    linked = {
        str(r[0])
        for r in conn.execute(
            "SELECT attempt_id FROM work_attempt WHERE work_id = ? AND linked_ms = ?",
            (item.work_id, item.created_ms),
        )
    }
    labels = [
        str(r[0])
        for r in conn.execute(
            "SELECT label FROM work_milestone WHERE work_id = ? ORDER BY position",
            (item.work_id,),
        )
    ]
    return (
        item.title == title
        and item.acceptance_condition == acceptance_condition
        and item.rewardable == rewardable
        and item.parent_id == parent_id
        and linked == set(attempt_ids)
        and labels == list(milestones)
    )


def create_work(
    store: Store,
    *,
    request_token: str,
    title: str,
    acceptance_condition: str,
    rewardable: bool,
    parent_id: str | None,
    attempt_ids: Sequence[str],
    milestones: Sequence[str],
    now_ms: int,
) -> CreatedWork:
    """Insert a WorkItem with its attempts and milestones in one transaction, or return the
    existing item for a repeated `request_token` with identical fields (`created=False`). The
    same token with different fields raises `RequestReused`. The bounty is fixed here."""
    _need_id(_TOKEN, request_token, "request token")
    title = _clean_text(title, "title", MAX_TITLE)
    acceptance_condition = _clean_text(
        acceptance_condition, "acceptance condition", MAX_CONDITION, multiline=True
    )
    if not isinstance(rewardable, bool):
        raise StoreUsageError("rewardable")
    if parent_id is not None:
        _need_id(_WORK_ID, parent_id, "parent id")
    _need_time(now_ms)
    if isinstance(attempt_ids, str) or isinstance(milestones, str):
        raise StoreUsageError("sequence")
    ids = [_need_id(_ATTEMPT_ID, a, "attempt id") for a in attempt_ids]
    if len(set(ids)) != len(ids):
        raise StoreUsageError("duplicate attempt id")
    labels = [_clean_text(m, "milestone", MAX_MILESTONE_LABEL) for m in milestones]
    if len(ids) > MAX_ATTEMPTS_PER_WORK or len(labels) > MAX_MILESTONES:
        raise LimitReached
    with translate_errors(), store.write() as conn:
        existing = conn.execute(
            f"SELECT {_ITEM_COLUMNS} FROM work_item WHERE request_token = ?", (request_token,)
        ).fetchone()
        if existing is not None:
            found = _item(conn, str(existing[0]))
            assert found is not None
            if not _same_creation(
                conn,
                found,
                title=title,
                acceptance_condition=acceptance_condition,
                rewardable=rewardable,
                parent_id=parent_id,
                attempt_ids=ids,
                milestones=labels,
            ):
                raise RequestReused
            return CreatedWork(_load(conn, found), False)
        if parent_id is not None:
            parent = _need_item(conn, parent_id)
            locked = conn.execute(
                "SELECT 1 FROM xp_entry WHERE work_id = ? LIMIT 1", (parent_id,)
            ).fetchone()
            if locked is not None or parent.state in ("accepted", "cancelled"):
                raise ParentLocked
            if _depth_of(conn, parent_id) >= MAX_DEPTH:
                raise LimitReached
        resolved = [(a, *_check_attempt(conn, a)) for a in ids]
        if len({binding for _, binding, _ in resolved}) > MAX_CONTRIBUTORS:
            raise LimitReached
        work_id = new_work_id()
        conn.execute(
            f"INSERT INTO work_item ({_ITEM_COLUMNS})"
            " VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?, ?)",
            (
                work_id,
                parent_id,
                title,
                acceptance_condition,
                int(rewardable),
                BOUNTY_XP if rewardable else 0,
                POLICY_VERSION,
                request_token,
                now_ms,
                now_ms,
            ),
        )
        for attempt_id, binding_id, kind in resolved:
            _insert_attempt(conn, work_id, attempt_id, binding_id, kind, now_ms)
        for position, label in enumerate(labels, start=1):
            conn.execute(
                "INSERT INTO work_milestone (work_id, position, label) VALUES (?, ?, ?)",
                (work_id, position, label),
            )
        return CreatedWork(_load(conn, _need_item(conn, work_id)), True)


def _bump(conn: sqlite3.Connection, item: _Item, at_ms: int, state: str | None = None) -> None:
    conn.execute(
        "UPDATE work_item SET state = ?, version = ?, updated_ms = ? WHERE work_id = ?",
        (item.state if state is None else state, item.version + 1, at_ms, item.work_id),
    )


def link_attempt(
    store: Store, work_id: str, *, expected_version: int, attempt_id: str, now_ms: int
) -> WorkRecord:
    """Link one more attempt (a retry or another bot's attempt). Not on an accepted or cancelled
    item. Once XP exists only an existing contributor's attempts may be linked."""
    _need_id(_WORK_ID, work_id, "work id")
    _need_id(_ATTEMPT_ID, attempt_id, "attempt id")
    expected = _need_version(expected_version)
    _need_time(now_ms)
    with translate_errors(), store.write() as conn:
        item = _need_item(conn, work_id)
        if item.version != expected:
            raise VersionConflict(item.version)
        if item.state in ("accepted", "cancelled"):
            raise InvalidTransition
        binding_id, kind = _check_attempt(conn, attempt_id)
        held = {
            str(r[0])
            for r in conn.execute(
                "SELECT DISTINCT binding_id FROM work_attempt WHERE work_id = ?", (work_id,)
            )
        }
        total = conn.execute(
            "SELECT count(*) FROM work_attempt WHERE work_id = ?", (work_id,)
        ).fetchone()[0]
        if total >= MAX_ATTEMPTS_PER_WORK or (
            binding_id not in held and len(held) >= MAX_CONTRIBUTORS
        ):
            raise LimitReached
        frozen = conn.execute(
            "SELECT 1 FROM xp_entry WHERE work_id = ? LIMIT 1", (work_id,)
        ).fetchone()
        if frozen is not None and binding_id not in {
            str(r[0])
            for r in conn.execute("SELECT binding_id FROM xp_entry WHERE work_id = ?", (work_id,))
        }:
            raise ContributorsFrozen
        at = max(now_ms, item.updated_ms)
        _insert_attempt(conn, work_id, attempt_id, binding_id, kind, at)
        _bump(conn, item, at)
        return _load(conn, _need_item(conn, work_id))


def set_milestone(
    store: Store, work_id: str, *, expected_version: int, position: int, done: bool, now_ms: int
) -> WorkRecord:
    """Mark a milestone done or not done. Setting it to the value it already has changes nothing
    and does not advance `version`. Not on a cancelled item."""
    _need_id(_WORK_ID, work_id, "work id")
    expected = _need_version(expected_version)
    if isinstance(position, bool) or not isinstance(position, int):
        raise StoreUsageError("position")
    if not isinstance(done, bool):
        raise StoreUsageError("done")
    _need_time(now_ms)
    with translate_errors(), store.write() as conn:
        item = _need_item(conn, work_id)
        if item.version != expected:
            raise VersionConflict(item.version)
        row = conn.execute(
            "SELECT done_ms FROM work_milestone WHERE work_id = ? AND position = ?",
            (work_id, position),
        ).fetchone()
        if row is None:
            raise StoreUsageError("unknown milestone position")
        if item.state == "cancelled":
            raise InvalidTransition
        if (row[0] is not None) != done:
            at = max(now_ms, item.updated_ms)
            conn.execute(
                "UPDATE work_milestone SET done_ms = ? WHERE work_id = ? AND position = ?",
                (at if done else None, work_id, position),
            )
            _bump(conn, item, at)
            item = _need_item(conn, work_id)
        return _load(conn, item)


def decide_work(
    store: Store,
    work_id: str,
    *,
    action: str,
    expected_version: int,
    request_token: str,
    evidence_revision: str | None,
    note: str | None,
    now_ms: int,
) -> WorkDecisionResult:
    """Apply one human decision. Refusals, in order: `UnknownWork`; a replayed token returns the
    recorded result (`RequestReused` if its action, evidence or note differ); `VersionConflict`;
    `InvalidTransition`; for accept and reject `StaleEvidence`; for accept `NoEvidence`,
    `ChildrenNotAccepted` or `AttemptsNotEnded`. A refusal writes nothing. The decision row, the
    new state and version, and every XP entry commit in one transaction."""
    _need_id(_WORK_ID, work_id, "work id")
    if action not in TRANSITIONS:
        raise StoreUsageError("action")
    expected = _need_version(expected_version)
    _need_id(_TOKEN, request_token, "request token")
    cleaned_note = _clean_note(note)
    if evidence_revision is not None:
        _need_id(_REVISION, evidence_revision, "evidence revision")
        if action not in EVIDENCE_ACTIONS:
            raise StoreUsageError("evidence revision only applies to accept and reject")
    _need_time(now_ms)
    allowed_from, to_state = TRANSITIONS[action]
    with translate_errors(), store.write() as conn:
        item = _need_item(conn, work_id)
        prior = conn.execute(
            "SELECT action, evidence_revision, note FROM work_decision"
            " WHERE work_id = ? AND request_token = ?",
            (work_id, request_token),
        ).fetchone()
        if prior is not None:
            if (prior[0], prior[1], prior[2]) != (action, evidence_revision, cleaned_note):
                raise RequestReused
            return WorkDecisionResult(_load(conn, item), True)
        if item.version != expected:
            raise VersionConflict(item.version)
        if item.state not in allowed_from:
            raise InvalidTransition
        rows = evidence_rows(conn, work_id)
        revision = evidence_revision_of(rows)
        if action in EVIDENCE_ACTIONS and evidence_revision != revision:
            raise StaleEvidence
        child_count, open_children, accepted_children = conn.execute(
            "SELECT count(*), COALESCE(sum(state NOT IN ('accepted', 'cancelled')), 0),"
            " COALESCE(sum(state = 'accepted'), 0) FROM work_item WHERE parent_id = ?",
            (work_id,),
        ).fetchone()
        if action == "accept":
            if child_count > 0:
                if open_children > 0 or accepted_children == 0:
                    raise ChildrenNotAccepted
            elif not rows:
                raise NoEvidence
            elif any(r[2] is None or r[5] != 0 for r in rows):
                raise AttemptsNotEnded
        at = max(now_ms, item.updated_ms)
        seq = int(
            conn.execute(
                "SELECT COALESCE(max(seq), 0) + 1 FROM work_decision WHERE work_id = ?", (work_id,)
            ).fetchone()[0]
        )
        decision_id = new_decision_id()
        with_evidence = action in EVIDENCE_ACTIONS
        conn.execute(
            "INSERT INTO work_decision (decision_id, work_id, seq, action, from_state, to_state,"
            " actor, at_ms, note, evidence_revision, evidence_json, request_token)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                decision_id,
                work_id,
                seq,
                action,
                item.state,
                to_state,
                ACTOR,
                at,
                cleaned_note,
                revision if with_evidence else None,
                canonical_evidence(rows) if with_evidence else None,
                request_token,
            ),
        )
        _bump(conn, item, at, to_state)
        if action == "accept" and child_count == 0 and item.rewardable:
            _write_accept_xp(conn, item, decision_id, at)
        elif action == "reopen" and item.state == "accepted":
            xp.write_corrections(conn, work_id=work_id, decision_id=decision_id, at_ms=at)
        return WorkDecisionResult(_load(conn, _need_item(conn, work_id)), False)


def _write_accept_xp(conn: sqlite3.Connection, item: _Item, decision_id: str, at_ms: int) -> None:
    if xp.has_awards(conn, item.work_id):
        xp.write_reinstatements(conn, work_id=item.work_id, decision_id=decision_id, at_ms=at_ms)
        return
    contributors = [
        str(r[0])
        for r in conn.execute(
            "SELECT DISTINCT binding_id FROM work_attempt WHERE work_id = ? ORDER BY binding_id",
            (item.work_id,),
        )
    ]
    shares = split_bounty(item.bounty_xp, contributors)
    xp.write_awards(conn, work_id=item.work_id, decision_id=decision_id, shares=shares, at_ms=at_ms)


def get_work(store: Store, work_id: str) -> WorkRecord:
    """One WorkItem with its attempts as they read now. Raises `UnknownWork`."""
    _need_id(_WORK_ID, work_id, "work id")
    with translate_errors(), store.read() as conn:
        return _load(conn, _need_item(conn, work_id))


def _after(cursor: str | None) -> tuple[int | None, str | None]:
    if cursor is None:
        return None, None
    created_ms, work_id = decode_cursor(cursor, 2)
    if (
        not isinstance(created_ms, int)
        or created_ms < 0
        or not isinstance(work_id, str)
        or _WORK_ID.fullmatch(work_id) is None
    ):
        raise InvalidCursor
    return created_ms, work_id


_LIST_SQL = f"""
SELECT {_ITEM_COLUMNS} FROM work_item w
WHERE (:state IS NULL OR w.state = :state)
  AND (:binding IS NULL OR EXISTS (
        SELECT 1 FROM work_attempt a WHERE a.work_id = w.work_id AND a.binding_id = :binding))
  AND (:after_ms IS NULL OR w.created_ms < :after_ms
       OR (w.created_ms = :after_ms AND w.work_id < :after_id))
ORDER BY w.created_ms DESC, w.work_id DESC
LIMIT :n
"""


def list_work(
    store: Store,
    *,
    state: str | None,
    binding_id: str | None,
    cursor: str | None,
    limit: int | None,
) -> Page[WorkRecord]:
    """WorkItems newest first, 25 a page at most; filter by state or by a binding."""
    if state is not None and state not in STATES:
        raise StoreUsageError("state")
    if binding_id is not None:
        _need_id(_BINDING_ID, binding_id, "binding id")
    size = clamp_limit(limit, default=MAX_LIST_PAGE, maximum=MAX_LIST_PAGE)
    after_ms, after_id = _after(cursor)
    with translate_errors(), store.read() as conn:
        if binding_id is not None and (
            conn.execute("SELECT 1 FROM bot_binding WHERE binding_id = ?", (binding_id,)).fetchone()
            is None
        ):
            raise UnknownBinding
        fetched = conn.execute(
            _LIST_SQL,
            {
                "state": state,
                "binding": binding_id,
                "after_ms": after_ms,
                "after_id": after_id,
                "n": size + 1,
            },
        ).fetchall()
        records = [
            _load(
                conn,
                _Item(
                    r[0], r[1], r[2], r[3], bool(r[4]), r[5], r[6], r[7], r[8], r[9], r[10], r[11]
                ),
            )
            for r in fetched
        ]
    return build_page(records, size, lambda rec: (rec.created_ms, rec.work_id))
