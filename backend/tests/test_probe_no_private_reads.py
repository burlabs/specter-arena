import importlib
from pathlib import Path

import pytest

PROBE_DIR = Path(__file__).resolve().parents[1] / "specter_arena" / "probe"
MARKER = "SPECTER-DIAGNOSTIC-ONLY"
MODULES = ["__init__", "questions", "sanitise", "frames", "matrix", "snapshot", "steps", "routes"]
FORBIDDEN = [".app_secret", "~/.kiro", "expanduser", "Path.home", "owner_token", "os.environ"]


@pytest.mark.parametrize("name", MODULES)
def test_each_probe_module_carries_the_marker_as_comment_and_runtime_constant(name: str) -> None:
    text = (PROBE_DIR / f"{name}.py").read_text()
    assert f"# {MARKER}" in text.splitlines()[0]
    assert f'MARKER = "{MARKER}"' in text
    module = importlib.import_module(f"backend.specter_arena.probe.{name}".replace(".__init__", ""))
    assert module.MARKER == MARKER


@pytest.mark.parametrize("path", sorted(PROBE_DIR.glob("*.py")), ids=lambda p: p.name)
def test_probe_code_reads_no_private_stores_or_owner_credentials(path: Path) -> None:
    text = path.read_text()
    for needle in FORBIDDEN:
        assert needle not in text, f"{path.name} mentions {needle}"
