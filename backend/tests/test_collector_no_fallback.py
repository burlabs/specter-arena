"""SC3-8 / FP-03-AC04: the collector never reaches for a credential it was not given.

The only secret collector code may use is the one Crew injects into the spawn environment, and
the only token it may present is the one that secret buys at the app-token exchange. Source guards
read the collector modules as syntax trees, so a docstring cannot hide a violation and a comment
cannot trigger one. The negative controls prove the checker itself fails on each violation.
"""

import ast
import re
from pathlib import Path

import pytest

COLLECTOR_DIR = Path(__file__).resolve().parents[1] / "specter_arena" / "collector"
MODULES = sorted(COLLECTOR_DIR.glob("*.py"), key=lambda path: path.name)

BANNED_IMPORTS = {"os", "glob", "shutil", "subprocess", "sqlite3"}
BANNED_NAMES = {
    "expanduser",
    "home",
    "getenv",
    "environ",
    "read_text",
    "read_bytes",
    "cookies",
    "SimpleCookie",
    "CookieJar",
    "MozillaCookieJar",
}
BANNED_TEXT = [
    re.compile(r"app_secret"),
    re.compile(r"~/"),
    re.compile(r"\$HOME"),
    re.compile(r"/\.kiro/"),
    re.compile(r"\.kiro/crew"),
    re.compile(r"(?i)set-cookie"),
    re.compile(r"mc_token"),
]


def violations(source: str) -> list[str]:
    tree = ast.parse(source)
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found += _import_violations(alias.name, 0, ())
        elif isinstance(node, ast.ImportFrom):
            names = tuple(alias.name for alias in node.names)
            found += _import_violations(node.module or "", node.level, names)
        elif isinstance(node, ast.Attribute) and node.attr in BANNED_NAMES:
            found.append(f"uses .{node.attr}")
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            found.append(f"uses {node.id}")
        elif isinstance(node, ast.Call):
            found += _open_violations(node)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            found += [f"text matches {p.pattern}" for p in BANNED_TEXT if p.search(node.value)]
    return found


def _import_violations(module: str, level: int, names: tuple[str, ...]) -> list[str]:
    parts = module.split(".")
    found = []
    if parts[0] in BANNED_IMPORTS:
        found.append(f"imports {module}")
    if "probe" in parts or (level > 0 and not module and "probe" in names):
        found.append("imports the probe package")
    return found


def _open_violations(call: ast.Call) -> list[str]:
    function = call.func
    name = function.attr if isinstance(function, ast.Attribute) else getattr(function, "id", "")
    if name != "open":
        return []
    mode = call.args[0] if call.args and isinstance(function, ast.Attribute) else None
    writes = isinstance(mode, ast.Constant) and str(mode.value).startswith(("a", "w"))
    return [] if writes else ["opens a file for reading"]


@pytest.mark.parametrize("path", MODULES, ids=lambda path: path.name)
def test_collector_module_reaches_no_privileged_credential(path: Path) -> None:
    assert violations(path.read_text()) == []


def test_the_gateway_client_is_among_the_guarded_modules() -> None:
    assert "gateway.py" in {path.name for path in MODULES}


def test_the_gateway_client_takes_its_secret_only_from_the_gateway_env() -> None:
    tree = ast.parse((COLLECTOR_DIR / "gateway.py").read_text())
    secret_reads = [
        node for node in ast.walk(tree) if isinstance(node, ast.Attribute) and node.attr == "secret"
    ]
    assert len(secret_reads) == 2
    for node in secret_reads:
        assert isinstance(node.value, ast.Attribute) and node.value.attr == "_env"


def test_the_gateway_client_presents_the_token_only_in_the_query() -> None:
    tree = ast.parse((COLLECTOR_DIR / "gateway.py").read_text())
    header_keys = {
        key.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Dict)
        for key in node.keys
        if isinstance(key, ast.Constant) and isinstance(key.value, str)
    }
    assert header_keys == {"X-App-Secret", "token"}


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("import os\n", "imports os"),
        ("from os import path\n", "imports os"),
        ("import sqlite3\n", "imports sqlite3"),
        ("from sqlite3 import connect\n", "imports sqlite3"),
        ("from ..probe import live\n", "imports the probe package"),
        ("from .. import probe\n", "imports the probe package"),
        ("import backend.specter_arena.probe.live\n", "imports the probe package"),
        ("from backend.specter_arena.probe import steps\n", "imports the probe package"),
        ("from pathlib import Path\nx = Path.home()\n", "uses .home"),
        ("x = open('.app_secret')\n", "opens a file for reading"),
        ("from pathlib import Path\nx = Path('a').read_text()\n", "uses .read_text"),
        ("x = '~/.kiro/crew/apps'\n", "text matches ~/"),
        ("x = 'app_secret'\n", "text matches app_secret"),
        ("x = request.cookies\n", "uses .cookies"),
        ("h = 'Set-Cookie'\n", "text matches (?i)set-cookie"),
        ("x = 'mc_token_9100'\n", "text matches mc_token"),
    ],
)
def test_negative_control_the_checker_flags_each_violation(source: str, expected: str) -> None:
    assert expected in violations(source)


def test_a_write_only_open_is_not_a_read() -> None:
    assert violations("from pathlib import Path\nPath('a').open('a')\n") == []


def test_a_clean_module_has_no_violations() -> None:
    assert violations("from ..store import DmKey\nx = 1\n") == []
