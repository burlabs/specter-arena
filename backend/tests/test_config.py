import json
from pathlib import Path

import pytest

from backend.specter_arena.config import (
    AGENTS_API_ENTRY,
    APP_ROOT,
    OWN_API_ENTRY,
    REQUIRED_API_PATHS,
    REQUIRED_EVENTS,
    GatewayEnv,
    Grants,
    gateway_env,
    probe_enabled,
    read_grants,
)


def test_gateway_env_reads_the_values_crew_injects() -> None:
    env = gateway_env(
        {
            "KIROCREW_PROXY_SECRET": "s",
            "KIROCREW_GATEWAY_ORIGIN": "http://127.0.0.1:5476",
            "PORT": "9100",
            "KIROCREW_APP_NAME": "specter-arena",
        }
    )
    assert env == GatewayEnv(
        secret="s", origin="http://127.0.0.1:5476", port="9100", app_name="specter-arena"
    )


def test_gateway_env_defaults_to_empty_strings() -> None:
    assert gateway_env({}) == GatewayEnv(secret="", origin="", port="", app_name="")


def test_gateway_env_reads_the_process_environment_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", "from-process")
    assert gateway_env().secret == "from-process"


def test_probe_is_off_by_default(tmp_path: Path) -> None:
    assert probe_enabled({}, tmp_path) is False


def test_probe_is_on_with_the_env_switch(tmp_path: Path) -> None:
    assert probe_enabled({"SPECTER_PROBE": "1"}, tmp_path) is True
    assert probe_enabled({"SPECTER_PROBE": "0"}, tmp_path) is False
    assert probe_enabled({"SPECTER_PROBE": "true"}, tmp_path) is False


def test_probe_is_on_when_the_switch_file_exists(tmp_path: Path) -> None:
    (tmp_path / ".probe-enabled").write_text("")
    assert probe_enabled({}, tmp_path) is True


def test_a_switch_directory_is_not_a_switch_file(tmp_path: Path) -> None:
    (tmp_path / ".probe-enabled").mkdir()
    assert probe_enabled({}, tmp_path) is False


def test_probe_reads_the_process_environment_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SPECTER_PROBE", "1")
    assert probe_enabled() is True


OVERLAY = json.loads((APP_ROOT / "probe" / "manifest-overlay.json").read_text())
V1_PERMISSIONS = OVERLAY["permissions"]
PHASE_PERMISSIONS = {
    "v0": {"api": [OWN_API_ENTRY]},
    "v1": V1_PERMISSIONS,
    "v2": {**V1_PERMISSIONS, "api": [*V1_PERMISSIONS["api"], "/api/version"]},
}


def declared(path: Path) -> tuple[bool, str]:
    grants = read_grants(path)
    return grants.beyond_own_entry, grants.basis


def write_manifest(tmp_path: Path, manifest: object) -> Path:
    path = tmp_path / "app.json"
    path.write_text(json.dumps(manifest))
    return path


@pytest.mark.parametrize(
    ("phase", "declared"), [("v0", False), ("v1", True), ("v2", True)], ids=["v0", "v1", "v2"]
)
def test_read_grants_follows_the_staged_phase_manifest(
    tmp_path: Path, phase: str, declared: bool
) -> None:
    grants = read_grants(write_manifest(tmp_path, {"permissions": PHASE_PERMISSIONS[phase]}))
    assert (grants.beyond_own_entry, grants.basis) == (declared, "manifest")


def test_read_grants_reads_the_release_manifest_grants() -> None:
    grants = read_grants()
    assert (grants.beyond_own_entry, grants.basis) == (True, "manifest")
    assert grants.api == {OWN_API_ENTRY, AGENTS_API_ENTRY}
    assert grants.events == {"slots:user"}


def test_read_grants_treats_missing_permission_keys_as_none_declared(tmp_path: Path) -> None:
    assert declared(write_manifest(tmp_path, {})) == (False, "manifest")
    assert declared(write_manifest(tmp_path, {"permissions": {}})) == (False, "manifest")


def test_read_grants_counts_an_event_alone_and_an_extra_api_entry_alone(tmp_path: Path) -> None:
    events_only = {"api": [OWN_API_ENTRY], "events": ["slots:user"]}
    assert declared(write_manifest(tmp_path, {"permissions": events_only}))[0] is True
    other_api = {"api": [OWN_API_ENTRY, "/api/agents"], "events": []}
    assert declared(write_manifest(tmp_path, {"permissions": other_api}))[0] is True
    assert declared(write_manifest(tmp_path, {"permissions": {"api": []}}))[0] is False


def test_read_grants_fails_closed_when_the_file_is_missing_or_not_json(tmp_path: Path) -> None:
    assert declared(tmp_path / "absent.json") == (
        True,
        "manifest-unreadable: FileNotFoundError",
    )
    broken = tmp_path / "app.json"
    broken.write_text("{")
    assert declared(broken) == (True, "manifest-unreadable: JSONDecodeError")


@pytest.mark.parametrize(
    "manifest",
    [[], {"permissions": []}, {"permissions": {"api": "x"}}, {"permissions": {"events": {}}}],
    ids=["not-object", "permissions-list", "api-string", "events-object"],
)
def test_read_grants_fails_closed_on_an_unexpected_shape(tmp_path: Path, manifest: object) -> None:
    beyond, basis = declared(write_manifest(tmp_path, manifest))
    assert beyond is True
    assert basis.startswith("manifest-unreadable: ")


def test_a_bare_api_entry_matches_itself_and_its_children_only() -> None:
    grants = Grants(frozenset({"/api/agents"}), frozenset(), "manifest")
    assert grants.has_api("/api/agents")
    assert grants.has_api("/api/agents/probe")
    assert not grants.has_api("/api/agentsx")
    assert not grants.has_api("/api/usage")


def test_a_wildcard_api_entry_matches_children_but_not_the_prefix() -> None:
    grants = Grants(frozenset({"/api/member-records/*"}), frozenset(), "manifest")
    assert grants.has_api("/api/member-records/probe")
    assert not grants.has_api("/api/member-records")
    assert not grants.has_api("/api/members/probe")


def test_events_match_exactly_and_unknown_grants_answer_yes() -> None:
    grants = Grants(frozenset(), frozenset({"slots:user"}), "manifest")
    assert grants.has_event("slots:user")
    assert not grants.has_event("subagent:user")
    assumed = Grants.assumed("manifest-unreadable: OSError")
    assert assumed.has_event("subagent:user")
    assert assumed.has_api("/api/anything")
    assert assumed.beyond_own_entry
    assert not Grants.none().beyond_own_entry
    assert not Grants.none().has_api("/api/agents")


def test_read_grants_with_the_d_p1_manifest_grants_exactly_its_entries(tmp_path: Path) -> None:
    permissions = {
        "api": [OWN_API_ENTRY, "/api/agents", "/api/usage", "/api/sessions/usage"],
        "events": ["slots:user", "subagent:user"],
    }
    grants = read_grants(write_manifest(tmp_path, {"permissions": permissions}))
    assert grants.basis == "manifest"
    assert grants.has_api("/api/agents")
    assert grants.has_api("/api/usage") and grants.has_api("/api/sessions/usage")
    assert not grants.has_api("/api/member-records/probe")
    assert not grants.has_api("/api/chat/slots")
    assert grants.has_api("/apps/specter-arena/api/ping")
    assert grants.has_event("subagent:user")


@pytest.mark.parametrize(
    "manifest",
    [{"permissions": {"api": "nope"}}, {"permissions": {"api": [5]}}, "not an object"],
    ids=["api-not-list", "entry-not-string", "not-object"],
)
def test_a_malformed_manifest_fails_closed_to_assumed(tmp_path: Path, manifest: object) -> None:
    grants = read_grants(write_manifest(tmp_path, manifest))
    assert grants.unknown
    assert grants.basis.startswith("manifest-unreadable: ")


def test_a_missing_manifest_names_the_error(tmp_path: Path) -> None:
    assert read_grants(tmp_path / "absent.json").basis == "manifest-unreadable: FileNotFoundError"


D_P9_PERMISSIONS = {
    "api": [OWN_API_ENTRY, AGENTS_API_ENTRY],
    "events": ["slots:user"],
}


def test_the_d_p9_manifest_has_no_missing_grant(tmp_path: Path) -> None:
    grants = read_grants(write_manifest(tmp_path, {"permissions": D_P9_PERMISSIONS}))
    assert grants.missing() == ()


def test_the_release_manifest_declares_every_collector_grant() -> None:
    assert read_grants(APP_ROOT / "app.json").missing() == ()


def test_missing_names_each_absent_grant_separately() -> None:
    only_event = Grants(frozenset({OWN_API_ENTRY}), frozenset({"slots:user"}), "manifest")
    assert only_event.missing() == (f"api:{AGENTS_API_ENTRY}",)
    only_agents = Grants(frozenset({OWN_API_ENTRY, AGENTS_API_ENTRY}), frozenset(), "manifest")
    assert only_agents.missing() == ("event:slots:user",)
    assert Grants.none().missing() == (
        "event:slots:user",
        "api:/apps/specter-arena/api/ping",
        f"api:{AGENTS_API_ENTRY}",
    )


def test_unknown_grants_report_nothing_missing_so_the_host_decides() -> None:
    assert Grants.assumed("manifest-unreadable: OSError").missing() == ()


def test_the_own_namespace_wildcard_admits_the_required_own_path() -> None:
    own_only = Grants(frozenset({OWN_API_ENTRY}), frozenset({"slots:user"}), "manifest")
    assert own_only.has_api(REQUIRED_API_PATHS[0])
    assert REQUIRED_API_PATHS[1] == AGENTS_API_ENTRY
    assert REQUIRED_EVENTS == ("slots:user",)


def test_a_grant_for_a_different_event_does_not_satisfy_the_requirement() -> None:
    wrong = Grants(
        frozenset({OWN_API_ENTRY, AGENTS_API_ENTRY}), frozenset({"subagent:user"}), "manifest"
    )
    assert wrong.missing() == ("event:slots:user",)
