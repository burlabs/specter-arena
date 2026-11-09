import pytest

from backend.specter_arena.config import GatewayEnv, gateway_env


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
