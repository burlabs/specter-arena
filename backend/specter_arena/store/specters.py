from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from .errors import (
    BudgetExhausted,
    GenerationInFlight,
    NotReady,
    StoreUsageError,
    UnknownAsset,
    UnknownBinding,
    UnknownRequest,
    UnknownSpecter,
    VersionConflict,
)
from .guard import translate_errors
from .paging import Page, build_page, clamp_limit, decode_cursor
from .store import Store
from .validate import is_time_ms

RequestStatus = Literal[
    "queued", "running", "ready", "failed", "cancelled", "accepted", "superseded"
]
Change = Literal["generated", "manual", "renamed", "portrait", "archived"]
ProfileSource = Literal["generated", "manual"]
AssetOrigin = Literal["bundled", "uploaded"]

SUMMONING_TAG = "summoning"
PROFILE_CONTRACT_VERSION = 1
# The eight prose fields of specter-profile.v1 (SC6-3). `contractVersion` is the ninth key.
PROFILE_FIELDS: tuple[str, ...] = (
    "name",
    "epithet",
    "personality",
    "appearance",
    "mannerism",
    "signatureAction",
    "assignmentRationale",
    "artBrief",
)
NULLABLE_FIELDS = frozenset({"epithet", "signatureAction"})
MAX_PROFILE_BYTES = 16_384
MAX_LISTED_SPECTERS = 500
MAX_LISTED_ASSETS = 200
MAX_REVISIONS_PAGE = 200
DEFAULT_REVISIONS_PAGE = 50
MAX_ATTEMPTS = 8
MAX_MODEL_LABEL_CHARS = 64
MAX_ASSET_BYTES = 1_048_576
MAX_ASSET_SIDE = 1024
MAX_ASSET_LABEL_CHARS = 80
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

_BINDING_ID = re.compile(r"bnd_[0-9a-f]{24}")
_REQUEST_ID = re.compile(r"req_[0-9a-f]{24}")
_SPECTER_ID = re.compile(r"spc_[0-9a-f]{24}")
_ASSET_ID = re.compile(r"ast_[0-9a-f]{24}")
_ERROR_CODE = re.compile(r"[a-z0-9_-]{1,40}")
_PROMPT_VERSION = re.compile(r"[A-Za-z0-9._-]{1,32}")
_ORIGINS = ("bundled", "uploaded")


@dataclass(frozen=True, slots=True)
class AssetRecord:
    """Asset metadata; `data` is the PNG bytes only when the caller asked for them."""

    asset_id: str
    sha256: str
    media_type: str
    width: int
    height: int
    byte_length: int
    origin: AssetOrigin
    label: str
    created_ms: int
    data: bytes | None


@dataclass(frozen=True, slots=True)
class SpecterRecord:
    """The active Specter: the newest revision's profile and portrait (metadata only)."""

    specter_id: str
    binding_id: str
    version: int
    profile: Mapping[str, object]
    portrait: AssetRecord | None
    source: ProfileSource
    prompt_version: str | None
    created_ms: int
    updated_ms: int


@dataclass(frozen=True, slots=True)
class RevisionRecord:
    specter_id: str
    revision_no: int
    change: Change
    profile: Mapping[str, object]
    asset_id: str | None
    source: ProfileSource
    request_id: str | None
    prompt_version: str | None
    created_ms: int


@dataclass(frozen=True, slots=True)
class RequestRecord:
    request_id: str
    binding_id: str
    status: RequestStatus
    keep: tuple[str, ...]
    prompt_version: str
    model_label: str | None
    candidate: Mapping[str, object] | None
    error_code: str | None
    attempts: int
    created_ms: int
    started_ms: int | None
    finished_ms: int | None


@dataclass(frozen=True, slots=True)
class CreatedRequest:
    record: RequestRecord
    created: bool


@dataclass(frozen=True, slots=True)
class Budget:
    binding_remaining: int
    binding_limit: int
    install_remaining: int
    install_limit: int
    window_ms: int


@dataclass(frozen=True, slots=True)
class WindowUsage:
    """Requests that reached `running` in the window: the install total and the count per binding
    (a binding with none is absent)."""

    install_used: int
    by_binding: Mapping[str, int]


@dataclass(frozen=True, slots=True)
class InsertedAsset:
    record: AssetRecord
    created: bool


def new_specter_id() -> str:
    return "spc_" + secrets.token_hex(12)


# --- validation helpers ------------------------------------------------------------------------


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
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise StoreUsageError("expected version")
    return value


def _need_limit(value: object, what: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise StoreUsageError(what)
    return value


def _check_profile(profile: Mapping[str, object]) -> dict[str, object]:
    """Shape only: the exact key set and value types. Text rules belong to specter-identity."""
    expected = {"contractVersion", *PROFILE_FIELDS}
    if not isinstance(profile, Mapping) or set(profile) != expected:
        raise StoreUsageError("profile shape")
    version = profile["contractVersion"]
    if isinstance(version, bool) or version != PROFILE_CONTRACT_VERSION:
        raise StoreUsageError("profile shape")
    for field in PROFILE_FIELDS:
        value = profile[field]
        if value is None and field in NULLABLE_FIELDS:
            continue
        if not isinstance(value, str):
            raise StoreUsageError("profile shape")
    return dict(profile)


def _dump(value: object) -> str:
    text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    try:
        size = len(text.encode("utf-8"))
    except UnicodeEncodeError as error:
        raise StoreUsageError("profile text") from error
    if size > MAX_PROFILE_BYTES:
        raise StoreUsageError("profile too large")
    return text


def _keep_names(keep: Sequence[str]) -> list[str]:
    if isinstance(keep, str) or not all(isinstance(name, str) for name in keep):
        raise StoreUsageError("keep")
    names = sorted(set(keep))
    if any(name not in PROFILE_FIELDS for name in names):
        raise StoreUsageError("keep names a field the profile does not have")
    return names


# --- row mapping -------------------------------------------------------------------------------

_ASSET_COLUMNS = (
    "a.asset_id, a.sha256, a.media_type, a.width, a.height, a.byte_length, a.origin, a.label,"
    " a.created_ms"
)


def _asset(row: Sequence[object], data: bytes | None = None) -> AssetRecord:
    return AssetRecord(
        asset_id=str(row[0]),
        sha256=str(row[1]),
        media_type=str(row[2]),
        width=int(row[3]),  # type: ignore[call-overload]
        height=int(row[4]),  # type: ignore[call-overload]
        byte_length=int(row[5]),  # type: ignore[call-overload]
        origin="bundled" if row[6] == "bundled" else "uploaded",
        label=str(row[7]),
        created_ms=int(row[8]),  # type: ignore[call-overload]
        data=data,
    )


_SPECTER_SELECT = (
    "SELECT s.specter_id, s.binding_id, s.version, s.created_ms, s.updated_ms,"
    " r.profile_json, r.source, r.prompt_version, " + _ASSET_COLUMNS + ","
    " r.asset_id FROM specter s"
    " JOIN specter_revision r ON r.specter_id = s.specter_id AND r.revision_no = s.version"
    " LEFT JOIN asset a ON a.asset_id = r.asset_id"
)


def _specter(row: Sequence[object]) -> SpecterRecord:
    portrait = None if row[17] is None else _asset(row[8:17])
    return SpecterRecord(
        specter_id=str(row[0]),
        binding_id=str(row[1]),
        version=int(row[2]),  # type: ignore[call-overload]
        profile=json.loads(str(row[5])),
        portrait=portrait,
        source="manual" if row[6] == "manual" else "generated",
        prompt_version=None if row[7] is None else str(row[7]),
        created_ms=int(row[3]),  # type: ignore[call-overload]
        updated_ms=int(row[4]),  # type: ignore[call-overload]
    )


_REQUEST_SELECT = (
    "SELECT request_id, binding_id, status, keep_json, prompt_version, model_label,"
    " candidate_json, error_code, attempts, created_ms, started_ms, finished_ms"
    " FROM generation_request"
)


def _request_record(row: Sequence[object]) -> RequestRecord:
    return RequestRecord(
        request_id=str(row[0]),
        binding_id=str(row[1]),
        status=row[2],  # type: ignore[arg-type]
        keep=tuple(json.loads(str(row[3]))),
        prompt_version=str(row[4]),
        model_label=None if row[5] is None else str(row[5]),
        candidate=None if row[6] is None else json.loads(str(row[6])),
        error_code=None if row[7] is None else str(row[7]),
        attempts=int(row[8]),  # type: ignore[call-overload]
        created_ms=int(row[9]),  # type: ignore[call-overload]
        started_ms=None if row[10] is None else int(row[10]),  # type: ignore[call-overload]
        finished_ms=None if row[11] is None else int(row[11]),  # type: ignore[call-overload]
    )


def _request(conn: sqlite3.Connection, request_id: str) -> RequestRecord | None:
    row = conn.execute(_REQUEST_SELECT + " WHERE request_id = ?", (request_id,)).fetchone()
    return None if row is None else _request_record(row)


def _binding_exists(conn: sqlite3.Connection, binding_id: str) -> bool:
    row = conn.execute("SELECT 1 FROM bot_binding WHERE binding_id = ?", (binding_id,)).fetchone()
    return row is not None


@dataclass(frozen=True, slots=True)
class _Active:
    specter_id: str
    version: int
    created_ms: int
    updated_ms: int
    profile: dict[str, object]
    asset_id: str | None
    source: ProfileSource
    prompt_version: str | None


def _active(conn: sqlite3.Connection, binding_id: str) -> _Active | None:
    row = conn.execute(
        "SELECT s.specter_id, s.version, s.created_ms, s.updated_ms, r.profile_json, r.asset_id,"
        " r.source, r.prompt_version FROM specter s"
        " JOIN specter_revision r ON r.specter_id = s.specter_id AND r.revision_no = s.version"
        " WHERE s.binding_id = ? AND s.archived_ms IS NULL",
        (binding_id,),
    ).fetchone()
    if row is None:
        return None
    return _Active(
        specter_id=row[0],
        version=row[1],
        created_ms=row[2],
        updated_ms=row[3],
        profile=json.loads(row[4]),
        asset_id=row[5],
        source="manual" if row[6] == "manual" else "generated",
        prompt_version=row[7],
    )


def _read_specter(conn: sqlite3.Connection, specter_id: str) -> SpecterRecord:
    row = conn.execute(_SPECTER_SELECT + " WHERE s.specter_id = ?", (specter_id,)).fetchone()
    if row is None:  # cannot happen inside the transaction that just wrote it
        raise UnknownSpecter
    return _specter(row)


def _insert_revision(
    conn: sqlite3.Connection,
    *,
    specter_id: str,
    revision_no: int,
    change: Change,
    profile: Mapping[str, object],
    asset_id: str | None,
    source: ProfileSource,
    request_id: str | None,
    prompt_version: str | None,
    stamp_ms: int,
) -> None:
    conn.execute(
        "INSERT INTO specter_revision (specter_id, revision_no, change, profile_json, asset_id,"
        " source, request_id, prompt_version, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            specter_id,
            revision_no,
            change,
            _dump(profile),
            asset_id,
            source,
            request_id,
            prompt_version,
            stamp_ms,
        ),
    )


def _create_specter(
    conn: sqlite3.Connection,
    binding_id: str,
    *,
    change: Change,
    profile: Mapping[str, object],
    source: ProfileSource,
    request_id: str | None,
    prompt_version: str | None,
    now_ms: int,
) -> str:
    specter_id = new_specter_id()
    conn.execute(
        "INSERT INTO specter (specter_id, binding_id, version, created_ms, updated_ms)"
        " VALUES (?, ?, 1, ?, ?)",
        (specter_id, binding_id, now_ms, now_ms),
    )
    _insert_revision(
        conn,
        specter_id=specter_id,
        revision_no=1,
        change=change,
        profile=profile,
        asset_id=None,
        source=source,
        request_id=request_id,
        prompt_version=prompt_version,
        stamp_ms=now_ms,
    )
    return specter_id


def _advance(
    conn: sqlite3.Connection,
    active: _Active,
    *,
    change: Change,
    profile: Mapping[str, object],
    asset_id: str | None,
    source: ProfileSource,
    request_id: str | None,
    prompt_version: str | None,
    now_ms: int,
) -> int:
    """Bump `version` by exactly one and append the matching revision; returns the new version."""
    stamp = max(now_ms, active.updated_ms)
    new_version = active.version + 1
    archived = stamp if change == "archived" else None
    moved = conn.execute(
        "UPDATE specter SET version = ?, updated_ms = ?, archived_ms = ?"
        " WHERE specter_id = ? AND version = ?",
        (new_version, stamp, archived, active.specter_id, active.version),
    )
    if moved.rowcount != 1:  # unreachable under BEGIN IMMEDIATE; fail loudly if it ever happens
        raise VersionConflict(active.version)
    _insert_revision(
        conn,
        specter_id=active.specter_id,
        revision_no=new_version,
        change=change,
        profile=profile,
        asset_id=asset_id,
        source=source,
        request_id=request_id,
        prompt_version=prompt_version,
        stamp_ms=stamp,
    )
    return new_version


def _supersede_ready(conn: sqlite3.Connection, binding_id: str, except_request: str | None) -> None:
    conn.execute(
        "UPDATE generation_request SET status = 'superseded'"
        " WHERE binding_id = ? AND status = 'ready' AND request_id IS NOT ?",
        (binding_id, except_request),
    )


def _check_expected(active: _Active | None, expected_version: int) -> None:
    current = 0 if active is None else active.version
    if current != expected_version:
        raise VersionConflict(current)


# --- generation requests -----------------------------------------------------------------------


def _budget(
    conn: sqlite3.Connection,
    binding_id: str,
    now_ms: int,
    binding_limit: int,
    install_limit: int,
    window_ms: int,
) -> Budget:
    cutoff = now_ms - window_ms
    per_binding, per_install = conn.execute(
        "SELECT"
        " (SELECT count(*) FROM generation_request WHERE binding_id = ?"
        "   AND started_ms IS NOT NULL AND started_ms > ?),"
        " (SELECT count(*) FROM generation_request"
        "   WHERE started_ms IS NOT NULL AND started_ms > ?)",
        (binding_id, cutoff, cutoff),
    ).fetchone()
    return Budget(
        binding_remaining=max(binding_limit - per_binding, 0),
        binding_limit=binding_limit,
        install_remaining=max(install_limit - per_install, 0),
        install_limit=install_limit,
        window_ms=window_ms,
    )


def get_budget(
    store: Store,
    binding_id: str,
    now_ms: int,
    *,
    binding_limit: int,
    install_limit: int,
    window_ms: int,
) -> Budget:
    """Requests that reached `running` inside the rolling window `(now_ms - window_ms, now_ms]`."""
    _need_id(_BINDING_ID, binding_id, "binding id")
    _need_time(now_ms)
    _need_limit(binding_limit, "limit")
    _need_limit(install_limit, "limit")
    _need_limit(window_ms, "window", 1)
    with translate_errors(), store.read() as conn:
        return _budget(conn, binding_id, now_ms, binding_limit, install_limit, window_ms)


def window_usage(store: Store, now_ms: int, *, window_ms: int) -> WindowUsage:
    """Usage counts for the whole install in one read, for a list view of every bot's budget."""
    _need_time(now_ms)
    _need_limit(window_ms, "window", 1)
    with translate_errors(), store.read() as conn:
        rows = conn.execute(
            "SELECT binding_id, count(*) FROM generation_request"
            " WHERE started_ms IS NOT NULL AND started_ms > ? GROUP BY binding_id",
            (now_ms - window_ms,),
        ).fetchall()
    return WindowUsage(sum(count for _, count in rows), {binding: count for binding, count in rows})


def create_request(
    store: Store,
    *,
    request_id: str,
    binding_id: str,
    keep: Sequence[str],
    prompt_version: str,
    now_ms: int,
    binding_limit: int,
    install_limit: int,
    window_ms: int,
) -> CreatedRequest:
    """Insert a `queued` request, or return the existing one for a repeated `request_id`.

    One write transaction decides all of it: a repeat of `request_id` for the same binding is
    returned unchanged with `created=False`; otherwise a queued or running request anywhere in
    the install raises `GenerationInFlight`, and an exhausted budget raises `BudgetExhausted`.
    """
    _need_id(_REQUEST_ID, request_id, "request id")
    _need_id(_BINDING_ID, binding_id, "binding id")
    if not isinstance(prompt_version, str) or _PROMPT_VERSION.fullmatch(prompt_version) is None:
        raise StoreUsageError("prompt version")
    _need_time(now_ms)
    _need_limit(binding_limit, "limit")
    _need_limit(install_limit, "limit")
    _need_limit(window_ms, "window", 1)
    keep_json = _dump(_keep_names(keep))
    with translate_errors(), store.write() as conn:
        existing = _request(conn, request_id)
        if existing is not None:
            if existing.binding_id != binding_id:
                raise StoreUsageError("request id belongs to another binding")
            return CreatedRequest(existing, False)
        if not _binding_exists(conn, binding_id):
            raise UnknownBinding
        busy = conn.execute(
            "SELECT 1 FROM generation_request WHERE status IN ('queued', 'running') LIMIT 1"
        ).fetchone()
        if busy is not None:
            raise GenerationInFlight
        budget = _budget(conn, binding_id, now_ms, binding_limit, install_limit, window_ms)
        if budget.binding_remaining == 0 or budget.install_remaining == 0:
            raise BudgetExhausted
        conn.execute(
            "INSERT INTO generation_request (request_id, binding_id, status, keep_json,"
            " prompt_version, attempts, internal_tag, created_ms)"
            " VALUES (?, ?, 'queued', ?, ?, 0, ?, ?)",
            (request_id, binding_id, keep_json, prompt_version, SUMMONING_TAG, now_ms),
        )
        created = _request(conn, request_id)
        assert created is not None
        return CreatedRequest(created, True)


def get_request(store: Store, request_id: str) -> RequestRecord | None:
    if not isinstance(request_id, str) or _REQUEST_ID.fullmatch(request_id) is None:
        return None
    with translate_errors(), store.read() as conn:
        return _request(conn, request_id)


def _transition(store: Store, request_id: str, sql: str, params: tuple[object, ...]) -> bool:
    with translate_errors(), store.write() as conn:
        moved = conn.execute(sql, params)
        if moved.rowcount == 1:
            return True
        if _request(conn, request_id) is None:
            raise UnknownRequest
        return False


def mark_running(store: Store, request_id: str, now_ms: int) -> bool:
    """`queued` to `running`. False when the request is no longer queued (for example cancelled)."""
    _need_id(_REQUEST_ID, request_id, "request id")
    _need_time(now_ms)
    return _transition(
        store,
        request_id,
        "UPDATE generation_request SET status = 'running', started_ms = max(?, created_ms)"
        " WHERE request_id = ? AND status = 'queued'",
        (now_ms, request_id),
    )


def complete_request(
    store: Store,
    request_id: str,
    *,
    candidate: Mapping[str, object],
    model_label: str,
    attempts: int,
    now_ms: int,
) -> bool:
    """`running` to `ready` with the validated candidate. False (nothing written) for a late
    result: the request was cancelled, failed or swept in the meantime."""
    _need_id(_REQUEST_ID, request_id, "request id")
    _need_time(now_ms)
    attempts = _need_limit(attempts, "attempts")
    if attempts > MAX_ATTEMPTS or not isinstance(model_label, str):
        raise StoreUsageError("attempts or model label")
    candidate_json = _dump(_check_profile(candidate))
    return _transition(
        store,
        request_id,
        "UPDATE generation_request SET status = 'ready', candidate_json = ?, model_label = ?,"
        " attempts = ?, finished_ms = max(?, started_ms)"
        " WHERE request_id = ? AND status = 'running'",
        (candidate_json, model_label[:MAX_MODEL_LABEL_CHARS], attempts, now_ms, request_id),
    )


def fail_request(
    store: Store,
    request_id: str,
    *,
    error_code: str,
    attempts: int,
    now_ms: int,
    model_label: str | None = None,
) -> bool:
    """`queued` or `running` to `failed`. False when the request already left those states."""
    _need_id(_REQUEST_ID, request_id, "request id")
    _need_time(now_ms)
    attempts = _need_limit(attempts, "attempts")
    if attempts > MAX_ATTEMPTS:
        raise StoreUsageError("attempts")
    if not isinstance(error_code, str) or _ERROR_CODE.fullmatch(error_code) is None:
        raise StoreUsageError("error code")
    label = None if model_label is None else model_label[:MAX_MODEL_LABEL_CHARS]
    return _transition(
        store,
        request_id,
        "UPDATE generation_request SET status = 'failed', error_code = ?, attempts = ?,"
        " model_label = coalesce(?, model_label),"
        " finished_ms = max(?, coalesce(started_ms, created_ms))"
        " WHERE request_id = ? AND status IN ('queued', 'running')",
        (error_code, attempts, label, now_ms, request_id),
    )


def cancel_request(store: Store, request_id: str, now_ms: int) -> RequestRecord:
    """`queued`, `running` or `ready` to `cancelled` (a ready candidate is discarded and its text
    cleared). Any other state is returned unchanged, so a repeated cancel is harmless."""
    _need_id(_REQUEST_ID, request_id, "request id")
    _need_time(now_ms)
    with translate_errors(), store.write() as conn:
        conn.execute(
            "UPDATE generation_request SET status = 'cancelled', candidate_json = NULL,"
            " finished_ms = max(?, coalesce(started_ms, created_ms))"
            " WHERE request_id = ? AND status IN ('queued', 'running', 'ready')",
            (now_ms, request_id),
        )
        record = _request(conn, request_id)
        if record is None:
            raise UnknownRequest
        return record


def sweep_interrupted(store: Store, now_ms: int, *, older_than_ms: int | None = None) -> int:
    """Fail every `queued` or `running` request with `interrupted`; returns how many.

    Call once at startup (no age filter: a previous process owned them). `older_than_ms` limits
    the sweep to requests created at least that long ago.
    """
    _need_time(now_ms)
    if older_than_ms is not None:
        _need_limit(older_than_ms, "age")
    with translate_errors(), store.write() as conn:
        swept = conn.execute(
            "UPDATE generation_request SET status = 'failed', error_code = 'interrupted',"
            " finished_ms = max(?, coalesce(started_ms, created_ms))"
            " WHERE status IN ('queued', 'running') AND (? IS NULL OR created_ms <= ? - ?)",
            (now_ms, older_than_ms, now_ms, older_than_ms or 0),
        )
        return swept.rowcount


# --- specters ----------------------------------------------------------------------------------


def get_specter(store: Store, binding_id: str) -> SpecterRecord | None:
    """The active (not archived) Specter of a binding, or None."""
    if not isinstance(binding_id, str) or _BINDING_ID.fullmatch(binding_id) is None:
        return None
    with translate_errors(), store.read() as conn:
        row = conn.execute(
            _SPECTER_SELECT + " WHERE s.binding_id = ? AND s.archived_ms IS NULL", (binding_id,)
        ).fetchone()
        return None if row is None else _specter(row)


def list_specters(store: Store) -> tuple[SpecterRecord, ...]:
    """Every active Specter, oldest first, at most `MAX_LISTED_SPECTERS`."""
    with translate_errors(), store.read() as conn:
        rows = conn.execute(
            _SPECTER_SELECT
            + " WHERE s.archived_ms IS NULL ORDER BY s.created_ms, s.specter_id LIMIT ?",
            (MAX_LISTED_SPECTERS,),
        ).fetchall()
        return tuple(_specter(row) for row in rows)


def accept_request(
    store: Store, request_id: str, *, expected_version: int, now_ms: int
) -> SpecterRecord:
    """Accept a `ready` candidate as the binding's Specter, in one write transaction.

    Raises `UnknownRequest`, `NotReady` (not `ready`) or `VersionConflict` (the active version
    differs from `expected_version`; 0 means "no active Specter"). Kept fields take the CURRENT
    accepted values, the portrait is carried over, every other `ready` request of the binding
    becomes `superseded`.
    """
    _need_id(_REQUEST_ID, request_id, "request id")
    _need_time(now_ms)
    expected = _need_version(expected_version)
    with translate_errors(), store.write() as conn:
        request = _request(conn, request_id)
        if request is None:
            raise UnknownRequest
        if request.status != "ready" or request.candidate is None:
            raise NotReady
        active = _active(conn, request.binding_id)
        _check_expected(active, expected)
        profile = _check_profile(request.candidate)
        if active is None:
            specter_id = _create_specter(
                conn,
                request.binding_id,
                change="generated",
                profile=profile,
                source="generated",
                request_id=request_id,
                prompt_version=request.prompt_version,
                now_ms=now_ms,
            )
        else:
            for name in request.keep:
                profile[name] = active.profile[name]
            specter_id = active.specter_id
            _advance(
                conn,
                active,
                change="generated",
                profile=profile,
                asset_id=active.asset_id,
                source="generated",
                request_id=request_id,
                prompt_version=request.prompt_version,
                now_ms=now_ms,
            )
        accepted = conn.execute(
            "UPDATE generation_request SET status = 'accepted'"
            " WHERE request_id = ? AND status = 'ready'",
            (request_id,),
        )
        if accepted.rowcount != 1:
            raise NotReady
        _supersede_ready(conn, request.binding_id, request_id)
        return _read_specter(conn, specter_id)


def save_manual(
    store: Store,
    binding_id: str,
    *,
    expected_version: int,
    profile: Mapping[str, object],
    now_ms: int,
) -> SpecterRecord:
    """The user-typed fallback: creates the Specter (`expected_version` 0) or replaces its profile.

    Recorded as `source = 'manual'` with no prompt version, never as AI generation. The portrait
    is carried over.
    """
    _need_id(_BINDING_ID, binding_id, "binding id")
    _need_time(now_ms)
    expected = _need_version(expected_version)
    checked = _check_profile(profile)
    with translate_errors(), store.write() as conn:
        if not _binding_exists(conn, binding_id):
            raise UnknownBinding
        active = _active(conn, binding_id)
        _check_expected(active, expected)
        if active is None:
            specter_id = _create_specter(
                conn,
                binding_id,
                change="manual",
                profile=checked,
                source="manual",
                request_id=None,
                prompt_version=None,
                now_ms=now_ms,
            )
        else:
            specter_id = active.specter_id
            _advance(
                conn,
                active,
                change="manual",
                profile=checked,
                asset_id=active.asset_id,
                source="manual",
                request_id=None,
                prompt_version=None,
                now_ms=now_ms,
            )
        return _read_specter(conn, specter_id)


def save_rename(
    store: Store,
    binding_id: str,
    *,
    expected_version: int,
    profile: Mapping[str, object],
    now_ms: int,
) -> SpecterRecord:
    """Change `name` and `epithet` only. `profile` is the full new profile; any other field that
    differs from the active one raises `StoreUsageError`. An unchanged name is a no-op."""
    _need_id(_BINDING_ID, binding_id, "binding id")
    _need_time(now_ms)
    expected = _need_version(expected_version)
    checked = _check_profile(profile)
    with translate_errors(), store.write() as conn:
        active = _active(conn, binding_id)
        if active is None:
            raise UnknownSpecter
        _check_expected(active, expected)
        other = [f for f in (*PROFILE_FIELDS, "contractVersion") if f not in ("name", "epithet")]
        if any(checked[f] != active.profile[f] for f in other):
            raise StoreUsageError("rename changes more than the name")
        if (checked["name"], checked["epithet"]) != (
            active.profile["name"],
            active.profile["epithet"],
        ):
            _advance(
                conn,
                active,
                change="renamed",
                profile=checked,
                asset_id=active.asset_id,
                source=active.source,
                request_id=None,
                prompt_version=active.prompt_version,
                now_ms=now_ms,
            )
        return _read_specter(conn, active.specter_id)


def set_portrait(
    store: Store,
    binding_id: str,
    *,
    expected_version: int,
    asset_id: str | None,
    now_ms: int,
) -> SpecterRecord:
    """Point the Specter at `asset_id` (None clears it). The profile is copied unchanged."""
    _need_id(_BINDING_ID, binding_id, "binding id")
    _need_time(now_ms)
    expected = _need_version(expected_version)
    if asset_id is not None:
        _need_id(_ASSET_ID, asset_id, "asset id")
    with translate_errors(), store.write() as conn:
        active = _active(conn, binding_id)
        if active is None:
            raise UnknownSpecter
        _check_expected(active, expected)
        if (
            asset_id is not None
            and not conn.execute("SELECT 1 FROM asset WHERE asset_id = ?", (asset_id,)).fetchone()
        ):
            raise UnknownAsset
        if asset_id != active.asset_id:
            _advance(
                conn,
                active,
                change="portrait",
                profile=active.profile,
                asset_id=asset_id,
                source=active.source,
                request_id=None,
                prompt_version=active.prompt_version,
                now_ms=now_ms,
            )
        return _read_specter(conn, active.specter_id)


def archive_specter(store: Store, binding_id: str, *, expected_version: int, now_ms: int) -> None:
    """Archive the active Specter (revisions stay). Any `ready` candidate of the binding becomes
    `superseded`. A later accept creates a new Specter with a new id."""
    _need_id(_BINDING_ID, binding_id, "binding id")
    _need_time(now_ms)
    expected = _need_version(expected_version)
    with translate_errors(), store.write() as conn:
        active = _active(conn, binding_id)
        if active is None:
            raise UnknownSpecter
        _check_expected(active, expected)
        _advance(
            conn,
            active,
            change="archived",
            profile=active.profile,
            asset_id=active.asset_id,
            source=active.source,
            request_id=None,
            prompt_version=active.prompt_version,
            now_ms=now_ms,
        )
        _supersede_ready(conn, binding_id, None)


def list_revisions(
    store: Store, specter_id: str, *, limit: int | None = None, cursor: str | None = None
) -> Page[RevisionRecord]:
    """Revisions newest first, keyset-paged on `revision_no`. Raises `UnknownSpecter`."""
    _need_id(_SPECTER_ID, specter_id, "specter id")
    size = clamp_limit(limit, DEFAULT_REVISIONS_PAGE, MAX_REVISIONS_PAGE)
    before: int | None = None
    if cursor is not None:
        (value,) = decode_cursor(cursor, 1)
        if not isinstance(value, int):
            raise StoreUsageError("cursor")
        before = value
    with translate_errors(), store.read() as conn:
        if (
            conn.execute("SELECT 1 FROM specter WHERE specter_id = ?", (specter_id,)).fetchone()
            is None
        ):
            raise UnknownSpecter
        rows = conn.execute(
            "SELECT specter_id, revision_no, change, profile_json, asset_id, source, request_id,"
            " prompt_version, created_ms FROM specter_revision"
            " WHERE specter_id = ? AND (? IS NULL OR revision_no < ?)"
            " ORDER BY revision_no DESC LIMIT ?",
            (specter_id, before, before, size + 1),
        ).fetchall()
    records = [
        RevisionRecord(
            specter_id=r[0],
            revision_no=r[1],
            change=r[2],
            profile=json.loads(r[3]),
            asset_id=r[4],
            source="manual" if r[5] == "manual" else "generated",
            request_id=r[6],
            prompt_version=r[7],
            created_ms=r[8],
        )
        for r in rows
    ]
    return build_page(records, size, lambda record: (record.revision_no,))


# --- assets ------------------------------------------------------------------------------------


def insert_asset(
    store: Store,
    *,
    data: bytes,
    width: int,
    height: int,
    origin: AssetOrigin,
    label: str,
    now_ms: int,
) -> InsertedAsset:
    """Store re-encoded PNG bytes once. The id is `ast_` + the first 24 hex of the sha256 of
    `data`, computed here. The same bytes again return the existing row (first writer's label and
    origin win) with `created=False`."""
    _need_time(now_ms)
    if not isinstance(data, bytes) or not 1 <= len(data) <= MAX_ASSET_BYTES:
        raise StoreUsageError("asset size")
    if not data.startswith(PNG_SIGNATURE):
        raise StoreUsageError("asset is not a PNG")
    for side in (width, height):
        if isinstance(side, bool) or not isinstance(side, int) or not 1 <= side <= MAX_ASSET_SIDE:
            raise StoreUsageError("asset dimensions")
    if origin not in _ORIGINS:
        raise StoreUsageError("asset origin")
    if not isinstance(label, str) or len(label) > MAX_ASSET_LABEL_CHARS:
        raise StoreUsageError("asset label")
    digest = hashlib.sha256(data).hexdigest()
    asset_id = "ast_" + digest[:24]
    with translate_errors(), store.write() as conn:
        inserted = conn.execute(
            "INSERT INTO asset (asset_id, sha256, media_type, width, height, byte_length, origin,"
            " label, bytes, created_ms) VALUES (?, ?, 'image/png', ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT (sha256) DO NOTHING",
            (asset_id, digest, width, height, len(data), origin, label, data, now_ms),
        )
        row = conn.execute(
            "SELECT " + _ASSET_COLUMNS + " FROM asset a WHERE a.asset_id = ?", (asset_id,)
        ).fetchone()
        return InsertedAsset(_asset(row), inserted.rowcount == 1)


def get_asset(store: Store, asset_id: str, *, with_data: bool = True) -> AssetRecord | None:
    if not isinstance(asset_id, str) or _ASSET_ID.fullmatch(asset_id) is None:
        return None
    with translate_errors(), store.read() as conn:
        row = conn.execute(
            "SELECT " + _ASSET_COLUMNS + ", a.bytes FROM asset a WHERE a.asset_id = ?", (asset_id,)
        ).fetchone()
        if row is None:
            return None
        return _asset(row[:9], bytes(row[9]) if with_data else None)


def list_assets(store: Store) -> tuple[AssetRecord, ...]:
    """Bundled assets first, then uploads, oldest first; metadata only, at most
    `MAX_LISTED_ASSETS`."""
    with translate_errors(), store.read() as conn:
        rows = conn.execute(
            "SELECT " + _ASSET_COLUMNS + " FROM asset a"
            " ORDER BY CASE a.origin WHEN 'bundled' THEN 0 ELSE 1 END, a.created_ms, a.asset_id"
            " LIMIT ?",
            (MAX_LISTED_ASSETS,),
        ).fetchall()
        return tuple(_asset(row) for row in rows)


# --- brief input -------------------------------------------------------------------------------


def bot_display_name(store: Store, binding_id: str) -> str | None:
    """The newest display name of the bot (its display name, else its name), for the creative
    brief. Raises `UnknownBinding`; None when no roster poll has recorded one."""
    _need_id(_BINDING_ID, binding_id, "binding id")
    with translate_errors(), store.read() as conn:
        if not _binding_exists(conn, binding_id):
            raise UnknownBinding
        row = conn.execute(
            "SELECT CASE WHEN display_name IS NULL OR display_name = '' THEN name"
            " ELSE display_name END FROM bot_display_revision WHERE binding_id = ?"
            " ORDER BY revision_no DESC LIMIT 1",
            (binding_id,),
        ).fetchone()
        return None if row is None or row[0] == "" else str(row[0])
