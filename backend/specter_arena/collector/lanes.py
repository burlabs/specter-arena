from __future__ import annotations

from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Protocol


class RowLike(Protocol):
    """The fields the row lane orders by; `parse.RowFact` provides them."""

    @property
    def slot_key(self) -> str: ...
    @property
    def turn(self) -> int | None: ...
    @property
    def turn_gen(self) -> str | None: ...
    @property
    def source_time_ms(self) -> int | None: ...


@dataclass(frozen=True)
class DropRecord:
    dm_key: str
    count: int
    first_received_ms: int
    last_received_ms: int


def _is_older(candidate: RowLike, queued: RowLike) -> bool:
    """True only when the candidate provably precedes the queued row (same `turn_gen`).

    A different or unknown `turn_gen` is a source restart or missing evidence, so receipt order
    decides and the later receipt wins.
    """
    if candidate.turn_gen is None or candidate.turn_gen != queued.turn_gen:
        return False
    if candidate.turn is not None and queued.turn is not None and candidate.turn != queued.turn:
        return candidate.turn < queued.turn
    if (
        candidate.source_time_ms is not None
        and queued.source_time_ms is not None
        and candidate.source_time_ms != queued.source_time_ms
    ):
        return candidate.source_time_ms < queued.source_time_ms
    return False


class RowLane[R: RowLike]:
    """Latest state per slot key. A snapshot supersedes the previous one, so it cannot overflow."""

    def __init__(self) -> None:
        self._rows: dict[str, tuple[R, int]] = {}

    def __len__(self) -> int:
        return len(self._rows)

    def put(self, row: R, received_ms: int) -> bool:
        """Queue the row; True when a row for the same slot key was already queued.

        Exactly one of the two rows is discarded in that case (the older, by the ordering rule),
        so the caller counts one `coalesced` unit.
        """
        queued = self._rows.get(row.slot_key)
        if queued is None:
            self._rows[row.slot_key] = (row, received_ms)
            return False
        if not _is_older(row, queued[0]):
            self._rows[row.slot_key] = (row, received_ms)
        return True

    def drain(self, limit: int) -> list[tuple[R, int]]:
        taken: list[tuple[R, int]] = []
        for slot_key in list(self._rows)[: max(limit, 0)]:
            taken.append(self._rows.pop(slot_key))
        return taken

    def requeue(self, items: list[tuple[R, int]]) -> int:
        """Put back rows from a failed write; a newer queued row wins. Returns rows discarded."""
        discarded = 0
        for row, received_ms in items:
            queued = self._rows.get(row.slot_key)
            if queued is None:
                self._rows[row.slot_key] = (row, received_ms)
            else:
                discarded += 1
                if _is_older(queued[0], row):
                    self._rows[row.slot_key] = (row, received_ms)
        return discarded


@dataclass
class _Entry[E]:
    event: E
    dm_key: str
    received_ms: int


class EventLane[E]:
    """Bounded FIFO. When full, the oldest event of the same binding is dropped and recorded."""

    def __init__(self, maxsize: int) -> None:
        if maxsize < 1:
            raise ValueError("maxsize must be at least 1")
        self._maxsize = maxsize
        self._entries: OrderedDict[int, _Entry[E]] = OrderedDict()
        self._by_binding: dict[str, deque[int]] = {}
        self._drops: dict[str, DropRecord] = {}
        self._next_id = 0

    def __len__(self) -> int:
        return len(self._entries)

    def put(self, event: E, dm_key: str, received_ms: int) -> None:
        if len(self._entries) >= self._maxsize:
            self._evict_for(dm_key)
        self._append(_Entry(event, dm_key, received_ms))

    def take_drops(self) -> list[DropRecord]:
        drops = sorted(self._drops.values(), key=lambda record: record.first_received_ms)
        self._drops = {}
        return drops

    def drain(self, limit: int) -> list[tuple[E, str, int]]:
        taken: list[tuple[E, str, int]] = []
        while self._entries and len(taken) < max(limit, 0):
            _, entry = self._entries.popitem(last=False)
            self._by_binding[entry.dm_key].popleft()
            if not self._by_binding[entry.dm_key]:
                del self._by_binding[entry.dm_key]
            taken.append((entry.event, entry.dm_key, entry.received_ms))
        return taken

    def requeue_front(self, items: list[tuple[E, str, int]]) -> None:
        """Put drained events back ahead of newer ones, oldest first. Overflow drops the oldest."""
        for event, dm_key, received_ms in reversed(items):
            self._append(_Entry(event, dm_key, received_ms), front=True)
        while len(self._entries) > self._maxsize:
            self._drop(next(iter(self._entries)))

    def _append(self, entry: _Entry[E], *, front: bool = False) -> None:
        entry_id = self._next_id
        self._next_id += 1
        self._entries[entry_id] = entry
        queue = self._by_binding.setdefault(entry.dm_key, deque())
        if front:
            self._entries.move_to_end(entry_id, last=False)
            queue.appendleft(entry_id)
        else:
            queue.append(entry_id)

    def _evict_for(self, dm_key: str) -> None:
        own = self._by_binding.get(dm_key)
        self._drop(own[0] if own else next(iter(self._entries)))

    def _drop(self, entry_id: int) -> None:
        entry = self._entries.pop(entry_id)
        queue = self._by_binding[entry.dm_key]
        queue.remove(entry_id)
        if not queue:
            del self._by_binding[entry.dm_key]
        previous = self._drops.get(entry.dm_key)
        if previous is None:
            self._drops[entry.dm_key] = DropRecord(
                entry.dm_key, 1, entry.received_ms, entry.received_ms
            )
        else:
            self._drops[entry.dm_key] = DropRecord(
                entry.dm_key,
                previous.count + 1,
                min(previous.first_received_ms, entry.received_ms),
                max(previous.last_received_ms, entry.received_ms),
            )
