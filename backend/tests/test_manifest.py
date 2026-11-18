import json
from pathlib import Path
from typing import Any

from backend.specter_arena.config import read_grants

MANIFEST_PATH = Path(__file__).resolve().parents[2] / "app.json"

IDENTITY_FIELDS = {"name", "version", "displayName", "description", "minKiroCrewVersion"}
BACKEND_FIELDS = {"entryPoint", "type", "healthCheck", "routes"}
OWN_NAMESPACE_API = "/apps/specter-arena/api/*"
AGENTS_API_ENTRY = "/api/agents"
CHAT_API_ENTRY = "/api/chat"
SUMMONER_AGENT_FILE = "agents/specter-summoner.json"
SUMMONER_AGENT_NAME = "specter-arena-summoner"
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
)
FORBIDDEN_TOP_LEVEL = {"crons", "signedPrincipal"}


def load_manifest() -> dict[str, Any]:
    manifest: dict[str, Any] = json.loads(MANIFEST_PATH.read_text())
    return manifest


def test_manifest_has_identity_backend_and_ui_only() -> None:
    assert set(load_manifest()) == IDENTITY_FIELDS | {"agents", "backend", "permissions", "ui"}


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


def test_manifest_declares_exactly_the_release_grants() -> None:
    # The SDK rejects any path not listed here, including the app's own proxy namespace.
    # /api/chat is the summoning grant (FP-06+07, approved 2026-11-18); nothing else is added.
    assert load_manifest()["permissions"] == {
        "api": [OWN_NAMESPACE_API, AGENTS_API_ENTRY, CHAT_API_ENTRY],
        "events": [SLOTS_EVENT],
    }


def test_no_grant_reaches_usage_members_or_member_records() -> None:
    grants = read_grants(MANIFEST_PATH)
    assert grants.basis == "manifest" and grants.missing() == ()
    for path in DENIED_API_PATHS:
        assert not grants.has_api(path), path
    assert grants.events == frozenset({SLOTS_EVENT})
    assert not grants.has_event("subagent:user")


def test_the_chat_grant_matches_its_children_by_the_host_rule() -> None:
    # The host matches a bare entry against child paths, so /api/chat also covers
    # /api/chat/slots; Crew confines the app token to its own slots, and the summoner source
    # guard (test_summoner_source_guard.py) pins that the app never issues GET /api/chat/slots.
    grants = read_grants(MANIFEST_PATH)
    assert grants.has_api("/api/chat") and grants.has_api("/api/chat/slots/specter-summon-x")


def test_the_manifest_lists_exactly_the_tool_free_summoner_agent() -> None:
    manifest = load_manifest()
    assert manifest["agents"] == [SUMMONER_AGENT_FILE]
    agent = json.loads((MANIFEST_PATH.parent / SUMMONER_AGENT_FILE).read_text())
    assert agent["name"] == SUMMONER_AGENT_NAME
    assert agent["tools"] == [] and agent["allowedTools"] == [] and agent["mcpServers"] == {}
    assert agent["includeMcpJson"] is False
    assert agent["model"] == "auto"
    assert set(agent) == {
        "name",
        "description",
        "model",
        "prompt",
        "tools",
        "allowedTools",
        "mcpServers",
        "includeMcpJson",
    }


def test_the_only_permission_sections_are_api_and_events() -> None:
    assert set(load_manifest()["permissions"]) == {"api", "events"}


def test_the_summoner_client_names_the_manifest_agent() -> None:
    from backend.specter_arena.summoner.client import SUMMON_AGENT

    assert SUMMON_AGENT == SUMMONER_AGENT_NAME


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
        "pages": [{"route": "/apps/specter-arena", "label": "Specter Arena", "icon": "Package"}],
    }


def test_ui_entry_is_where_the_build_writes_it() -> None:
    # Crew serves an app's UI files from its ui/ directory, so the entry is ui-relative.
    vite_config = (MANIFEST_PATH.parent / "ui" / "vite.config.ts").read_text()
    assert "outDir: fromUi('./dist')" in vite_config
    assert "fileName: () => 'index.mjs'" in vite_config
