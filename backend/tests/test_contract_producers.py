"""FP-02-AC04: no schema in contracts/ is exercised only by its own cases.

Every schema `$id` must appear, on a code line, in a test other than the contract case runners,
and that test must compile the schema, so some producer's real body is validated against it. The
check proves a test names the `$id`; review confirms the body is a real producer's.
"""

import re
from pathlib import Path

from .contract_support import CONTRACTS_DIR, SCHEMA_FILE

TESTS = Path(__file__).resolve().parent
OWN = {"test_contracts.py", "test_contract_parity.py", "test_contract_producers.py"}
OWNERS_FILE = CONTRACTS_DIR / "OWNERS.md"
OWNER_ROW = re.compile(
    r"^\|\s*`(?P<name>[a-z][a-z0-9-]*)`\s*\|\s*(?P<major>[1-9][0-9]*)\s*\|\s*[\w-]+\s*\|\s*(?P<status>[A-Z]+)\s*\|",
    re.MULTILINE,
)
SCHEMA_IDS = [
    f"urn:specter-arena:contract:{match['name']}:v{match['major']}"
    for path in sorted((CONTRACTS_DIR / "schemas").glob("*.schema.json"))
    if (match := SCHEMA_FILE.match(path.name))
]


def code_lines(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))


def producer_sources(directory: Path = TESTS) -> dict[str, str]:
    return {
        path.name: code_lines(path.read_text(encoding="utf-8"))
        for path in sorted(directory.glob("test_*.py"))
        if path.name not in OWN
    }


def retired_schema_ids(owners_text: str) -> list[str]:
    """Schemas OWNERS.md marks RETIRED: no longer emitted, so no producer is expected (FP-16)."""
    return [
        f"urn:specter-arena:contract:{match['name']}:v{match['major']}"
        for match in OWNER_ROW.finditer(owners_text)
        if match["status"] == "RETIRED"
    ]


def schemas_without_a_producer(
    sources: dict[str, str], schema_ids: list[str], retired: frozenset[str] = frozenset()
) -> list[str]:
    missing = []
    for schema_id in schema_ids:
        if schema_id in retired:
            continue
        pattern = re.escape(schema_id) + r"(?![A-Za-z0-9])"
        named_in = [text for text in sources.values() if re.search(pattern, text)]
        if not any("compile_schema" in text for text in named_in):
            missing.append(schema_id)
    return missing


def test_the_registry_lists_all_twenty_nine_schemas() -> None:
    assert len(SCHEMA_IDS) == 29
    assert "urn:specter-arena:contract:roster:v1" in SCHEMA_IDS
    assert "urn:specter-arena:contract:attempts:v1" in SCHEMA_IDS
    assert "urn:specter-arena:contract:attempt-item:v1" in SCHEMA_IDS
    for name in ("specter-profile", "specter", "specters", "summoning", "portrait-asset"):
        assert f"urn:specter-arena:contract:{name}:v1" in SCHEMA_IDS
    assert "urn:specter-arena:contract:specter:v2" in SCHEMA_IDS
    assert "urn:specter-arena:contract:specters:v2" in SCHEMA_IDS
    assert "urn:specter-arena:contract:scene-asset:v1" in SCHEMA_IDS
    assert "urn:specter-arena:contract:heroes:v1" in SCHEMA_IDS
    assert "urn:specter-arena:contract:work-items:v2" in SCHEMA_IDS
    assert "urn:specter-arena:contract:work-list-item:v1" in SCHEMA_IDS
    assert "urn:specter-arena:contract:xp-summaries:v2" in SCHEMA_IDS
    assert "urn:specter-arena:contract:data-lifecycle:v1" in SCHEMA_IDS
    assert "urn:specter-arena:contract:collector-control:v1" in SCHEMA_IDS
    for name in ("work-item", "work-items", "xp-summary", "xp-summaries", "xp-history"):
        assert f"urn:specter-arena:contract:{name}:v1" in SCHEMA_IDS


def test_every_schema_is_validated_against_a_real_producer_body() -> None:
    retired = frozenset(retired_schema_ids(OWNERS_FILE.read_text(encoding="utf-8")))
    assert schemas_without_a_producer(producer_sources(), SCHEMA_IDS, retired) == []


def test_exactly_the_four_pa_2_identity_contracts_are_retired() -> None:
    retired = retired_schema_ids(OWNERS_FILE.read_text(encoding="utf-8"))
    assert set(retired) == {
        f"urn:specter-arena:contract:{name}:v1"
        for name in ("specter", "specter-profile", "specters", "summoning")
    }
    assert len(retired) == 4
    assert set(retired) <= set(SCHEMA_IDS)


def test_a_retired_schema_is_exempt_and_a_live_one_is_not(tmp_path: Path) -> None:
    old = "urn:specter-arena:contract:old:v1"
    live = "urn:specter-arena:contract:live:v1"
    sources = producer_sources(tmp_path)
    assert schemas_without_a_producer(sources, [old, live], frozenset({old})) == [live]
    assert schemas_without_a_producer(sources, [old, live]) == [old, live]


def test_only_the_retired_status_is_read_from_owners_rows() -> None:
    text = (
        "| `a` | 1 | work-ledger | FROZEN | x |\n"
        "| `b` | 2 | specter-identity | RETIRED | y |\n"
        "| `c` | 1 | delivery | DRAFT | z |\n"
    )
    assert retired_schema_ids(text) == ["urn:specter-arena:contract:b:v2"]


def test_a_schema_named_only_by_the_case_runners_is_reported(tmp_path: Path) -> None:
    (tmp_path / "test_contracts.py").write_text('ID = "urn:specter-arena:contract:solo:v1"\n')
    sources = producer_sources(tmp_path)
    assert schemas_without_a_producer(sources, ["urn:specter-arena:contract:solo:v1"]) == [
        "urn:specter-arena:contract:solo:v1"
    ]


def test_a_mention_in_a_comment_or_without_compile_schema_does_not_count(tmp_path: Path) -> None:
    schema_id = "urn:specter-arena:contract:solo:v1"
    (tmp_path / "test_a.py").write_text(f"# {schema_id}\ncompile_schema(other)\n")
    (tmp_path / "test_b.py").write_text(f'ID = "{schema_id}"\n')
    assert schemas_without_a_producer(producer_sources(tmp_path), [schema_id]) == [schema_id]


def test_a_longer_id_does_not_stand_in_for_a_shorter_one(tmp_path: Path) -> None:
    (tmp_path / "test_a.py").write_text(
        'compile_schema("urn:specter-arena:contract:roster-item:v1")\n'
    )
    assert schemas_without_a_producer(
        producer_sources(tmp_path), ["urn:specter-arena:contract:roster:v1"]
    ) == ["urn:specter-arena:contract:roster:v1"]


def test_a_named_and_compiled_schema_counts(tmp_path: Path) -> None:
    schema_id = "urn:specter-arena:contract:solo:v1"
    (tmp_path / "test_a.py").write_text(f'compile_schema("{schema_id}", REGISTRY)\n')
    assert schemas_without_a_producer(producer_sources(tmp_path), [schema_id]) == []
