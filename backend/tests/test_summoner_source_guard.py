"""FP-06-AC05: the summoner can reach only the four chat paths and the token exchange.

The guard reads `summoner/*.py` as syntax trees, so a docstring cannot hide a violation and a
comment cannot trigger one. Negative controls prove the checker fails on each violation."""

import ast
import json
import re
from pathlib import Path

import pytest

SUMMONER_DIR = Path(__file__).resolve().parents[1] / "specter_arena" / "summoner"
MODULES = sorted(SUMMONER_DIR.glob("*.py"), key=lambda path: path.name)
MANIFEST_AGENT = Path(__file__).resolve().parents[2] / "agents" / "specter-summoner.json"

BANNED_IMPORTS = {"os", "subprocess", "sqlite3", "websockets", "glob", "shutil"}
BANNED_NAMES = {"environ", "getenv", "read_text", "read_bytes", "expanduser", "home"}
BANNED_TEXT = [
    re.compile(r"app_agent_owner"),
    re.compile(r"sessionApproval"),
    re.compile(r"/api/spawn"),
    re.compile(r"/api/members"),
    re.compile(r"/api/usage"),
    re.compile(r"/api/jobs"),
    re.compile(r"app_secret"),
    re.compile(r"~/"),
]
ALLOWED_API_CONSTANTS = {"/api/chat/slots", "/api/chat", "/api/apps/{name}/token"}
HTTP_METHODS = {"GET", "PUT", "PATCH", "HEAD", "OPTIONS"}


def violations(source: str, *, composition: bool = False) -> list[str]:
    found: list[str] = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            found += [
                f"imports {a.name}" for a in node.names if a.name.split(".")[0] in BANNED_IMPORTS
            ]
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] in BANNED_IMPORTS:
                found.append(f"imports {node.module}")
            if not composition:
                found += _relative(node)
        elif isinstance(node, ast.Attribute) and node.attr in BANNED_NAMES:
            found.append(f"uses .{node.attr}")
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            found.append(f"uses {node.id}")
        elif isinstance(node, ast.JoinedStr):
            found += _fstring(node)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            found += _text(node.value)
    return found


def _relative(node: ast.ImportFrom) -> list[str]:
    module = node.module or ""
    names = [alias.name for alias in node.names]
    leaks = {"store", "specters", "collector", "probe", "work"}
    if module.split(".")[0] in leaks or leaks & set(names):
        return [f"imports {module or names}"]
    return []


def _fstring(node: ast.JoinedStr) -> list[str]:
    literal = "".join(str(p.value) for p in node.values if isinstance(p, ast.Constant))
    return _text(literal)


def _text(value: str) -> list[str]:
    found = [f"text matches {p.pattern}" for p in BANNED_TEXT if p.search(value)]
    if value in HTTP_METHODS:
        found.append(f"names the {value} method")
    unexpected = value.startswith("/api/") and value not in ALLOWED_API_CONSTANTS
    if unexpected and not value.startswith("/api/apps/"):
        found.append(f"unexpected api path {value}")
    return found


@pytest.mark.parametrize("path", MODULES, ids=lambda path: path.name)
def test_summoner_module_stays_inside_its_grant(path: Path) -> None:
    assert violations(path.read_text(), composition=path.name == "boot.py") == []


def test_only_the_composition_module_may_reach_the_domain_and_the_store() -> None:
    assert violations("from ..specters.service import X\n") != []
    assert violations("from ..specters.service import X\n", composition=True) == []


def test_the_client_is_among_the_guarded_modules() -> None:
    assert {"client.py", "boot.py", "__init__.py"} <= {path.name for path in MODULES}


def test_exactly_one_agent_name_constant_and_it_equals_the_manifest_agent() -> None:
    tree = ast.parse((SUMMONER_DIR / "client.py").read_text())
    agent_names = [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value.startswith("specter-arena-")
    ]
    assert agent_names == ["specter-arena-summoner"]
    assert json.loads(MANIFEST_AGENT.read_text())["name"] == agent_names[0]


def test_the_client_never_issues_a_get_and_names_only_post_and_delete() -> None:
    tree = ast.parse((SUMMONER_DIR / "client.py").read_text())
    methods = {
        arg.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        for arg in node.args[:1]
        if isinstance(arg, ast.Constant) and arg.value in {"GET", "POST", "DELETE"}
    }
    assert methods == {"POST", "DELETE"}


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("import os\n", "imports os"),
        ("import websockets\n", "imports websockets"),
        ("import sqlite3\n", "imports sqlite3"),
        ("from os import path\n", "imports os"),
        ("from ..store import Store\n", "imports store"),
        ("from .. import specters\n", "imports ['specters']"),
        ("from ..work.service import WorkService\n", "imports work.service"),
        ("from .. import work\n", "imports ['work']"),
        ("x = os.environ\n", "uses .environ"),
        ("x = environ\n", "uses environ"),
        ("x = p.read_text()\n", "uses .read_text"),
        ("x = 'app_agent_owner'\n", "text matches app_agent_owner"),
        ("x = '/api/spawn'\n", "text matches /api/spawn"),
        ("x = '/api/members/probe'\n", "text matches /api/members"),
        ("x = '/api/other'\n", "unexpected api path /api/other"),
        ("x = f'/api/spawn/{y}'\n", "text matches /api/spawn"),
        ("call('GET', '/api/chat/slots')\n", "names the GET method"),
    ],
)
def test_negative_control_the_checker_flags_each_violation(source: str, expected: str) -> None:
    assert expected in violations(source)


def test_the_apps_token_exchange_and_chat_paths_are_not_flagged() -> None:
    assert violations("a = '/api/chat'\nb = '/api/chat/slots'\nc = f'/api/apps/{n}/token'\n") == []
