import json
from pathlib import Path
from typing import Any

import fastjsonschema
import pytest

from .contract_support import (
    CONTRACTS_DIR,
    SCHEMA_FILE,
    CaseParseError,
    compile_schema,
    error_pointer,
    load_json,
    load_registry,
)

REGISTRY = load_registry()
SCHEMA_FILES = sorted((CONTRACTS_DIR / "schemas").glob("*.schema.json"))


def _cases() -> list[Any]:
    params = []
    for schema_path in SCHEMA_FILES:
        match = SCHEMA_FILE.match(schema_path.name)
        assert match, f"{schema_path.name}: unexpected schema file name"
        case_dir = CONTRACTS_DIR / "cases" / match["name"] / f"v{match['major']}"
        for entry in load_json(case_dir / "cases.json"):
            params.append(
                pytest.param(
                    f"urn:specter-arena:contract:{match['name']}:v{match['major']}",
                    case_dir,
                    entry,
                    id=f"{match['name']}.v{match['major']}/{entry['file']}",
                )
            )
    return params


def test_schemas_exist() -> None:
    assert {path.name for path in SCHEMA_FILES} >= {
        "api-error.v1.schema.json",
        "bot-binding.v1.schema.json",
        "observation.v1.schema.json",
        "page.v1.schema.json",
        "quarantine-record.v1.schema.json",
        "ready.v1.schema.json",
        "roster-item.v1.schema.json",
        "roster.v1.schema.json",
    }


@pytest.mark.parametrize(("schema_id", "case_dir", "entry"), _cases())
def test_case(schema_id: str, case_dir: Path, entry: dict[str, Any]) -> None:
    validate = compile_schema(schema_id, REGISTRY)
    try:
        instance = load_json(case_dir / entry["file"])
    except CaseParseError:
        assert entry["valid"] is False
        assert "instancePath" not in entry
        return
    try:
        validate(instance)
    except fastjsonschema.JsonSchemaValueException as error:
        assert entry["valid"] is False, f"unexpectedly invalid: {error.message}"
        if "instancePath" in entry:
            # Compare only the first error's JSON Pointer; keywords and messages differ.
            assert error_pointer(error) == entry["instancePath"]
    else:
        assert entry["valid"] is True


def test_every_schema_has_both_kinds_of_case() -> None:
    for schema_path in SCHEMA_FILES:
        match = SCHEMA_FILE.match(schema_path.name)
        assert match
        case_dir = CONTRACTS_DIR / "cases" / match["name"] / f"v{match['major']}"
        entries = load_json(case_dir / "cases.json")
        assert any(entry["valid"] for entry in entries)
        assert any(not entry["valid"] for entry in entries)


def test_ref_by_id_resolves_across_files(tmp_path: Path) -> None:
    """A schema from another owner (FP-05) can $ref a closed sub-schema by $id."""
    (tmp_path / "inner.v1.schema.json").write_text(
        json.dumps(
            {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "$id": "urn:specter-arena:contract:inner:v1",
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": False,
            }
        )
    )
    (tmp_path / "outer.v1.schema.json").write_text(
        json.dumps(
            {
                "$schema": "http://json-schema.org/draft-07/schema#",
                "$id": "urn:specter-arena:contract:outer:v1",
                "type": "object",
                "properties": {"inner": {"$ref": "urn:specter-arena:contract:inner:v1"}},
                "required": ["inner"],
                "additionalProperties": False,
            }
        )
    )
    registry = load_registry(tmp_path)
    validate = compile_schema("urn:specter-arena:contract:outer:v1", registry)
    validate({"inner": {"id": "a"}})
    with pytest.raises(fastjsonschema.JsonSchemaValueException) as raised:
        validate({"inner": {"id": 1}})
    assert error_pointer(raised.value) == "/inner/id"


def test_nan_is_rejected_by_the_loader(tmp_path: Path) -> None:
    path = tmp_path / "nan.json"
    path.write_text('{"n": NaN}')
    with pytest.raises(CaseParseError):
        load_json(path)


def _write_schema(directory: Path, name: str, body: dict[str, Any]) -> None:
    schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$id": f"urn:specter-arena:contract:{name}:v1",
        **body,
    }
    (directory / f"{name}.v1.schema.json").write_text(json.dumps(schema))


def test_ref_in_array_items_resolves_across_files(tmp_path: Path) -> None:
    """A $ref as the `items` member resolves, and a failing item has a deep pointer."""
    _write_schema(
        tmp_path,
        "inner",
        {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
            "additionalProperties": False,
        },
    )
    _write_schema(
        tmp_path,
        "list",
        {
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": {"$ref": "urn:specter-arena:contract:inner:v1"}}
            },
            "required": ["items"],
            "additionalProperties": False,
        },
    )
    validate = compile_schema("urn:specter-arena:contract:list:v1", load_registry(tmp_path))
    validate({"items": [{"id": "a"}]})
    with pytest.raises(fastjsonschema.JsonSchemaValueException) as raised:
        validate({"items": [{"id": "a"}, {"id": 2}]})
    assert error_pointer(raised.value) == "/items/1/id"


def test_ref_to_a_definition_fragment_resolves(tmp_path: Path) -> None:
    _write_schema(
        tmp_path,
        "inner",
        {
            "type": "object",
            "definitions": {"id": {"type": "string", "pattern": "^[a-z]+$"}},
            "properties": {"id": {"$ref": "#/definitions/id"}},
            "required": ["id"],
            "additionalProperties": False,
        },
    )
    _write_schema(
        tmp_path,
        "outer",
        {
            "type": "object",
            "properties": {"id": {"$ref": "urn:specter-arena:contract:inner:v1#/definitions/id"}},
            "required": ["id"],
            "additionalProperties": False,
        },
    )
    validate = compile_schema("urn:specter-arena:contract:outer:v1", load_registry(tmp_path))
    validate({"id": "abc"})
    with pytest.raises(fastjsonschema.JsonSchemaValueException) as raised:
        validate({"id": "ABC"})
    assert error_pointer(raised.value) == "/id"


def test_whole_schema_ref_to_a_schema_with_local_refs_does_not_compile(
    tmp_path: Path,
) -> None:
    """Why VERSIONING.md forbids local #/definitions refs in a schema that others $ref whole."""
    _write_schema(
        tmp_path,
        "inner",
        {
            "type": "object",
            "definitions": {"id": {"type": "string"}},
            "properties": {"id": {"$ref": "#/definitions/id"}},
        },
    )
    _write_schema(
        tmp_path,
        "outer",
        {"type": "array", "items": {"$ref": "urn:specter-arena:contract:inner:v1"}},
    )
    with pytest.raises(fastjsonschema.JsonSchemaDefinitionException):
        compile_schema("urn:specter-arena:contract:outer:v1", load_registry(tmp_path))
