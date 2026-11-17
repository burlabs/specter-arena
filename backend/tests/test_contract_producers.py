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


def schemas_without_a_producer(sources: dict[str, str], schema_ids: list[str]) -> list[str]:
    missing = []
    for schema_id in schema_ids:
        pattern = re.escape(schema_id) + r"(?![A-Za-z0-9])"
        named_in = [text for text in sources.values() if re.search(pattern, text)]
        if not any("compile_schema" in text for text in named_in):
            missing.append(schema_id)
    return missing


def test_the_registry_lists_all_ten_schemas() -> None:
    assert len(SCHEMA_IDS) == 10
    assert "urn:specter-arena:contract:roster:v1" in SCHEMA_IDS
    assert "urn:specter-arena:contract:attempts:v1" in SCHEMA_IDS
    assert "urn:specter-arena:contract:attempt-item:v1" in SCHEMA_IDS


def test_every_schema_is_validated_against_a_real_producer_body() -> None:
    assert schemas_without_a_producer(producer_sources(), SCHEMA_IDS) == []


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
