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
    """The caller's expected avatar version is not the current one (0 means none chosen yet)."""

    code = "version-conflict"

    def __init__(self, current_version: int) -> None:
        super().__init__()
        self.current_version = current_version


class UnknownAsset(StoreError):
    code = "unknown-asset"


class UnknownWork(StoreError):
    code = "unknown-work"


class UnknownAttempt(StoreError):
    """The attempt id is not in the `attempt` projection."""

    code = "unknown-attempt"


class AttemptAlreadyLinked(StoreError):
    code = "attempt-already-linked"


class AttemptNotEligible(StoreError):
    """The attempt exists but is not a `bot-turn` or `worker` attempt."""

    code = "attempt-not-eligible"


class InvalidTransition(StoreError):
    """The action is not legal from the work item's current state, or the item is closed."""

    code = "invalid-transition"


class StaleEvidence(StoreError):
    """The evidence revision the reviewer echoed is not the one the store computes now."""

    code = "stale-evidence"


class AttemptsNotEnded(StoreError):
    """A linked attempt is still running, or no longer present in the projection."""

    code = "attempts-not-ended"


class NoEvidence(StoreError):
    """Accept was asked for a leaf work item with no linked attempt."""

    code = "no-evidence"


class ChildrenNotAccepted(StoreError):
    code = "children-not-accepted"


class ParentLocked(StoreError):
    """The parent already has XP, or is accepted or cancelled, so it cannot take a child."""

    code = "parent-locked"


class ContributorsFrozen(StoreError):
    """XP exists for the item, so only an existing contributor's attempts may be linked."""

    code = "contributors-frozen"


class RequestReused(StoreError):
    """A request token was seen before with different fields."""

    code = "request-reused"


class LimitReached(StoreError):
    code = "limit-reached"


class UploadLimitReached(StoreError):
    """The store already holds the most uploaded assets it will keep, and the image is new."""

    code = "upload-limit-reached"


class LifecycleBusy(StoreError):
    """Another purge or cleanup run is open on this store."""

    code = "lifecycle-busy"
