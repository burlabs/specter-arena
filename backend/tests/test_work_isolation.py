"""FP0809-CI-06 and FP-09-AC06: no monitoring, identity or generation code reaches the work
service, the work service reaches nothing outside the store and the wire, acceptance has one
path, and summoning and acceptance never write each other's rows. Guards read syntax trees, and
each one has a negative control that proves it fails on a violation."""

import asyncio
import re
from collections.abc import Callable, Coroutine, Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.specters.service import UNSET, Limits, SpecterService
from backend.specter_arena.store import Store, xp_summary

from .specter_fakes import FakeClock, ScriptedSummoner, good_reply
from .test_store_isolation import dynamic_import_arguments, identifiers_and_strings, resolve_imports
from .test_store_work_isolation import source_files
from .work_api_fakes import WorkRig, build_rig, run
from .work_fakes import LEDGER_TABLES, T0, ledger_hash, query, table_hash, token, worker_attempt

BACKEND = Path(__file__).resolve().parents[1]
PACKAGE = BACKEND / "specter_arena"
BASE = "backend.specter_arena"
WORK_MODULES = (f"{BASE}.work", f"{BASE}.work_routes")
SPECTER_TABLES = ("specter", "specter_revision", "generation_request", "asset")

INBOUND_SOURCES = (
    "collector",
    "summoner",
    "specters",
    "store/ingest.py",
    "store/projection.py",
    "store/fold.py",
    "store/specters.py",
    "routes.py",
    "specter_routes.py",
    "roster_view.py",
    "attempts_view.py",
)
OUTBOUND_SOURCES = ("work", "work_routes.py")
OUTBOUND_BANNED_ROOTS = {
    "os",
    "subprocess",
    "sqlite3",
    "websockets",
    "socket",
    "glob",
    "shutil",
    "httpx",
    "urllib",
}
OUTBOUND_BANNED_PACKAGES = (f"{BASE}.collector", f"{BASE}.summoner", f"{BASE}.probe")
OUTBOUND_BANNED_TEXT = ("/api/members", "/api/chat", "member-")
ALLOWED_OUTBOUND_DYNAMIC_IMPORTS = {".work.service"}


def inbound_violations(path: Path, root: Path = BACKEND) -> list[str]:
    """Imports of the work service or its router, and dynamic imports that could hide one."""
    problems = [
        name
        for name in sorted(resolve_imports(path, root))
        if any(name == module or name.startswith(f"{module}.") for module in WORK_MODULES)
    ]
    for argument in dynamic_import_arguments(path):
        if argument is None:
            problems.append("computed dynamic import")
        elif "work" in argument:
            problems.append(f"dynamic import {argument!r}")
    return problems


def outbound_violations(path: Path, root: Path = BACKEND) -> list[str]:
    problems = []
    for name in sorted(resolve_imports(path, root)):
        if name.split(".")[0] in OUTBOUND_BANNED_ROOTS:
            problems.append(f"imports {name}")
        if any(name == pkg or name.startswith(f"{pkg}.") for pkg in OUTBOUND_BANNED_PACKAGES):
            problems.append(f"imports {name}")
    for text in sorted(identifiers_and_strings(path)):
        if any(banned in text for banned in OUTBOUND_BANNED_TEXT):
            problems.append(f"names {text!r}")
    for argument in dynamic_import_arguments(path):
        if argument not in ALLOWED_OUTBOUND_DYNAMIC_IMPORTS:
            problems.append(f"dynamic import {argument!r}")
    return problems


def test_monitoring_identity_and_generation_code_never_import_the_work_service() -> None:
    files = source_files(*INBOUND_SOURCES)
    assert len(files) >= 20
    for path in files:
        assert inbound_violations(path) == [], path.name


def test_the_work_service_and_router_reach_only_the_store_and_the_wire() -> None:
    files = source_files(*OUTBOUND_SOURCES)
    assert {p.name for p in files} >= {"service.py", "wire.py", "boot.py", "work_routes.py"}
    for path in files:
        assert outbound_violations(path) == [], path.name


def test_negative_control_the_inbound_guard_flags_each_way_in(tmp_path: Path) -> None:
    root = tmp_path / "backend"
    target = root / "specter_arena" / "collector"
    target.mkdir(parents=True)
    cases = {
        "relative.py": "from ..work.service import WorkService\n",
        "package.py": "from .. import work\n",
        "absolute.py": "import backend.specter_arena.work.service\n",
        "router.py": "from ..work_routes import work_routes\n",
        "dynamic.py": "import importlib\nimportlib.import_module('..work.service', __package__)\n",
        "computed.py": "import importlib\nname = '.wo' + 'rk'\nimportlib.import_module(name)\n",
        "nested.py": "def boot():\n    from ..work.boot import boot_work\n    return boot_work\n",
    }
    for name, source in cases.items():
        (target / name).write_text(source, encoding="utf-8")
        assert inbound_violations(target / name, root) != [], name
    (target / "clean.py").write_text(
        "from ..store import ingest\nfrom ..attempts_view import end_signal_wire\n",
        encoding="utf-8",
    )
    assert inbound_violations(target / "clean.py", root) == []


def test_negative_control_the_outbound_guard_flags_each_way_out(tmp_path: Path) -> None:
    root = tmp_path / "backend"
    target = root / "specter_arena" / "work"
    target.mkdir(parents=True)
    cases = {
        "driver.py": "import sqlite3\n",
        "env.py": "import os\n",
        "net.py": "import urllib.request\n",
        "ws.py": "import websockets\n",
        "collector.py": "from ..collector import boot\n",
        "summoner.py": "from ..summoner import client\n",
        "probe.py": "from ..probe import routes\n",
        "members.py": "path = '/api/members/x'\n",
        "chat.py": "path = '/api/chat/slots'\n",
        "member.py": "label = 'member-one'\n",
        "dynamic.py": "import importlib\nimportlib.import_module('.x', __package__)\n",
    }
    for name, source in cases.items():
        (target / name).write_text(source, encoding="utf-8")
        assert outbound_violations(target / name, root) != [], name
    (target / "clean.py").write_text(
        "from ..store import xp\nfrom ..attempts_view import end_signal_wire\n", encoding="utf-8"
    )
    assert outbound_violations(target / "clean.py", root) == []


def test_acceptance_has_one_path_through_the_service() -> None:
    pattern = re.compile(r"\bdecide_work\b")
    holders = sorted(
        str(p.relative_to(PACKAGE))
        for p in PACKAGE.rglob("*.py")
        if pattern.search(p.read_text(encoding="utf-8"))
    )
    assert holders == ["store/__init__.py", "store/work.py", "work/service.py"]
    service = (PACKAGE / "work" / "service.py").read_text(encoding="utf-8")
    assert len(re.findall(r"\bdecide_work\b", service)) == 1
    routes = (PACKAGE / "work_routes.py").read_text(encoding="utf-8")
    assert "db_work" not in routes and "store" not in routes.replace("store_not_ready", "")


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[WorkRig]:
    made = build_rig(tmp_path)
    try:
        yield made
    finally:
        made.store.close()


def rid(n: int) -> str:
    return f"req_{n:024x}"


def specter_service(store: Store) -> SpecterService:
    summoner = ScriptedSummoner(good_reply("Wick"), good_reply("Other Name", appearance="Moth."))
    return SpecterService(store, summoner, clock=FakeClock(), limits=Limits(timeout_s=2.0))


async def settle(service: SpecterService, n: int) -> None:
    for _ in range(400):
        if (await service.get_summoning(rid(n)))["status"] in ("ready", "failed", "cancelled"):
            return
        await asyncio.sleep(0.005)
    raise AssertionError("request did not settle")


async def full_specter_flow(store: Store, binding: str) -> None:
    """Summon, accept, rename, reroll with the name kept, accept, then show a bundled portrait."""
    service = specter_service(store)
    await service.start()
    try:
        await service.start_summoning(binding, {"requestId": rid(1)})
        await settle(service, 1)
        assert (await service.accept(rid(1), 0))["version"] == 1
        assert (await service.rename(binding, 1, "Wicker", UNSET))["version"] == 2
        await service.start_summoning(binding, {"requestId": rid(2), "keep": ["name"]})
        await settle(service, 2)
        assert (await service.accept(rid(2), 2))["version"] == 3
        art = (await service.list_portraits())["items"][0]
        assert (await service.set_portrait(binding, 3, art["assetId"]))["version"] == 4
    finally:
        await service.close()


def go(scenario: Callable[[], Coroutine[Any, Any, None]]) -> None:
    asyncio.run(scenario())


def accept_work(made: WorkRig, n: int, bot: int) -> dict[str, Any]:
    _, created = run(
        made.service.create_work(
            {
                "requestId": token("create", n),
                "title": "Write the release notes",
                "acceptanceCondition": "The owner read them and agrees.",
                "rewardable": True,
                "attemptIds": [made.seeded.attempts[bot][0]],
                "milestones": [],
            }
        )
    )
    submitted = run(
        made.service.decide(
            created["workId"],
            {"requestId": token("submit", n), "expectedVersion": 1, "action": "submit"},
        )
    )
    return run(
        made.service.decide(
            created["workId"],
            {
                "requestId": token("accept", n),
                "expectedVersion": submitted["version"],
                "action": "accept",
                "evidenceRevision": submitted["evidenceRevision"],
            },
        )
    )


def specter_hashes(store: Store) -> dict[str, str]:
    return {name: table_hash(store, name) for name in SPECTER_TABLES}


def test_a_full_summoning_flow_writes_zero_work_or_xp_rows(rig: WorkRig) -> None:
    before = ledger_hash(rig.store)
    go(lambda: full_specter_flow(rig.store, rig.seeded.bindings[0]))
    assert query(rig.store, "SELECT count(*) FROM specter_revision")[0][0] >= 4
    for table in LEDGER_TABLES:
        assert query(rig.store, f"SELECT count(*) FROM {table}") == [(0,)], table
    assert ledger_hash(rig.store) == before
    assert run(rig.service.xp_summaries())["items"] == []


def test_identity_work_leaves_earned_xp_and_the_ledger_unchanged(rig: WorkRig) -> None:
    binding = rig.seeded.bindings[0]
    accept_work(rig, 1, 0)
    before = ledger_hash(rig.store)
    summary = xp_summary(rig.store, binding)
    assert summary.total_xp == 100
    go(lambda: full_specter_flow(rig.store, binding))
    assert ledger_hash(rig.store) == before
    assert xp_summary(rig.store, binding) == summary
    assert (
        run(rig.service.xp_history(binding, cursor=None, limit=None))["summary"]["totalXp"] == 100
    )


def test_accepting_reopening_and_reaccepting_work_writes_no_identity_row(rig: WorkRig) -> None:
    binding = rig.seeded.bindings[0]
    go(lambda: full_specter_flow(rig.store, binding))
    before = specter_hashes(rig.store)
    item = accept_work(rig, 1, 0)
    reopened = run(
        rig.service.decide(
            item["workId"],
            {
                "requestId": token("reopen", 1),
                "expectedVersion": item["version"],
                "action": "reopen",
            },
        )
    )
    assert reopened["state"] == "reopened"
    assert specter_hashes(rig.store) == before
    assert query(rig.store, "SELECT count(*) FROM xp_entry")[0][0] == 2


def test_observing_more_attempts_writes_no_work_or_xp_row(rig: WorkRig) -> None:
    before = ledger_hash(rig.store)
    attempt_rows = query(rig.store, "SELECT count(*) FROM attempt")[0][0]
    worker_attempt(rig.store, 0, 950, ms=T0 + 5000)
    worker_attempt(rig.store, 1, 951, ended=False, ms=T0 + 5010)
    assert query(rig.store, "SELECT count(*) FROM attempt")[0][0] == attempt_rows + 2
    for table in LEDGER_TABLES:
        assert query(rig.store, f"SELECT count(*) FROM {table}") == [(0,)], table
    assert {k: v for k, v in ledger_hash(rig.store).items() if k != "attempt"} == {
        k: v for k, v in before.items() if k != "attempt"
    }
