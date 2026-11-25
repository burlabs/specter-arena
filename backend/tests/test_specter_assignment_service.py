"""SpecterService assignment: `specters.v3` reads and `assign_hero` over the real store (FP-23)."""

import asyncio
from collections.abc import Awaitable, Callable, Coroutine, Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.specters.heroes import load_heroes
from backend.specter_arena.specters.service import SpecterError, SpecterService
from backend.specter_arena.store import HERO_IDS, DmKey, Store, open_store

from .contract_support import compile_schema, load_registry
from .specter_fakes import ALPHA, BETA, FakeClock, bind, table_counts

REGISTRY = load_registry()
SPECTER_V3 = compile_schema("urn:specter-arena:contract:specter:v3", REGISTRY)
SPECTERS_V3 = compile_schema("urn:specter-arena:contract:specters:v3", REGISTRY)
SPECTERS_V2 = compile_schema("urn:specter-arena:contract:specters:v2", REGISTRY)
GAMMA = DmKey("gamma-0123456789ab", "memory-gamma")
HEROES = {hero.id: hero for hero in load_heroes()}
AID = "ast_" + "b" * 24


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def run[T](scenario: Callable[[], Coroutine[Any, Any, T]]) -> T:
    return asyncio.run(scenario())


async def code_of(coro: Awaitable[Any]) -> tuple[str, int]:
    try:
        await coro
    except SpecterError as error:
        return error.code, error.status
    raise AssertionError("expected a SpecterError")


def make(store: Store) -> SpecterService:
    return SpecterService(store, clock=FakeClock())


def test_a_store_with_no_bindings_lists_nothing(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        body = await service.list_assignment()
        SPECTERS_V3(body)
        assert body == {"contractVersion": 3, "items": [], "unassignedBindingIds": []}

    run(scenario)


def test_new_bindings_are_listed_as_unassigned_and_v2_leaves_them_out(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        one = bind(store, ALPHA, "Alpha", assign=False)
        two = bind(store, BETA, "Beta", assign=False)
        body = await service.list_assignment()
        SPECTERS_V3(body)
        assert body["items"] == [] and body["unassignedBindingIds"] == [one, two]
        v2 = await service.list_specters()
        SPECTERS_V2(v2)
        assert v2["items"] == []
        assert await code_of(service.get_assignment(one)) == ("no_hero", 404)
        assert await code_of(service.get_specter(one)) == ("unknown_binding", 404)

    run(scenario)


def test_assigning_a_picked_hero_returns_specter_v3_with_the_fixed_hero_text(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        binding = bind(store, ALPHA, "Alpha", assign=False)
        made = await service.assign_hero(binding, 0, "ember")
        SPECTER_V3(made)
        hero = HEROES["ember"]
        assert made["contractVersion"] == 3 and made["assignedBy"] == "picked"
        assert (made["heroId"], made["ordinal"], made["displayName"]) == ("ember", 1, "Ember")
        assert (made["name"], made["epithet"]) == (hero.name, hero.epithet)
        assert (made["personality"], made["appearance"]) == (hero.personality, hero.appearance)
        assert made["version"] == 0 and made["avatarChosen"] is False
        assert made["source"] == "roster" and made["createdAtMs"] == made["updatedAtMs"]
        assert made["portrait"]["dataBase64"] is None and made["portrait"]["origin"] == "bundled"
        assert await service.get_assignment(binding) == made

    run(scenario)


def test_the_second_holder_of_a_hero_is_named_with_a_numeral(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        one = bind(store, ALPHA, "Alpha", assign=False)
        two = bind(store, BETA, "Beta", assign=False)
        await service.assign_hero(one, 0, "vell")
        second = await service.assign_hero(two, 0, "vell")
        SPECTER_V3(second)
        assert (second["ordinal"], second["displayName"]) == (2, "Vell II")

    run(scenario)


def test_a_random_assignment_is_random_and_a_list_shows_both_sets(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        one = bind(store, ALPHA, "Alpha", assign=False)
        two = bind(store, BETA, "Beta", assign=False)
        three = bind(store, GAMMA, "Gamma", assign=False)
        first = await service.assign_hero(one, 0, None)
        second = await service.assign_hero(two, 0, None)
        SPECTER_V3(first)
        assert first["assignedBy"] == second["assignedBy"] == "random"
        assert first["heroId"] != second["heroId"] and {first["heroId"], second["heroId"]} <= set(
            HERO_IDS
        )
        body = await service.list_assignment()
        SPECTERS_V3(body)
        assert [item["bindingId"] for item in body["items"]] == [one, two]
        assert body["unassignedBindingIds"] == [three]

    run(scenario)


def test_the_replay_rules(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        binding = bind(store, ALPHA, "Alpha", assign=False)
        made = await service.assign_hero(binding, 0, "tide")
        assert await service.assign_hero(binding, 0, "tide") == made
        assert await service.assign_hero(binding, 5, "tide") == made
        assert await code_of(service.assign_hero(binding, 0, "vell")) == ("version_conflict", 409)
        assert await code_of(service.assign_hero(binding, 0, None)) == ("version_conflict", 409)
        assert (await service.get_assignment(binding)) == made

    run(scenario)


def test_an_unassigned_binding_with_a_wrong_expected_version_is_a_conflict(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        binding = bind(store, ALPHA, "Alpha", assign=False)
        assert await code_of(service.assign_hero(binding, 1, "vell")) == ("version_conflict", 409)

    run(scenario)


@pytest.mark.parametrize(
    ("binding", "expected", "hero", "code", "status"),
    [
        ("bnd_" + "0" * 24, 0, "vell", "unknown_binding", 404),
        ("nope", 0, "vell", "unknown_binding", 404),
        (None, 0, "vell", "unknown_binding", 404),
        ("real", -1, "vell", "invalid_body", 400),
        ("real", True, "vell", "invalid_body", 400),
        ("real", "0", "vell", "invalid_body", 400),
        ("real", 2**53, "vell", "invalid_body", 400),
        ("real", 0, "nova", "invalid_body", 400),
        ("real", 0, 7, "invalid_body", 400),
        ("real", 0, "", "invalid_body", 400),
    ],
)
def test_bad_arguments_are_mapped_to_contract_errors_and_write_nothing(
    store: Store, binding: Any, expected: Any, hero: Any, code: str, status: int
) -> None:
    async def scenario() -> None:
        service = make(store)
        real = bind(store, ALPHA, "Alpha", assign=False)
        before = table_counts(store, except_prefixes=())
        target = real if binding == "real" else binding
        assert await code_of(service.assign_hero(target, expected, hero)) == (code, status)
        assert table_counts(store, except_prefixes=()) == before

    run(scenario)


def test_the_portrait_of_an_unassigned_binding_is_no_hero(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        binding = bind(store, ALPHA, "Alpha", assign=False)
        assert await code_of(service.set_portrait(binding, 0, None)) == ("no_hero", 404)
        assert await code_of(service.set_portrait("bnd_" + "0" * 24, 0, None)) == (
            "unknown_binding",
            404,
        )

    run(scenario)


def test_the_avatar_flow_after_an_assignment_uses_version_zero(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        binding = bind(store, ALPHA, "Alpha", assign=False)
        made = await service.assign_hero(binding, 0, "moss")
        gallery = await service.list_portraits()
        other = next(
            item for item in gallery["items"] if item["assetId"] != made["portrait"]["assetId"]
        )
        chosen = await service.set_portrait(binding, made["version"], other["assetId"])
        SPECTER_V3(await service.get_assignment(binding))
        assert chosen["version"] == 1 and chosen["avatarChosen"] is True
        again = await service.get_assignment(binding)
        assert again["version"] == 1 and again["assignedBy"] == "picked"

    run(scenario)


def test_assigning_never_touches_xp_tasks_work_or_the_binding(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        ids = [bind(store, key, name, assign=False) for key, name in ((ALPHA, "A"), (BETA, "B"))]
        before = table_counts(store, except_prefixes=("hero_assignment",))
        await service.assign_hero(ids[0], 0, "reeve")
        await service.assign_hero(ids[1], 0, None)
        assert table_counts(store, except_prefixes=("hero_assignment",)) == before
        assert table_counts(store, except_prefixes=())["hero_assignment"] == 2

    run(scenario)


def test_a_migrated_row_reads_as_auto(store: Store) -> None:
    async def scenario() -> None:
        service = make(store)
        await service.start()
        binding = bind(store, ALPHA, "Alpha", assign=False)
        with store.write() as conn:
            conn.execute(
                "INSERT INTO hero_assignment VALUES (?, 0, 'vell', 1, 1800000000000, 'auto')",
                (binding,),
            )
        body = await service.get_assignment(binding)
        SPECTER_V3(body)
        assert body["assignedBy"] == "auto"
        assert (await service.list_assignment())["items"][0]["assignedBy"] == "auto"

    run(scenario)
