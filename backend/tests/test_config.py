from pathlib import Path

import pytest

from backend.specter_arena.config import GatewayEnv, gateway_env, probe_enabled


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
