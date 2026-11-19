from __future__ import annotations

import asyncio
import re
from collections.abc import Callable
from typing import Any, Final, TypeVar

from ..specters.text import clean_text
from ..store import Store
from ..store import errors as store_errors
from ..store import work as db_work
from ..store import xp as db_xp
from ..store import xp_policy as policy
from .wire import (
    work_item_wire,
    work_items_wire,
    xp_history_wire,
    xp_summaries_wire,
)

T = TypeVar("T")

WORK_ID: Final = re.compile(r"wrk_[0-9a-f]{24}")
ATTEMPT_ID: Final = re.compile(r"att_[0-9a-f]{24}")
BINDING_ID: Final = re.compile(r"bnd_[0-9a-f]{24}")
REQUEST_ID: Final = re.compile(r"[A-Za-z0-9_-]{8,64}")
REVISION: Final = re.compile(r"[0-9a-f]{24}")
MAX_VERSION: Final = 2**53 - 1
WORK_PAGE: Final = db_work.MAX_LIST_PAGE
HISTORY_PAGE: Final = db_xp.MAX_HISTORY_PAGE
MAX_LIMIT_DIGITS: Final = 6
RAW_TEXT_FACTOR: Final = 4
STATES: Final = frozenset(db_work.STATES)
ACTIONS: Final = frozenset(db_work.ACTIONS)
EVIDENCE_ACTIONS: Final = db_work.EVIDENCE_ACTIONS
CREATE_KEYS: Final = frozenset(
    {
        "requestId",
        "title",
        "acceptanceCondition",
        "rewardable",
        "parentId",
        "attemptIds",
        "milestones",
    }
)
CREATE_REQUIRED: Final = CREATE_KEYS - {"parentId"}
LINK_KEYS: Final = frozenset({"expectedVersion", "attemptId"})
MILESTONE_KEYS: Final = frozenset({"expectedVersion", "position", "done"})
DECISION_KEYS: Final = frozenset(
    {"requestId", "expectedVersion", "action", "evidenceRevision", "note"}
)
DECISION_REQUIRED: Final = frozenset({"requestId", "expectedVersion", "action"})


class WorkError(Exception):
    """A contract error: `code` is an `api-error.v1` code and `status` its HTTP status."""

    def __init__(self, code: str, status: int) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def _invalid() -> WorkError:
    return WorkError("invalid_body", 400)


# Store error to api-error code (SC8-4 item 7). Specific classes before their bases;
# `InvalidCursor` is a `StoreError`, so it precedes `StoreError`.
_ERRORS: Final[tuple[tuple[type[Exception], str, int], ...]] = (
    (store_errors.VersionConflict, "version_conflict", 409),
    (store_errors.UnknownWork, "unknown_work", 404),
    (store_errors.UnknownAttempt, "unknown_attempt", 404),
    (store_errors.UnknownBinding, "unknown_binding", 404),
    (store_errors.AttemptAlreadyLinked, "attempt_already_linked", 409),
    (store_errors.AttemptNotEligible, "attempt_not_eligible", 422),
    (store_errors.InvalidTransition, "invalid_transition", 409),
    (store_errors.StaleEvidence, "stale_evidence", 409),
    (store_errors.AttemptsNotEnded, "attempts_not_ended", 409),
    (store_errors.NoEvidence, "no_evidence", 409),
    (store_errors.ChildrenNotAccepted, "children_not_accepted", 409),
    (store_errors.ParentLocked, "parent_locked", 409),
    (store_errors.ContributorsFrozen, "contributors_frozen", 409),
    (store_errors.RequestReused, "request_reused", 409),
    (store_errors.LimitReached, "limit_reached", 422),
    (store_errors.InvalidCursor, "invalid_cursor", 400),
    (store_errors.StoreUsageError, "invalid_body", 400),
    (store_errors.StoreError, "store_unavailable", 503),
)


class WorkService:
    """The only thing the work routes call. It never reads or writes observations, bot
    configuration or a Specter, and it has no caller on the collector path.
    Every store call is a function of `store/work.py` or `store/xp.py` run through
    `asyncio.to_thread`; the single writer lock in `Store.write()` serialises acceptance."""

    def __init__(self, store: Store, *, clock: Callable[[], int]) -> None:
        self._store = store
        self._clock = clock

    async def _call(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        try:
            return await asyncio.to_thread(fn, self._store, *args, **kwargs)
        except Exception as error:
            for kind, code, status in _ERRORS:
                if isinstance(error, kind):
                    raise WorkError(code, status) from error
            raise

    @staticmethod
    def _fields(body: object, allowed: frozenset[str], required: frozenset[str]) -> dict[str, Any]:
        if not isinstance(body, dict) or not required <= set(body) <= allowed:
            raise _invalid()
        return body

    @staticmethod
    def _work_id(value: object) -> str:
        if not isinstance(value, str) or not WORK_ID.fullmatch(value):
            raise WorkError("unknown_work", 404)
        return value

    @staticmethod
    def _binding(value: object) -> str:
        if not isinstance(value, str) or not BINDING_ID.fullmatch(value):
            raise WorkError("unknown_binding", 404)
        return value

    @staticmethod
    def _attempt_id(value: object) -> str:
        if not isinstance(value, str):
            raise _invalid()
        if not ATTEMPT_ID.fullmatch(value):
            raise WorkError("unknown_attempt", 404)
        return value

    @staticmethod
    def _request_id(value: object) -> str:
        if not isinstance(value, str) or not REQUEST_ID.fullmatch(value):
            raise _invalid()
        return value

    @staticmethod
    def _version(value: object) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_VERSION:
            raise _invalid()
        return value

    @staticmethod
    def _flag(value: object) -> bool:
        if not isinstance(value, bool):
            raise _invalid()
        return value

    @staticmethod
    def _text(value: object, maximum: int) -> str:
        """The store is the writer and applies the length and control-character rules. This only
        bounds the work before the store sees it and refuses text with nothing visible in it."""
        if not isinstance(value, str) or len(value) > RAW_TEXT_FACTOR * maximum:
            raise _invalid()
        if not clean_text(value):
            raise _invalid()
        return value

    def _parent(self, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise _invalid()
        return self._work_id(value)

    def _attempt_ids(self, value: object) -> tuple[str, ...]:
        if not isinstance(value, list) or len(value) > policy.MAX_ATTEMPTS_PER_WORK:
            raise _invalid()
        ids = tuple(self._attempt_id(item) for item in value)
        if len(set(ids)) != len(ids):
            raise _invalid()
        return ids

    def _milestones(self, value: object) -> tuple[str, ...]:
        if not isinstance(value, list) or len(value) > policy.MAX_MILESTONES:
            raise _invalid()
        return tuple(self._text(item, policy.MAX_MILESTONE_LABEL) for item in value)

    @staticmethod
    def _note(value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str) or len(value) > RAW_TEXT_FACTOR * policy.MAX_NOTE:
            raise _invalid()
        return value

    @staticmethod
    def _limit(raw: str | None, maximum: int) -> int:
        if raw is None:
            return maximum
        if not (raw.isascii() and raw.isdigit()) or len(raw) > MAX_LIMIT_DIGITS:
            raise WorkError("invalid_limit", 400)
        return min(max(int(raw), 1), maximum)

    async def list_work(
        self, *, state: str | None, binding_id: str | None, cursor: str | None, limit: str | None
    ) -> dict[str, Any]:
        if state is not None and state not in STATES:
            raise WorkError("invalid_state", 400)
        binding = None if binding_id is None else self._binding(binding_id)
        size = self._limit(limit, WORK_PAGE)
        as_of_ms = self._clock()
        page = await self._call(
            db_work.list_work, state=state, binding_id=binding, cursor=cursor, limit=size
        )
        return work_items_wire(page, as_of_ms)

    async def get_work(self, work_id: str) -> dict[str, Any]:
        record = await self._call(db_work.get_work, self._work_id(work_id))
        return work_item_wire(record)

    async def xp_summaries(self) -> dict[str, Any]:
        as_of_ms = self._clock()
        return xp_summaries_wire(await self._call(db_xp.xp_summaries), as_of_ms)

    async def xp_history(
        self, binding_id: str, *, cursor: str | None, limit: str | None
    ) -> dict[str, Any]:
        binding = self._binding(binding_id)
        size = self._limit(limit, HISTORY_PAGE)
        as_of_ms = self._clock()
        result = await self._call(db_xp.xp_history, binding, cursor=cursor, limit=size)
        return xp_history_wire(result, as_of_ms)

    async def create_work(self, body: object) -> tuple[int, dict[str, Any]]:
        data = self._fields(body, CREATE_KEYS, CREATE_REQUIRED)
        request_token = self._request_id(data["requestId"])
        title = self._text(data["title"], policy.MAX_TITLE)
        condition = self._text(data["acceptanceCondition"], policy.MAX_CONDITION)
        rewardable = self._flag(data["rewardable"])
        parent_id = self._parent(data.get("parentId"))
        attempt_ids = self._attempt_ids(data["attemptIds"])
        milestones = self._milestones(data["milestones"])
        created = await self._call(
            db_work.create_work,
            request_token=request_token,
            title=title,
            acceptance_condition=condition,
            rewardable=rewardable,
            parent_id=parent_id,
            attempt_ids=attempt_ids,
            milestones=milestones,
            now_ms=self._clock(),
        )
        return (201 if created.created else 200), work_item_wire(created.record)

    async def link_attempt(self, work_id: str, body: object) -> dict[str, Any]:
        work = self._work_id(work_id)
        data = self._fields(body, LINK_KEYS, LINK_KEYS)
        expected = self._version(data["expectedVersion"])
        attempt_id = self._attempt_id(data["attemptId"])
        record = await self._call(
            db_work.link_attempt,
            work,
            expected_version=expected,
            attempt_id=attempt_id,
            now_ms=self._clock(),
        )
        return work_item_wire(record)

    async def set_milestone(self, work_id: str, body: object) -> dict[str, Any]:
        work = self._work_id(work_id)
        data = self._fields(body, MILESTONE_KEYS, MILESTONE_KEYS)
        expected = self._version(data["expectedVersion"])
        position = data["position"]
        if (
            isinstance(position, bool)
            or not isinstance(position, int)
            or not 1 <= position <= policy.MAX_MILESTONES
        ):
            raise _invalid()
        done = self._flag(data["done"])
        record = await self._call(
            db_work.set_milestone,
            work,
            expected_version=expected,
            position=position,
            done=done,
            now_ms=self._clock(),
        )
        return work_item_wire(record)

    async def decide(self, work_id: str, body: object) -> dict[str, Any]:
        work = self._work_id(work_id)
        data = self._fields(body, DECISION_KEYS, DECISION_REQUIRED)
        request_token = self._request_id(data["requestId"])
        expected = self._version(data["expectedVersion"])
        action = data["action"]
        if not isinstance(action, str) or action not in ACTIONS:
            raise _invalid()
        revision = data.get("evidenceRevision")
        if action in EVIDENCE_ACTIONS:
            if not isinstance(revision, str) or not REVISION.fullmatch(revision):
                raise _invalid()
        elif revision is not None:
            raise _invalid()
        note = self._note(data.get("note"))
        result = await self._call(
            db_work.decide_work,
            work,
            action=action,
            expected_version=expected,
            request_token=request_token,
            evidence_revision=revision,
            note=note,
            now_ms=self._clock(),
        )
        return work_item_wire(result.record)
