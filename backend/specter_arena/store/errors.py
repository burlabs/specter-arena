from __future__ import annotations


class StoreError(Exception):
    """Base store error. `code` is the stable reason; messages never carry paths or driver text.

    A driver exception is only ever attached as `__cause__`.
    """

    code = "unavailable"

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.code)


class StoreUnconfigured(StoreError):
    code = "unconfigured"


class SqliteTooOld(StoreError):
    code = "sqlite-too-old"


class SchemaNewer(StoreError):
    code = "schema-newer"


class StoreUnavailable(StoreError):
    code = "unavailable"


class MigrationFileError(StoreError):
    """The packaged migration set is malformed: numbering, file name or a forbidden statement."""


class MigrationError(StoreError):
    """A migration failed and was rolled back, or an applied migration no longer matches."""


class ChecksumMismatch(MigrationError):
    pass


class StoreClosed(StoreError):
    pass


class StoreUsageError(StoreError):
    """A programming error, such as a nested `write()` on the thread that already holds it."""


class BackupError(StoreError):
    pass


class RestoreError(StoreError):
    pass


class InvalidCursor(StoreError, ValueError):
    code = "invalid-cursor"


class UnknownRun(StoreError):
    code = "unknown-run"


class UnknownBinding(StoreError):
    code = "unknown-binding"


class VersionConflict(StoreError):
    """The caller's expected Specter version is not the current one (0 means no active Specter)."""

    code = "version-conflict"

    def __init__(self, current_version: int) -> None:
        super().__init__()
        self.current_version = current_version


class UnknownSpecter(StoreError):
    code = "unknown-specter"


class UnknownRequest(StoreError):
    code = "unknown-request"


class UnknownAsset(StoreError):
    code = "unknown-asset"


class GenerationInFlight(StoreError):
    code = "generation-in-flight"


class BudgetExhausted(StoreError):
    code = "budget-exhausted"


class NotReady(StoreError):
    """Accept was asked for a request that is not `ready`."""

    code = "not-ready"
