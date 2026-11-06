import json
from pathlib import Path
from typing import Any

MANIFEST_PATH = Path(__file__).resolve().parents[2] / "app.json"

IDENTITY_FIELDS = {"name", "version", "displayName", "description"}
BACKEND_FIELDS = {"entryPoint", "type", "healthCheck", "routes"}
FORBIDDEN_TOP_LEVEL = {"minKiroCrewVersion", "permissions", "crons", "agents", "signedPrincipal"}


def load_manifest() -> dict[str, Any]:
    manifest: dict[str, Any] = json.loads(MANIFEST_PATH.read_text())
    return manifest


def test_manifest_has_identity_and_backend_only() -> None:
    assert set(load_manifest()) == IDENTITY_FIELDS | {"backend"}


def test_manifest_identity() -> None:
    manifest = load_manifest()
    assert manifest["name"] == "specter-arena"
    assert manifest["version"] == "0.0.0"


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
    assert "ui" not in manifest
    assert "hooks" not in manifest["backend"]
    assert "port" not in manifest["backend"]


def test_entry_point_exists() -> None:
    assert (MANIFEST_PATH.parent / load_manifest()["backend"]["entryPoint"]).is_file()
