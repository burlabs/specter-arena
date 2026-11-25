import json
from pathlib import Path
from typing import Any

from backend.specter_arena.config import read_grants

MANIFEST_PATH = Path(__file__).resolve().parents[2] / "app.json"

IDENTITY_FIELDS = {"name", "version", "displayName", "description", "minKiroCrewVersion"}
ICON_FIELDS = {"iconPath", "iconPathDark"}
# The app store listing (FP-25). Crew reads these from the manifest's extra fields, so none of
# them is a grant or a backend setting.
LISTING_FIELDS = {
    "author",
    "tags",
    "highlights",
    "platform",
    "useCases",
    "configuration",
    "heroImage",
    "heroImageDark",
    "screenshots",
    "screenshotsDark",
}
# The fields Crew 0.13.0's `UIPage.from_dict` reads (kiro_crew/apps/manifest_sections.py); any
# other page key is dropped silently, so a misspelt icon field would fall back to the default box.
HOST_UI_PAGE_FIELDS = {
    "route",
    "label",
    "icon",
    "iconUrl",
    "iconInactiveUrl",
    "entryPoint",
    "mountFunction",
}
APP_ROOT = Path(__file__).resolve().parents[2]
BACKEND_FIELDS = {"entryPoint", "type", "healthCheck", "routes"}
OWN_NAMESPACE_API = "/apps/specter-arena/api/*"
AGENTS_API_ENTRY = "/api/agents"
SLOTS_EVENT = "slots:user"
DENIED_API_PATHS = (
    "/api/usage",
    "/api/usage/turns",
    "/api/sessions/usage",
    "/api/members",
    "/api/members/probe",
    "/api/member-records",
    "/api/member-records/probe",
    "/api/spawn",
    "/api/jobs",
    "/api/chatx",
    "/api/chat",
    "/api/chat/slots",
    "/api/chat/slots/specter-summon-x",
)
FORBIDDEN_TOP_LEVEL = {"crons", "signedPrincipal"}


def load_manifest() -> dict[str, Any]:
    manifest: dict[str, Any] = json.loads(MANIFEST_PATH.read_text())
    return manifest


def test_manifest_has_identity_backend_and_ui_only() -> None:
    assert set(load_manifest()) == IDENTITY_FIELDS | ICON_FIELDS | LISTING_FIELDS | {
        "backend",
        "permissions",
        "ui",
    }


def test_manifest_identity() -> None:
    manifest = load_manifest()
    assert manifest["name"] == "specter-arena"
    assert manifest["version"] == "0.1.0"


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


def test_manifest_declares_exactly_the_release_grants() -> None:
    # The SDK rejects any path not listed here, including the app's own proxy namespace.
    # The app generates nothing (PA-2), so there is no chat grant and no agent.
    assert load_manifest()["permissions"] == {
        "api": [OWN_NAMESPACE_API, AGENTS_API_ENTRY],
        "events": [SLOTS_EVENT],
    }


def test_no_grant_reaches_usage_members_or_member_records() -> None:
    grants = read_grants(MANIFEST_PATH)
    assert grants.basis == "manifest" and grants.missing() == ()
    for path in DENIED_API_PATHS:
        assert not grants.has_api(path), path
    assert grants.events == frozenset({SLOTS_EVENT})
    assert not grants.has_event("subagent:user")


def test_the_release_has_no_agents_directory() -> None:
    assert not (MANIFEST_PATH.parent / "agents").exists()


def test_the_only_permission_sections_are_api_and_events() -> None:
    assert set(load_manifest()["permissions"]) == {"api", "events"}


def test_the_own_namespace_entry_comes_first_and_the_api_list_has_no_duplicates() -> None:
    api = load_manifest()["permissions"]["api"]
    assert api[0] == OWN_NAMESPACE_API
    assert len(api) == len(set(api))


def test_own_namespace_permission_matches_the_page_call_paths() -> None:
    prefix = OWN_NAMESPACE_API.removesuffix("/*")
    stub = (MANIFEST_PATH.parent / "ui" / "src" / "host" / "paths.ts").read_text()
    assert f"APP_API_PREFIX = '{prefix}'" in stub


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
        "pages": [
            {
                "route": "/apps/specter-arena",
                "label": "Specters of the Abyss",
                "icon": "Package",
                "iconUrl": "icons/logo-active@2x.png",
                "iconInactiveUrl": "icons/logo-inactive@2x.png",
            }
        ],
    }


def test_every_page_key_is_one_the_host_ui_page_reads() -> None:
    for page in load_manifest()["ui"]["pages"]:
        assert set(page) <= HOST_UI_PAGE_FIELDS


def test_page_icons_resolve_under_ui_and_app_icons_under_the_app_root() -> None:
    # Crew serves `iconUrl`/`iconInactiveUrl` from /apps/<name>/ui/<path> and the top-level
    # `iconPath`/`iconPathDark` from /apps/<name>/art/<path>, relative to the install root.
    manifest = load_manifest()
    page = manifest["ui"]["pages"][0]
    for key in ("iconUrl", "iconInactiveUrl"):
        assert (APP_ROOT / "ui" / page[key]).is_file(), key
    for key in sorted(ICON_FIELDS):
        assert (APP_ROOT / manifest[key]).is_file(), key


def test_ui_entry_is_where_the_build_writes_it() -> None:
    # Crew serves an app's UI files from its ui/ directory, so the entry is ui-relative.
    vite_config = (MANIFEST_PATH.parent / "ui" / "vite.config.ts").read_text()
    assert "outDir: fromUi('./dist')" in vite_config
    assert "fileName: () => 'index.mjs'" in vite_config
