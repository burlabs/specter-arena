import os
import sqlite3
import stat
from pathlib import Path

import pytest

from backend.specter_arena.store import (
    SqliteTooOld,
    StoreError,
    StoreUnavailable,
    resolve_data_dir,
)
from backend.specter_arena.store.location import (
    SQLITE_FLOOR,
    check_sqlite_version,
    db_path,
    ensure_private_dir,
    precreate_private_file,
    store_dir,
)

posix_only = pytest.mark.skipif(os.name != "posix", reason="file modes are POSIX-only")


def env(home: Path | str, name: str = "specter-arena") -> dict[str, str]:
    return {"KIROCREW_HOME": str(home), "KIROCREW_APP_NAME": name}


def mode(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def test_the_data_dir_is_the_apps_entry_under_the_crew_home(tmp_path: Path) -> None:
    resolved = resolve_data_dir(env(tmp_path))
    assert resolved == (tmp_path / "apps" / "specter-arena" / "data").resolve()


def test_resolving_creates_nothing(tmp_path: Path) -> None:
    home = tmp_path / "home"
    assert resolve_data_dir(env(home)) is not None
    assert not home.exists()


@pytest.mark.parametrize(
    "environ",
    [
        {},
        {"KIROCREW_APP_NAME": "specter-arena"},
        {"KIROCREW_HOME": "", "KIROCREW_APP_NAME": "specter-arena"},
        {"KIROCREW_HOME": "/abs/home"},
        {"KIROCREW_HOME": "/abs/home", "KIROCREW_APP_NAME": ""},
    ],
)
def test_a_missing_or_empty_variable_gives_none(environ: dict[str, str]) -> None:
    assert resolve_data_dir(environ) is None


@pytest.mark.parametrize(
    "name", ["../x", "A", "a_b", "a" * 65, "-a", "a/b", ".", "..", "a b", "spécter", "a\n"]
)
def test_a_malformed_app_name_gives_none(tmp_path: Path, name: str) -> None:
    assert resolve_data_dir(env(tmp_path, name)) is None


def test_the_longest_valid_name_is_accepted(tmp_path: Path) -> None:
    assert resolve_data_dir(env(tmp_path, "a" * 64)) is not None


def test_a_relative_home_gives_none() -> None:
    assert resolve_data_dir(env("relative/home")) is None
    assert resolve_data_dir(env(".")) is None


def test_an_app_entry_symlinked_outside_the_apps_dir_gives_none(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    apps = tmp_path / "home" / "apps"
    apps.mkdir(parents=True)
    (apps / "specter-arena").symlink_to(outside, target_is_directory=True)
    assert resolve_data_dir(env(tmp_path / "home")) is None


def test_a_data_dir_symlinked_outside_the_apps_dir_gives_none(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    entry = tmp_path / "home" / "apps" / "specter-arena"
    entry.mkdir(parents=True)
    (entry / "data").symlink_to(outside, target_is_directory=True)
    assert resolve_data_dir(env(tmp_path / "home")) is None


def test_a_symlinked_home_resolves_to_the_same_data_dir(tmp_path: Path) -> None:
    real = tmp_path / "real-home"
    real.mkdir()
    link = tmp_path / "link-home"
    link.symlink_to(real, target_is_directory=True)
    assert resolve_data_dir(env(link)) == resolve_data_dir(env(real))


def test_store_paths_sit_under_the_data_dir(tmp_path: Path) -> None:
    assert store_dir(tmp_path) == tmp_path / "store"
    assert db_path(tmp_path) == tmp_path / "store" / "specter-arena.db"


def test_the_runtime_sqlite_meets_the_floor() -> None:
    assert sqlite3.sqlite_version_info >= SQLITE_FLOOR, sqlite3.sqlite_version
    check_sqlite_version()


def test_the_runtime_sqlite_supports_strict_tables(tmp_path: Path) -> None:
    conn = sqlite3.connect(tmp_path / "strict.db")
    try:
        conn.execute("CREATE TABLE t (n INTEGER NOT NULL) STRICT")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO t (n) VALUES ('not a number')")
    finally:
        conn.close()


def test_an_old_sqlite_is_refused() -> None:
    with pytest.raises(SqliteTooOld) as caught:
        check_sqlite_version((3, 36, 9))
    assert caught.value.code == "sqlite-too-old"
    check_sqlite_version((3, 37, 0))


def test_the_floor_check_reads_the_linked_library(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sqlite3, "sqlite_version_info", (3, 31, 1))
    with pytest.raises(SqliteTooOld):
        check_sqlite_version()


@posix_only
def test_a_private_dir_is_created_owner_only(tmp_path: Path) -> None:
    target = tmp_path / "data" / "store"
    ensure_private_dir(target)
    assert target.is_dir()
    assert mode(target) == 0o700


@posix_only
def test_an_existing_dir_is_tightened_to_owner_only(tmp_path: Path) -> None:
    target = tmp_path / "store"
    target.mkdir(mode=0o755)
    target.chmod(0o755)
    ensure_private_dir(target)
    assert mode(target) == 0o700


def test_a_dir_that_cannot_be_created_is_unavailable(tmp_path: Path) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("")
    with pytest.raises(StoreUnavailable) as caught:
        ensure_private_dir(blocker / "store")
    assert isinstance(caught.value.__cause__, OSError)
    assert str(tmp_path) not in str(caught.value)


@posix_only
def test_a_precreated_file_is_owner_only_and_empty(tmp_path: Path) -> None:
    target = tmp_path / "specter-arena.db"
    precreate_private_file(target)
    assert target.read_bytes() == b""
    assert mode(target) == 0o600


def test_precreating_leaves_an_existing_file_alone(tmp_path: Path) -> None:
    target = tmp_path / "specter-arena.db"
    target.write_bytes(b"kept")
    precreate_private_file(target)
    assert target.read_bytes() == b"kept"


def test_a_file_that_cannot_be_created_is_unavailable(tmp_path: Path) -> None:
    with pytest.raises(StoreUnavailable) as caught:
        precreate_private_file(tmp_path / "missing" / "specter-arena.db")
    assert isinstance(caught.value, StoreError)
    assert isinstance(caught.value.__cause__, OSError)
    assert caught.value.code == "unavailable"
