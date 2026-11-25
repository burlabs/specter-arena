import logging
from pathlib import Path

import pytest
from starlette.testclient import TestClient

import backend.app as app_module


def test_a_missing_bundle_logs_one_warning_and_reports_missing(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger="specter_arena.app"):
        missing = app_module.warn_when_ui_bundle_missing(tmp_path / "ui" / "dist" / "index.mjs")
    assert missing is True
    assert [record.getMessage() for record in caplog.records] == [
        "ui/dist/index.mjs not found; the UI will not load. "
        "Build with Node 22+ and npm on the Crew gateway PATH."
    ]


def test_a_directory_in_place_of_the_bundle_counts_as_missing(tmp_path: Path) -> None:
    assert app_module.warn_when_ui_bundle_missing(tmp_path) is True


def test_a_present_bundle_logs_nothing(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    bundle = tmp_path / "index.mjs"
    bundle.write_text("export {}\n")
    with caplog.at_level(logging.WARNING, logger="specter_arena.app"):
        missing = app_module.warn_when_ui_bundle_missing(bundle)
    assert missing is False
    assert caplog.records == []


def test_the_default_path_is_the_app_root_ui_bundle() -> None:
    expected = Path(app_module.__file__).resolve().parent.parent / "ui" / "dist" / "index.mjs"
    assert expected == app_module.UI_BUNDLE


def test_the_lifespan_checks_the_bundle(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    def record(bundle: Path | None = None) -> bool:
        seen.append("checked")
        return False

    monkeypatch.setattr(app_module, "warn_when_ui_bundle_missing", record)
    with TestClient(app_module.app):
        pass
    assert seen == ["checked"]
