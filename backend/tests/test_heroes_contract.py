"""The roster against the wire contract and the migration's own hero list."""

import json
import re
from pathlib import Path
from typing import Any

from backend.specter_arena.specters.heroes import HEROES_PATH, display_name, load_heroes
from backend.specter_arena.store import HERO_IDS

from .contract_support import CONTRACTS_DIR, compile_schema, load_registry

REGISTRY = load_registry()
SPECTER_V2 = "urn:specter-arena:contract:specter:v2"
MIGRATION = (
    Path(__file__).resolve().parents[1] / "specter_arena/store/migrations/0007_hero_roster.sql"
)


def test_the_schema_enum_equals_the_roster_ids_in_order() -> None:
    schema = json.loads((CONTRACTS_DIR / "schemas/specter.v2.schema.json").read_text())
    assert schema["properties"]["heroId"]["enum"] == [hero.id for hero in load_heroes()]


def body_for(index: int, ordinal: int) -> dict[str, Any]:
    hero = load_heroes()[index]
    return {
        "contractVersion": 2,
        "bindingId": "bnd_0a1b2c3d4e5f60718293a4b5",
        "version": 0,
        "heroId": hero.id,
        "ordinal": ordinal,
        "displayName": display_name(hero, ordinal),
        "name": hero.name,
        "epithet": hero.epithet,
        "personality": hero.personality,
        "appearance": hero.appearance,
        "portrait": {
            "contractVersion": 1,
            "assetId": "ast_0123456789abcdef01234567",
            "mediaType": "image/png",
            "width": 256,
            "height": 256,
            "byteLength": 1000,
            "origin": "bundled",
            "label": "x",
            "dataBase64": None,
        },
        "avatarChosen": False,
        "source": "roster",
        "createdAtMs": 1,
        "updatedAtMs": 1,
    }


def test_the_roster_text_validates_against_the_v2_schema() -> None:
    validate = compile_schema(SPECTER_V2, REGISTRY)
    for index in range(len(load_heroes())):
        validate(body_for(index, 1))
        validate(body_for(index, 2))


def test_the_sql_hero_list_equals_heroes_json() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    check = sql[sql.index("CASE assignment_no % 11") : sql.index("END", sql.index("CASE"))]
    assert re.findall(r"'([a-z]+)'", check) == [hero.id for hero in load_heroes()]
    assert list(HERO_IDS) == [hero.id for hero in load_heroes()]


def test_the_roster_file_is_the_one_the_loader_reads() -> None:
    assert json.loads(HEROES_PATH.read_text())["heroes"][0]["id"] == "vell"
    assert re.fullmatch(r"[a-z]+", load_heroes()[0].id)
