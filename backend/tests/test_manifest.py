import json
from pathlib import Path
from typing import Any

MANIFEST_PATH = Path(__file__).resolve().parents[2] / "app.json"

IDENTITY_FIELDS = {"name", "version", "displayName", "description", "minKiroCrewVersion"}
BACKEND_FIELDS = {"entryPoint", "type", "healthCheck", "routes"}
FORBIDDEN_TOP_LEVEL = {"permissions", "crons", "agents", "signedPrincipal"}


def load_manifest() -> dict[str, Any]:
    manifest: dict[str, Any] = json.loads(MANIFEST_PATH.read_text())
    return manifest


def test_manifest_has_identity_backend_and_ui_only() -> None:
    assert set(load_manifest()) == IDENTITY_FIELDS | {"backend", "ui"}


def test_manifest_identity() -> None:
    manifest = load_manifest()
    assert manifest["name"] == "specter-arena"
    assert manifest["version"] == "0.0.0"


def test_manifest_pins_the_probed_crew_version() -> None:
    assert load_manifest()["minKiroCrewVersion"] == "0.12.0"


def test_backend_section_matches_the_crew_runtime_contract() -> None:
    backend = load_manifest()["backend"]
    assert set(backend) == BACKEND_FIELDS
    assert backend == {
        "entryPoint": "backend/app.py",
        "type": "asgi",
        "healthCheck": "/health",
        "routes": "/api/apps/specter-arena",
    }


def test_manifest_omits_fields_reserved_for_later_sessions() -> None:
    manifest = load_manifest()
    assert FORBIDDEN_TOP_LEVEL.isdisjoint(manifest)
    assert "mountFunction" not in manifest["ui"]
    assert "hooks" not in manifest["backend"]
    assert "port" not in manifest["backend"]


def test_entry_point_exists() -> None:
    assert (MANIFEST_PATH.parent / load_manifest()["backend"]["entryPoint"]).is_file()


def test_ui_section_points_at_the_library_bundle_and_app_route() -> None:
    assert load_manifest()["ui"] == {
        "entry": "dist/index.mjs",
        "pages": [{"route": "/apps/specter-arena", "label": "Specter Arena", "icon": "Package"}],
    }


def test_ui_entry_is_where_the_build_writes_it() -> None:
    # Crew serves an app's UI files from its ui/ directory, so the entry is ui-relative.
    vite_config = (MANIFEST_PATH.parent / "ui" / "vite.config.ts").read_text()
    assert "outDir: fromUi('./dist')" in vite_config
    assert "fileName: () => 'index.mjs'" in vite_config
