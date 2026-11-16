"""Loads the wire schemas under contracts/ and validates instances the way the UI tests do.

Test-time only (the validator is a dev dependency): release code never imports this module,
and nothing under backend/specter_arena reads contracts/.
"""

import json
import re
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import fastjsonschema

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
SCHEMA_FILE = re.compile(r"^(?P<name>[a-z][a-z0-9-]*)\.v(?P<major>[1-9][0-9]*)\.schema\.json$")

Validator = Callable[[Any], Any]


class CaseParseError(ValueError):
    """A case file that is not JSON (including NaN and Infinity, which JavaScript rejects too)."""


def _reject_constant(token: str) -> Any:
    raise CaseParseError(f"non-finite number {token}")


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_constant)
    except json.JSONDecodeError as error:
        raise CaseParseError(str(error)) from error


def load_registry(schemas_dir: Path = CONTRACTS_DIR / "schemas") -> dict[str, dict[str, Any]]:
    """Every schema by its $id, so a $ref by $id resolves without network access."""
    registry: dict[str, dict[str, Any]] = {}
    for path in sorted(schemas_dir.glob("*.schema.json")):
        schema = load_json(path)
        registry[schema["$id"]] = schema
    return registry


def compile_schema(schema_id: str, registry: Mapping[str, dict[str, Any]]) -> Validator:
    return fastjsonschema.compile(
        registry[schema_id], handlers={"urn": lambda uri: registry[uri.split("#")[0]]}
    )


def error_pointer(error: Any) -> str:
    """JSON Pointer of the failing location (wire property names are plain camelCase)."""
    parts = [part for part in error.path[1:]]
    return "".join("/" + re.sub(r"^\[(\d+)\]$", r"\1", str(part)) for part in parts)
