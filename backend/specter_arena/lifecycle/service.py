from __future__ import annotations

import asyncio
import re
import threading
from collections.abc import Callable
from typing import Any, Final, Protocol, TypeVar

from ..store import (
    MAX_UPLOADED_ASSETS,
    RETENTION_CHOICES,
    BackupError,
    ExportFile,
    RunRecord,
    Store,
    cutoff_for,
    export_database,
    get_retention,
    list_exports,
    pre_lifecycle_backup,
    purge_preview,
    read_collector_setting,
    read_horizon,
    read_runs,
    run_asset_cleanup,
    run_purge,
    set_retention,
    unused_upload_count,
    uploaded_asset_count,
)
from ..store import errors as store_errors

T = TypeVar("T")

DATA_CONTRACT_VERSION: Final = 1  # data-lifecycle.v1
COLLECTOR_CONTRACT_VERSION: Final = 1  # collector-control.v1
_STATE: Final = re.compile(r"[a-z][a-z0-9-]{0,47}")


class DataError(Exception):
    """A contract error: `code` is an `api-error.v1` code and `status` its HTTP status."""

    def __init__(self, code: str, status: int) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


class CollectorLike(Protocol):
    async def pause(self) -> None: ...
    async def resume(self) -> None: ...
    def status(self) -> Any: ...


# Store error to api-error code. Specific classes before `StoreError`.
_ERRORS: Final[tuple[tuple[type[Exception], str, int], ...]] = (
    (store_errors.LifecycleBusy, "lifecycle_busy", 409),
    (store_errors.StoreUsageError, "invalid_body", 400),
    (store_errors.StoreError, "store_unavailable", 503),
)


def run_wire(run: RunRecord | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "kind": run.kind,
        "state": run.state,
        "cutoffMs": run.cutoff_ms,
        "startedMs": run.started_ms,
        "endedMs": run.ended_ms,
        "deleted": {
            "observations": run.observations,
            "quarantine": run.quarantine,
            "attempts": run.attempts,
            "assets": run.assets,
        },
    }


def export_wire(item: ExportFile) -> dict[str, Any]:
    return {
        "fileName": item.file_name,
        "byteLength": item.byte_length,
        "sha256": item.sha256,
        "createdMs": item.created_ms,
    }


def _strict_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


class DataService:
    """Retention, purge, export, upload cleanup and the collector pause switch.

    Every store call runs in a thread. Purge, cleanup, export and a retention change are
    exclusive: while one runs another answers 409 `lifecycle_busy`. Nothing here deletes unless
    the owner asked: there is no schedule.
    """

    def __init__(self, store: Store, *, clock: Callable[[], int]) -> None:
        self._store = store
        self._clock = clock
        self._exclusive = threading.Lock()

    async def _thread(self, fn: Callable[[], T]) -> T:
        try:
            return await asyncio.to_thread(fn)
        except DataError:
            raise
        except Exception as error:
            for kind, code, status in _ERRORS:
                if isinstance(error, kind):
                    raise DataError(code, status) from error
            raise

    def _exclusively(self, fn: Callable[[], T]) -> Callable[[], T]:
        def guarded() -> T:
            if not self._exclusive.acquire(blocking=False):
                raise DataError("lifecycle_busy", 409)
            try:
                return fn()
            finally:
                self._exclusive.release()

        return guarded

    # ---- status ---------------------------------------------------------------------------

    def _status(self) -> dict[str, Any]:
        store = self._store
        now = self._clock()
        retention = get_retention(store)
        runs = read_runs(store)
        exports = list_exports(store.data_dir)
        preview = None
        if retention.retention_days is not None:
            found = purge_preview(store, cutoff_for(retention.retention_days, now))
            preview = {
                "cutoffMs": found.cutoff_ms,
                "observations": found.observations,
                "quarantine": found.quarantine,
                "attempts": found.attempts,
            }
        return {
            "contractVersion": DATA_CONTRACT_VERSION,
            "asOfMs": now,
            "retention": {
                "retentionDays": retention.retention_days,
                "changedAtMs": retention.changed_at_ms,
                "revision": retention.revision,
            },
            "horizonMs": read_horizon(store),
            "preview": preview,
            "running": run_wire(runs.running),
            "lastPurge": run_wire(runs.last_purge),
            "lastCleanup": run_wire(runs.last_cleanup),
            "lastExport": export_wire(exports[0]) if exports else None,
            "uploads": {
                "stored": uploaded_asset_count(store),
                "cap": MAX_UPLOADED_ASSETS,
                "unused": unused_upload_count(store, now),
            },
            "exports": [export_wire(item) for item in exports],
            "paused": read_collector_setting(store).paused,
        }

    async def status(self) -> dict[str, Any]:
        return await self._thread(self._status)

    # ---- actions --------------------------------------------------------------------------

    async def set_retention(self, body: object) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) != {"retentionDays"}:
            raise DataError("invalid_body", 400)
        days = body["retentionDays"]
        if days is not None and (_strict_int(days) is None or days not in RETENTION_CHOICES):
            raise DataError("invalid_body", 400)

        def action() -> dict[str, Any]:
            set_retention(self._store, days, self._clock())
            return self._status()

        return await self._thread(self._exclusively(action))

    async def purge(self, body: object) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) != {"retentionDays"}:
            raise DataError("invalid_body", 400)
        requested = _strict_int(body["retentionDays"])
        if requested is None or requested not in RETENTION_CHOICES:
            raise DataError("invalid_body", 400)

        def action() -> dict[str, Any]:
            saved = get_retention(self._store).retention_days
            if saved is None:
                raise DataError("retention_not_set", 409)
            if saved != requested:
                raise DataError("retention_mismatch", 409)
            cutoff = cutoff_for(saved, self._clock())
            try:
                pre_lifecycle_backup(self._store, "purge")
            except BackupError as error:
                raise DataError("backup_failed", 500) from error
            run_purge(self._store, cutoff, self._clock)
            return self._status()

        return await self._thread(self._exclusively(action))

    async def export(self, body: object) -> dict[str, Any]:
        if body != {}:
            raise DataError("invalid_body", 400)

        def action() -> dict[str, Any]:
            try:
                export_database(self._store)
            except BackupError as error:
                raise DataError("export_failed", 500) from error
            return self._status()

        return await self._thread(self._exclusively(action))

    async def asset_cleanup(self, body: object) -> dict[str, Any]:
        if body != {}:
            raise DataError("invalid_body", 400)

        def action() -> dict[str, Any]:
            try:
                pre_lifecycle_backup(self._store, "cleanup")
            except BackupError as error:
                raise DataError("backup_failed", 500) from error
            run_asset_cleanup(self._store, self._clock)
            return self._status()

        return await self._thread(self._exclusively(action))

    # ---- collector pause ------------------------------------------------------------------

    async def set_collector(self, collector: CollectorLike | None, body: object) -> dict[str, Any]:
        """Pause or resume collection through the supervisor. Setting the value already in force
        changes nothing. The supervisor records the `paused` coverage gap itself."""
        if (
            not isinstance(body, dict)
            or set(body) != {"paused"}
            or not isinstance(body["paused"], bool)
        ):
            raise DataError("invalid_body", 400)
        wanted: bool = body["paused"]
        if collector is None:
            raise DataError("collector_unavailable", 503)
        current = await self._thread(lambda: read_collector_setting(self._store))
        if current.paused != wanted:
            await (collector.pause() if wanted else collector.resume())
            current = await self._thread(lambda: read_collector_setting(self._store))
            if current.paused != wanted:  # a halted collector ignores both calls
                raise DataError("collector_unavailable", 503)
        state = str(collector.status().state)
        return {
            "contractVersion": COLLECTOR_CONTRACT_VERSION,
            "paused": current.paused,
            "revision": current.revision,
            "changedAtMs": current.changed_at_ms,
            "state": state if _STATE.fullmatch(state) else "unavailable",
        }
