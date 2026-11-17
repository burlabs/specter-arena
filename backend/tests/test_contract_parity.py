"""FP-02-AC03/AC04: every hand-written reader in `wire.READERS` agrees with the shared cases.

Test-time only. The readers live in release code and never read contracts/; this module is the
other place they meet, and it follows `wire.READERS`, so a reader added later is covered with no
edit here. test_wire.py holds the same cases under a fixed name list and the reader unit tests.
"""

from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena import wire

from .contract_support import CONTRACTS_DIR, CaseParseError, load_json

REQUIRED_READERS = {"observation", "bot-binding", "quarantine-record", "roster-item", "roster"}


def _cases() -> list[Any]:
    params = []
    for name in sorted(wire.READERS):
        case_dir = CONTRACTS_DIR / "cases" / name / "v1"
        for entry in load_json(case_dir / "cases.json"):
            params.append(pytest.param(name, case_dir, entry, id=f"{name}/{entry['file']}"))
    return params


def test_every_reader_has_a_schema_and_cases_and_the_required_readers_exist() -> None:
    assert set(wire.READERS) >= REQUIRED_READERS
    for name in wire.READERS:
        assert (CONTRACTS_DIR / "schemas" / f"{name}.v1.schema.json").is_file(), name
        assert (CONTRACTS_DIR / "cases" / name / "v1" / "cases.json").is_file(), name


def test_the_case_set_covers_every_reader() -> None:
    assert {param.values[0] for param in _cases()} == set(wire.READERS)


@pytest.mark.parametrize(("name", "case_dir", "entry"), _cases())
def test_reader_agrees_with_the_case(name: str, case_dir: Path, entry: dict[str, Any]) -> None:
    reader = wire.READERS[name]
    try:
        instance = load_json(case_dir / entry["file"])
    except CaseParseError:
        assert entry["valid"] is False
        return
    if entry["valid"]:
        assert reader(instance) == instance
    else:
        with pytest.raises(wire.ContractViolation):
            reader(instance)
