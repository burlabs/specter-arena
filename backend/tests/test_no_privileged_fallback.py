"""SC-8 / FP-01-AC01: the probe never reaches for a privileged credential.

The only secret probe code may use is the one Crew injects into the spawn environment, and the
only token it may present is the one that secret buys at the app-token exchange. Source guards
read the probe modules as syntax trees, so a docstring cannot hide a violation and a comment
cannot trigger one. The negative controls prove the checker itself fails on each violation.
"""

import ast
import re
from pathlib import Path

import pytest

PROBE_DIR = Path(__file__).resolve().parents[1] / "specter_arena" / "probe"
MODULES = sorted(PROBE_DIR.glob("*.py"), key=lambda path: path.name)

BANNED_IMPORTS = {"os", "glob", "shutil", "subprocess"}
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
]
TOKEN_COOKIE_PREFIX = "mc_token"
# sanitise.py redacts the cookie name from captured text; live.py presents the app's own token.
TOKEN_COOKIE_FILES = {"sanitise.py": 1, "live.py": 1}


def violations(source: str, filename: str) -> list[str]:
    tree = ast.parse(source)
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found += [
                f"imports {a.name}" for a in node.names if a.name.split(".")[0] in BANNED_IMPORTS
            ]
        elif isinstance(node, ast.ImportFrom) and node.module:
            if node.module.split(".")[0] in BANNED_IMPORTS:
                found.append(f"imports from {node.module}")
        elif isinstance(node, ast.Attribute) and node.attr in BANNED_NAMES:
            found.append(f"uses .{node.attr}")
        elif isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            found.append(f"uses {node.id}")
        elif isinstance(node, ast.Call):
            found += _open_violations(node)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            found += [f"text matches {p.pattern}" for p in BANNED_TEXT if p.search(node.value)]
    found += _cookie_violations(tree, filename)
    return found


def _open_violations(call: ast.Call) -> list[str]:
    function = call.func
    name = function.attr if isinstance(function, ast.Attribute) else getattr(function, "id", "")
    if name != "open":
        return []
    mode = call.args[0] if call.args and isinstance(function, ast.Attribute) else None
    writes = isinstance(mode, ast.Constant) and str(mode.value).startswith(("a", "w"))
    return [] if writes else ["opens a file for reading"]


def _cookie_violations(tree: ast.AST, filename: str) -> list[str]:
    constants = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and TOKEN_COOKIE_PREFIX in node.value
    ]
    allowed = TOKEN_COOKIE_FILES.get(filename, 0)
    if len(constants) != allowed:
        return [f"{len(constants)} {TOKEN_COOKIE_PREFIX} constants, {allowed} allowed"]
    if filename != "live.py":
        return []
    presented = [
        value
        for node in ast.walk(tree)
        if isinstance(node, ast.Dict)
        for key, value in zip(node.keys, node.values, strict=True)
        if isinstance(key, ast.Constant)
        and key.value == "Cookie"
        and isinstance(value, ast.JoinedStr)
    ]
    return (
        [] if len(presented) == 1 else ["the cookie transport is not a single Cookie header value"]
    )


@pytest.mark.parametrize("path", MODULES, ids=lambda path: path.name)
def test_probe_module_reaches_no_privileged_credential(path: Path) -> None:
    assert violations(path.read_text(), path.name) == []


def test_the_live_driver_is_among_the_guarded_modules() -> None:
    assert "live.py" in {path.name for path in MODULES}


def test_the_live_driver_takes_its_secret_only_from_the_gateway_env() -> None:
    tree = ast.parse((PROBE_DIR / "live.py").read_text())
    secret_reads = [
        node for node in ast.walk(tree) if isinstance(node, ast.Attribute) and node.attr == "secret"
    ]
    assert len(secret_reads) == 2
    for node in secret_reads:
        assert isinstance(node.value, ast.Attribute) and node.value.attr == "_env"


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("import os\n", "imports os"),
        ("from os import path\n", "imports from os"),
        ("from pathlib import Path\nx = Path.home()\n", "uses .home"),
        ("x = open('.app_secret')\n", "opens a file for reading"),
        ("from pathlib import Path\nx = Path('a').read_text()\n", "uses .read_text"),
        ("x = '~/.kiro/crew/apps'\n", "text matches ~/"),
        ("x = 'app_secret'\n", "text matches app_secret"),
        ("x = request.cookies\n", "uses .cookies"),
        ("h = 'Set-Cookie'\n", "text matches (?i)set-cookie"),
        ("x = 'mc_token_9100'\n", "1 mc_token constants, 0 allowed"),
    ],
)
def test_negative_control_the_checker_flags_each_violation(source: str, expected: str) -> None:
    assert expected in violations(source, "probe_module.py")


def test_negative_control_a_second_token_cookie_in_the_live_driver_is_flagged() -> None:
    source = "a = {'Cookie': f'mc_token_{1}=x'}\nb = 'mc_token_2'\n"
    assert violations(source, "live.py") == ["2 mc_token constants, 1 allowed"]


def test_negative_control_a_token_cookie_outside_a_cookie_header_is_flagged() -> None:
    assert violations("a = {'Other': f'mc_token_{1}=x'}\n", "live.py") == [
        "the cookie transport is not a single Cookie header value"
    ]


def test_a_write_only_open_is_not_a_read() -> None:
    assert violations("from pathlib import Path\nPath('a').open('a')\n", "routes.py") == []
