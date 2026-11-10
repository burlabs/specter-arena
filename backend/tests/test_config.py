import json
from pathlib import Path

import pytest

from backend.specter_arena.config import (
    APP_ROOT,
    OWN_API_ENTRY,
    GatewayEnv,
    detect_grants,
    gateway_env,
    probe_enabled,
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


def write_manifest(tmp_path: Path, manifest: object) -> Path:
    path = tmp_path / "app.json"
    path.write_text(json.dumps(manifest))
    return path


@pytest.mark.parametrize(
    ("phase", "declared"), [("v0", False), ("v1", True), ("v2", True)], ids=["v0", "v1", "v2"]
)
def test_detect_grants_follows_the_staged_phase_manifest(
    tmp_path: Path, phase: str, declared: bool
) -> None:
    path = write_manifest(tmp_path, {"permissions": PHASE_PERMISSIONS[phase]})
    assert detect_grants(path) == (declared, "manifest")


def test_detect_grants_reads_the_release_manifest_as_no_grants() -> None:
    assert detect_grants() == (False, "manifest")


def test_detect_grants_treats_missing_permission_keys_as_none_declared(tmp_path: Path) -> None:
    assert detect_grants(write_manifest(tmp_path, {})) == (False, "manifest")
    assert detect_grants(write_manifest(tmp_path, {"permissions": {}})) == (False, "manifest")


def test_detect_grants_counts_an_event_alone_and_an_extra_api_entry_alone(tmp_path: Path) -> None:
    events_only = {"api": [OWN_API_ENTRY], "events": ["slots:user"]}
    assert detect_grants(write_manifest(tmp_path, {"permissions": events_only}))[0] is True
    other_api = {"api": [OWN_API_ENTRY, "/api/agents"], "events": []}
    assert detect_grants(write_manifest(tmp_path, {"permissions": other_api}))[0] is True
    assert detect_grants(write_manifest(tmp_path, {"permissions": {"api": []}}))[0] is False


def test_detect_grants_fails_closed_when_the_file_is_missing_or_not_json(tmp_path: Path) -> None:
    assert detect_grants(tmp_path / "absent.json") == (
        True,
        "manifest-unreadable: FileNotFoundError",
    )
    broken = tmp_path / "app.json"
    broken.write_text("{")
    assert detect_grants(broken) == (True, "manifest-unreadable: JSONDecodeError")


@pytest.mark.parametrize(
    "manifest",
    [[], {"permissions": []}, {"permissions": {"api": "x"}}, {"permissions": {"events": {}}}],
    ids=["not-object", "permissions-list", "api-string", "events-object"],
)
def test_detect_grants_fails_closed_on_an_unexpected_shape(
    tmp_path: Path, manifest: object
) -> None:
    declared, basis = detect_grants(write_manifest(tmp_path, manifest))
    assert declared is True
    assert basis.startswith("manifest-unreadable: ")
