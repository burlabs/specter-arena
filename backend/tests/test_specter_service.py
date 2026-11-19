"""SpecterService against the real work-ledger store: hero reads, the avatar and the assets."""

import asyncio
import base64
import hashlib
import logging
from collections.abc import Awaitable, Callable, Coroutine, Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.specters import service as service_module
from backend.specter_arena.specters.bundled import BUNDLED, BundledArtError
from backend.specter_arena.specters.heroes import load_heroes
from backend.specter_arena.specters.service import SpecterError, SpecterService
from backend.specter_arena.store import DmKey, Store, open_store
from backend.specter_arena.store import specters as db

from .png_support import png
from .specter_fakes import ALPHA, BETA, FakeClock, bind, table_counts

AVATAR_TABLES = ("hero_assignment", "avatar_revision", "asset")
HERO_NAMES = [hero.name for hero in load_heroes()]


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


class Rig:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.b1 = bind(store, ALPHA, "Probe Bot")
        self.b2 = bind(store, BETA, "Other Bot")
        self.clock = FakeClock()
        self.service = SpecterService(store, clock=self.clock)


def run[T](scenario: Callable[[], Coroutine[Any, Any, T]]) -> T:
    return asyncio.run(scenario())


async def code_of(coro: Awaitable[Any]) -> tuple[str, int]:
    try:
        await coro
    except SpecterError as error:
        return error.code, error.status
    raise AssertionError("expected a SpecterError")


def up(raw: bytes, **extra: Any) -> dict[str, Any]:
    return {"mediaType": "image/png", "dataBase64": base64.b64encode(raw).decode(), **extra}


def default_asset_id(slug: str) -> str:
    return "ast_" + next(a.sha256 for a in BUNDLED if a.slug == slug)[:24]


def test_list_returns_items_in_assignment_order_with_hero_text(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        listed = await rig.service.list_specters()
        assert listed["contractVersion"] == 2
        first, second = listed["items"]
        assert [first["bindingId"], second["bindingId"]] == [rig.b1, rig.b2]
        assert (first["heroId"], first["displayName"], first["ordinal"]) == ("vell", "Vell", 1)
        assert (second["heroId"], second["displayName"]) == ("stitch", "Stitch")
        hero = load_heroes()[0]
        assert (first["epithet"], first["personality"], first["appearance"]) == (
            hero.epithet,
            hero.personality,
            hero.appearance,
        )
        assert first["source"] == "roster" and first["version"] == 0

    run(scenario)


def test_unchosen_avatar_is_the_bundled_portrait_with_null_data(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        item = await rig.service.get_specter(rig.b1)
        assert item["avatarChosen"] is False
        assert item["portrait"]["assetId"] == default_asset_id("vell")
        assert item["portrait"]["origin"] == "bundled" and item["portrait"]["dataBase64"] is None

    run(scenario)


def test_chosen_avatar_is_the_picked_asset_and_avatar_chosen_true(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        art = await rig.service.upload_asset(up(png()))
        changed = await rig.service.set_portrait(rig.b1, 0, art["assetId"])
        assert changed["avatarChosen"] is True and changed["version"] == 1
        assert changed["portrait"]["assetId"] == art["assetId"]
        assert (await rig.service.get_specter(rig.b1))["portrait"]["assetId"] == art["assetId"]
        listed = (await rig.service.list_specters())["items"]
        assert listed[0]["portrait"]["assetId"] == art["assetId"]
        assert listed[1]["portrait"]["assetId"] == default_asset_id("stitch")

    run(scenario)


def test_reset_returns_to_the_hero_portrait(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        art = await rig.service.upload_asset(up(png()))
        await rig.service.set_portrait(rig.b1, 0, art["assetId"])
        reset = await rig.service.set_portrait(rig.b1, 1, None)
        assert reset["avatarChosen"] is False and reset["version"] == 2
        assert reset["portrait"]["assetId"] == default_asset_id("vell")
        again = await rig.service.set_portrait(rig.b1, 2, None)
        assert again["version"] == 2  # already the hero portrait: nothing appended

    run(scenario)


def test_changing_the_avatar_never_changes_hero_text_name_or_ordinal(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        before = await rig.service.get_specter(rig.b1)
        art = await rig.service.upload_asset(up(png()))
        after = await rig.service.set_portrait(rig.b1, 0, art["assetId"])
        fixed = ("heroId", "ordinal", "displayName", "name", "epithet", "personality", "appearance")
        assert {k: after[k] for k in fixed} == {k: before[k] for k in fixed}
        assert after["createdAtMs"] == before["createdAtMs"]

    run(scenario)


def test_second_round_gets_a_roman_display_name(store: Store) -> None:
    async def scenario() -> None:
        bindings = [
            bind(store, DmKey(f"bot{n:02d}-0123456789ab", f"memory-{n:02d}"), f"Bot {n}")
            for n in range(12)
        ]
        service = SpecterService(store, clock=FakeClock())
        await service.start()
        items = (await service.list_specters())["items"]
        assert [i["bindingId"] for i in items] == bindings
        assert [i["name"] for i in items[:11]] == HERO_NAMES
        assert (items[11]["displayName"], items[11]["ordinal"]) == ("Vell II", 2)
        assert items[10]["displayName"] == "bur"

    run(scenario)


def test_unknown_and_malformed_binding_are_404_unknown_binding(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        unknown = "bnd_" + "f" * 24
        for bad in (unknown, "bnd_short", "../x", 7):
            assert await code_of(rig.service.get_specter(bad)) == ("unknown_binding", 404)  # type: ignore[arg-type]
            assert await code_of(rig.service.set_portrait(bad, 0, None)) == (  # type: ignore[arg-type]
                "unknown_binding",
                404,
            )

    run(scenario)


def test_version_conflict_is_409(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        assert await code_of(rig.service.set_portrait(rig.b1, 3, None)) == ("version_conflict", 409)

    run(scenario)


def test_unknown_asset_is_404(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        absent = "ast_" + "0" * 24
        assert await code_of(rig.service.set_portrait(rig.b1, 0, absent)) == ("unknown_asset", 404)
        assert await code_of(rig.service.get_asset(absent)) == ("unknown_asset", 404)

    run(scenario)


@pytest.mark.parametrize("bad", [True, -1, 2**53, "1", 1.5, None])
def test_expected_version_must_be_a_non_negative_int(store: Store, bad: object) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        assert await code_of(rig.service.set_portrait(rig.b1, bad, None)) == ("invalid_body", 400)

    run(scenario)


@pytest.mark.parametrize("bad", [5, ["x"], {"a": 1}])
def test_asset_id_must_be_a_string_or_null(store: Store, bad: object) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        assert await code_of(rig.service.set_portrait(rig.b1, 0, bad)) == ("invalid_body", 400)

    run(scenario)


def test_a_malformed_asset_id_is_404_unknown_asset(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        zeros = "ast_" + "0" * 24
        for bad in ("../../etc/passwd", "ast_" + "g" * 24, "ast_0123", zeros + "\n"):
            assert await code_of(rig.service.set_portrait(rig.b1, 0, bad)) == ("unknown_asset", 404)

    run(scenario)


def test_start_installs_all_eleven_bundled_portraits_once(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        await rig.service.start()
        items = (await rig.service.list_portraits())["items"]
        assert len(items) == len(BUNDLED) == 11
        assert sorted(i["label"] for i in items) == sorted(a.label for a in BUNDLED)
        assert all(i["origin"] == "bundled" and i["dataBase64"] is None for i in items)
        assert sorted(i["assetId"] for i in items) == sorted(
            "ast_" + a.sha256[:24] for a in BUNDLED
        )
        assert [i["assetId"] for i in items] == ["ast_" + a.sha256[:24] for a in BUNDLED]

    run(scenario)


def test_start_with_tampered_art_logs_once_by_type_only_and_reads_fail_503(
    store: Store, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def scenario() -> None:
        def broken() -> None:
            raise BundledArtError("vell")

        monkeypatch.setattr(service_module, "prepare", broken)
        rig = Rig(store)
        with caplog.at_level(logging.WARNING, logger="specter_arena.specters.service"):
            await rig.service.start()
        assert [r.getMessage() for r in caplog.records] == [
            "bundled portraits not installed: BundledArtError"
        ]
        assert "vell" not in caplog.text  # the file name is not logged
        assert db.list_assets(store) == ()  # none served
        assert await code_of(rig.service.get_specter(rig.b1)) == ("store_unavailable", 503)
        assert await code_of(rig.service.list_specters()) == ("store_unavailable", 503)

    run(scenario)


def test_upload_rejections(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        s = rig.service
        assert await code_of(s.upload_asset({**up(png()), "mediaType": "image/jpeg"})) == (
            "unsupported_media",
            415,
        )
        assert await code_of(s.upload_asset({**up(png()), "mediaType": "image/svg+xml"})) == (
            "unsupported_media",
            415,
        )
        svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
        assert await code_of(s.upload_asset(up(svg))) == ("unsupported_media", 415)
        huge = {"mediaType": "image/png", "dataBase64": "A" * 1_398_105}
        assert await code_of(s.upload_asset(huge)) == ("asset_too_large", 413)
        assert await code_of(s.upload_asset(up(b"\x00" * 1_048_577))) == ("asset_too_large", 413)
        assert await code_of(s.upload_asset(up(png()[:-6]))) == ("invalid_image", 422)
        assert await code_of(
            s.upload_asset({"mediaType": "image/png", "dataBase64": "not base64!"})
        ) == ("invalid_body", 400)
        assert await code_of(s.upload_asset({"mediaType": "image/png", "dataBase64": 5})) == (
            "invalid_body",
            400,
        )
        assert await code_of(s.upload_asset({**up(png()), "url": "http://x"})) == (
            "invalid_body",
            400,
        )
        assert await code_of(s.upload_asset({**up(png()), "label": "<img>"})) == (
            "invalid_body",
            400,
        )
        assert await code_of(s.upload_asset({**up(png()), "label": "l" * 81})) == (
            "invalid_body",
            400,
        )
        assert await code_of(s.upload_asset({**up(png()), "label": 5})) == ("invalid_body", 400)
        assert await code_of(s.upload_asset([])) == ("invalid_body", 400)
        assert db.list_assets(store) == ()

    run(scenario)


def test_a_valid_upload_is_reencoded_stored_once_and_served_with_data(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        first = await rig.service.upload_asset(up(png(5, 4), label="My original art"))
        again = await rig.service.upload_asset(up(png(5, 4), label="Same bytes, other label"))
        assert first["assetId"] == again["assetId"] and first["origin"] == "uploaded"
        assert again["label"] == "My original art"  # the first writer's label wins
        served = await rig.service.get_asset(first["assetId"])
        raw = base64.b64decode(served["dataBase64"])
        assert first["assetId"] == "ast_" + hashlib.sha256(raw).hexdigest()[:24]
        assert raw.startswith(b"\x89PNG") and served["byteLength"] == len(raw)
        assert first["dataBase64"] is None
        assert len(db.list_assets(store)) == 1

    run(scenario)


def test_an_upload_without_a_label_gets_the_default(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        assert (await rig.service.upload_asset(up(png())))["label"] == "Uploaded portrait"

    run(scenario)


def test_the_gallery_lists_bundled_art_first(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        await rig.service.upload_asset(up(png()))
        origins = [i["origin"] for i in (await rig.service.list_portraits())["items"]]
        assert origins == ["bundled"] * 11 + ["uploaded"]

    run(scenario)


def test_more_than_200_assets_still_resolves_a_chosen_upload(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        ids = []
        for n in range(1, 206):
            ids.append(
                (await rig.service.upload_asset(up(png(1 + n % 50, 1 + n // 50))))["assetId"]
            )
        assert len(set(ids)) == 205
        newest = ids[-1]
        assert newest not in {i["assetId"] for i in (await rig.service.list_portraits())["items"]}
        chosen = await rig.service.set_portrait(rig.b1, 0, newest)
        assert chosen["portrait"]["assetId"] == newest
        assert (await rig.service.list_specters())["items"][0]["portrait"]["assetId"] == newest

    run(scenario)


def test_avatar_changes_write_only_avatar_rows(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.start()
        before = table_counts(store, except_prefixes=AVATAR_TABLES)
        art = await rig.service.upload_asset(up(png()))
        await rig.service.set_portrait(rig.b1, 0, art["assetId"])
        await rig.service.set_portrait(rig.b1, 1, None)
        assert table_counts(store, except_prefixes=AVATAR_TABLES) == before

    run(scenario)


def test_close_marks_the_service_closed(store: Store) -> None:
    async def scenario() -> None:
        rig = Rig(store)
        await rig.service.close()
        assert rig.service._closed is True

    run(scenario)


def test_the_service_has_no_summoner_budget_or_request_surface(store: Store) -> None:
    service = SpecterService(store, clock=FakeClock())
    for name in (
        "start_summoning",
        "get_summoning",
        "cancel_summoning",
        "accept",
        "save_manual",
        "rename",
        "archive",
        "_summoner",
        "_limits",
        "_tasks",
    ):
        assert not hasattr(service, name), name
