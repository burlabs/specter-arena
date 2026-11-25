"""The identity package reads nothing about the bot: no collector, work, XP or observation
module, and no generation path or chat grant remains in the backend source."""

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "specter_arena"
SPECTERS = BACKEND / "specters"
BANNED_PREFIXES = (
    "collector",
    "work",
    "summoner",
    "probe",
    "store.observations",
    "store.attempts",
    "store.xp",
    "store.xp_policy",
    "store.work",
    "store.projection",
    "store.fold",
    "store.runs",
)


def imported_modules(path: Path) -> list[str]:
    names: list[str] = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.ImportFrom):
            base = ("." * node.level) + (node.module or "")
            names.append(base)
            names.extend(f"{base}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
    return names


def test_specters_package_imports_no_collector_work_xp_or_observation_module() -> None:
    files = sorted(SPECTERS.glob("*.py"))
    assert len(files) >= 8
    for path in files:
        for name in imported_modules(path):
            stripped = name.lstrip(".")
            assert not stripped.startswith(BANNED_PREFIXES), (path.name, name)


def test_no_source_names_the_chat_api_or_the_summoner_agent() -> None:
    for path in sorted(BACKEND.rglob("*.py")):
        if "probe" in path.relative_to(BACKEND).parts:
            continue  # the diagnostic probe asks about /api/chat/slots; it never ships
        text = path.read_text(encoding="utf-8")
        assert "/api/chat" not in text, path
        assert "specter-summoner" not in text, path


def test_the_summoner_package_and_generation_modules_are_gone() -> None:
    assert not (BACKEND / "summoner").exists()
    for name in ("profile.py", "prompt.py", "brief.py"):
        assert not (SPECTERS / name).exists(), name
