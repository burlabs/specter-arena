import json
from pathlib import Path

import pytest

from backend.specter_arena.config import read_run_options_file
from backend.specter_arena.probe.options import (
    DEFAULT_AGENTS_POLL_SECONDS,
    OptionsError,
    RunOptions,
    load_run_options,
)

FIXTURE = Path(__file__).with_name("probe_run_options_valid.json")


def load(body: dict[str, object], staged: object = None) -> RunOptions:
    return load_run_options(body, staged, default_capture_seconds=30.0)


def test_defaults_apply_when_neither_body_nor_file_sets_a_key() -> None:
    assert load({}) == RunOptions(None, 30.0, None, DEFAULT_AGENTS_POLL_SECONDS)


def test_the_body_wins_over_the_file_key_by_key() -> None:
    staged = {"hostVersion": "0.12.2", "captureSeconds": 900, "reconnectAfterStartSeconds": 5}
    options = load({"captureSeconds": 60}, staged)
    assert options == RunOptions("0.12.2", 60.0, 5.0, DEFAULT_AGENTS_POLL_SECONDS)


@pytest.mark.parametrize(
    ("key", "good", "bad"),
    [
        ("captureSeconds", [1, 900, 1.5], [0, 900.5, -1]),
        ("reconnectAfterStartSeconds", [1, 120, None], [0, 121]),
        ("agentsPollSeconds", [5, 120], [4.9, 121]),
    ],
)
def test_every_range_edge(key: str, good: list[object], bad: list[object]) -> None:
    for value in good:
        load({key: value})
    for value in bad:
        with pytest.raises(OptionsError, match=key):
            load({key: value})


@pytest.mark.parametrize("value", [True, "30", [30], None])
def test_numbers_must_be_numbers(value: object) -> None:
    with pytest.raises(OptionsError, match="captureSeconds must be a number"):
        load({"captureSeconds": value})


@pytest.mark.parametrize("version", ["0.12", "v0.12.2", "0.12.2-rc1", 12, None])
def test_the_host_version_must_be_three_numbers(version: object) -> None:
    with pytest.raises(OptionsError, match="hostVersion"):
        load({"hostVersion": version})


def test_unknown_keys_and_non_objects_are_refused_with_their_source() -> None:
    with pytest.raises(OptionsError, match="request: unknown run option captureSecs"):
        load({"captureSecs": 30})
    with pytest.raises(OptionsError, match=r"\.probe-run\.json: unknown run option extra"):
        load({}, {"extra": 1})
    with pytest.raises(OptionsError, match="must be a JSON object"):
        load({}, ["hostVersion"])


def test_the_shared_fixture_is_valid() -> None:
    staged = json.loads(FIXTURE.read_text())
    assert load({}, staged).host_version == staged["hostVersion"]


def test_the_options_file_reader(tmp_path: Path) -> None:
    assert read_run_options_file(tmp_path / "absent.json") is None
    path = tmp_path / ".probe-run.json"
    path.write_text('{"hostVersion": "0.12.2"}')
    assert read_run_options_file(path) == {"hostVersion": "0.12.2"}
    path.write_text("{")
    with pytest.raises(ValueError):
        read_run_options_file(path)
