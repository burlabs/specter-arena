from pathlib import Path

import pytest

from backend.specter_arena.store import (
    BackupError,
    InvalidCursor,
    MigrationError,
    SchemaNewer,
    SqliteTooOld,
    StoreError,
    StoreStatus,
    StoreUnavailable,
    StoreUnconfigured,
    disabled_status,
    latest_version,
    migrating_status,
    status_for_error,
    unconfigured_status,
)


def test_the_constructors_report_no_store_version_and_the_latest_known() -> None:
    latest = latest_version()
    assert unconfigured_status() == StoreStatus("unconfigured", None, latest)
    assert migrating_status() == StoreStatus("migrating", None, latest)
    assert disabled_status() == StoreStatus("disabled", None, latest)


@pytest.mark.parametrize(
    ("error", "state"),
    [
        (StoreUnconfigured(), "unconfigured"),
        (SchemaNewer(), "schema-newer"),
        (SqliteTooOld(), "sqlite-too-old"),
        (StoreUnavailable(), "unavailable"),
        (MigrationError(), "unavailable"),
        (BackupError(), "unavailable"),
        (InvalidCursor(), "unavailable"),
        (StoreError(), "unavailable"),
        (RuntimeError("boom"), "unavailable"),
        (KeyboardInterrupt(), "unavailable"),
    ],
)
def test_errors_map_to_a_state_by_type(error: BaseException, state: str) -> None:
    status = status_for_error(error)
    assert status.state == state
    assert status.store_version is None
    assert status.latest_version == latest_version()


def test_a_known_store_version_is_kept() -> None:
    assert status_for_error(SchemaNewer(), store_version=9).store_version == 9


def test_a_status_carries_no_path_or_message(tmp_path: Path) -> None:
    private_path = str(tmp_path / "home" / "apps" / "specter-arena" / "data")
    error = StoreUnavailable(f"cannot open {private_path}")
    error.__cause__ = OSError(13, "Permission denied", private_path)
    for status in (status_for_error(error), status_for_error(RuntimeError(private_path))):
        assert private_path not in repr(status)
        assert "Permission" not in repr(status)
        assert set(vars(status)) == {"state", "store_version", "latest_version"}


def test_a_status_is_immutable() -> None:
    status = unconfigured_status()
    with pytest.raises(AttributeError):
        status.state = "ready"  # type: ignore[misc]
