"""The scene rasters the live arena reads from the backend (SC10-1): pinned files, the scene PNG
limits, the `scene-asset.v1` body and the verified lookup."""

import base64
import hashlib
from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.applications import Starlette
from starlette.testclient import TestClient

from backend.specter_arena.specter_routes import specter_routes
from backend.specter_arena.specters.bundled import BUNDLED
from backend.specter_arena.specters.heroes import load_heroes
from backend.specter_arena.specters.png import ImageRejected, reencode_png
from backend.specter_arena.specters.scene_art import (
    HERO_SCENE,
    SCENE,
    SCENE_DIR,
    SCENE_MAX_BYTES,
    SCENE_MAX_SIDE,
    SceneArt,
    SceneArtError,
    get_scene_asset,
    load_scene_art,
    prepare_scene_art,
)
from backend.specter_arena.specters.service import SpecterService
from backend.specter_arena.store import Store, open_store

from .contract_support import compile_schema, load_registry
from .specter_fakes import FakeClock
from .test_specter_routes import SECRET, Api

REGISTRY = load_registry()
SCHEMA = compile_schema("urn:specter-arena:contract:scene-asset:v1", REGISTRY)
PORTRAIT = compile_schema("urn:specter-arena:contract:portrait-asset:v1", REGISTRY)
BASE_KEYS = [
    "arena-map",
    "minion-patchling-sprite",
    "minion-patchbrute-sprite",
    "minion-patchling-portrait",
    "minion-patchbrute-portrait",
]
HERO_KEYS = [key for hero in load_heroes() for key in (hero.sprite_key, hero.thumbnail_key)]
KEYS = [*BASE_KEYS, *HERO_KEYS]
SIZES = {  # width, height, byte length of the pinned export files
    "arena-map": (1672, 941, 2_096_047),
    "minion-patchling-sprite": (512, 512, 166_244),
    "minion-patchbrute-sprite": (512, 512, 237_354),
    "minion-patchling-portrait": (256, 256, 72_210),
    "minion-patchbrute-portrait": (256, 256, 87_269),
    "hero-vell-sprite": (512, 512, 123_954),
    "hero-vell-thumbnail": (96, 96, 9_364),
    "hero-stitch-sprite": (512, 512, 121_677),
    "hero-stitch-thumbnail": (96, 96, 9_668),
    "hero-reeve-sprite": (512, 512, 153_328),
    "hero-reeve-thumbnail": (96, 96, 11_489),
    "hero-rattle-sprite": (512, 512, 138_563),
    "hero-rattle-thumbnail": (96, 96, 11_578),
    "hero-ember-sprite": (512, 512, 88_422),
    "hero-ember-thumbnail": (96, 96, 7_480),
    "hero-shard-sprite": (512, 512, 105_620),
    "hero-shard-thumbnail": (96, 96, 8_653),
    "hero-poly-sprite": (512, 512, 162_474),
    "hero-poly-thumbnail": (96, 96, 10_708),
    "hero-tide-sprite": (512, 512, 142_525),
    "hero-tide-thumbnail": (96, 96, 11_081),
    "hero-lume-sprite": (512, 512, 106_784),
    "hero-lume-thumbnail": (96, 96, 8_159),
    "hero-moss-sprite": (512, 512, 126_180),
    "hero-moss-thumbnail": (96, 96, 9_686),
    "hero-bur-sprite": (512, 512, 185_420),
    "hero-bur-thumbnail": (96, 96, 13_024),
}


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


@pytest.fixture
def opened(tmp_path: Path) -> Iterator[Store]:
    instance = open_store(tmp_path / "data")
    try:
        yield instance
    finally:
        instance.close()


def started(opened: Store) -> tuple[Starlette, SpecterService]:
    service = SpecterService(opened, clock=FakeClock())
    app = Starlette(routes=specter_routes())
    app.state.specters = service
    return app, service


def test_the_allowlist_is_the_five_base_keys_then_the_22_hero_keys_and_each_file_exists() -> None:
    assert [art.key for art in SCENE] == KEYS
    assert len(KEYS) == 27 and len(HERO_KEYS) == 22
    assert sorted(p.name for p in SCENE_DIR.glob("*.png")) == sorted(f"{k}.png" for k in KEYS)
    assert (SCENE_MAX_BYTES, SCENE_MAX_SIDE) == (4_194_304, 4096)


def test_every_file_matches_its_pin_and_builds_a_valid_scene_asset_body() -> None:
    loaded = load_scene_art()
    assert list(loaded) == KEYS  # none skipped
    for art in SCENE:
        body = loaded[art.key]
        SCHEMA(body)
        raw = (SCENE_DIR / f"{art.key}.png").read_bytes()
        assert base64.b64decode(body["dataBase64"], validate=True) == raw
        assert body["sha256"] == art.sha256 == hashlib.sha256(raw).hexdigest()
        width, height, size = SIZES[art.key]
        assert (body["width"], body["height"], body["byteLength"]) == (width, height, size)
        assert len(raw) == size


def test_the_arena_map_passes_the_scene_limits_and_fails_the_portrait_limits() -> None:
    raw = (SCENE_DIR / "arena-map.png").read_bytes()
    with pytest.raises(ImageRejected) as portrait_rules:
        reencode_png(raw)
    assert portrait_rules.value.reason == "input-size"
    checked = reencode_png(raw, max_bytes=SCENE_MAX_BYTES, max_side=SCENE_MAX_SIDE)
    assert (checked.width, checked.height) == (1672, 941)


def test_a_tampered_or_missing_file_is_left_out_and_the_others_are_still_served() -> None:
    def tampered(path: Path) -> bytes:
        data = path.read_bytes()
        if path.name == "arena-map.png":
            return data[:-20] + bytes([data[-20] ^ 1]) + data[-19:]
        if path.name == "minion-patchling-sprite.png":
            raise FileNotFoundError(path)
        return data

    assert (
        list(load_scene_art(reader=tampered)) == KEYS[2:]
    )  # arena-map and the first sprite are out
    with pytest.raises(SceneArtError):
        prepare_scene_art(SCENE[0], reader=tampered)


def test_a_pinned_file_that_breaks_the_scene_rules_is_not_served(tmp_path: Path) -> None:
    junk = b"\x89PNG\r\n\x1a\n" + b"not a png"
    art = SceneArt("junk", hashlib.sha256(junk).hexdigest(), "junk.png")
    (tmp_path / "junk.png").write_bytes(junk)
    with pytest.raises(SceneArtError):
        prepare_scene_art(art, tmp_path)


def test_scene_rasters_never_enter_the_gallery_and_the_gallery_has_eleven_in_bundled_order(
    opened: Store,
) -> None:
    app, service = started(opened)
    with TestClient(app) as client:
        client.portal.call(service.start)  # type: ignore[union-attr]
        client.portal.call(service.start)  # type: ignore[union-attr]  # a restart adds nothing
        api = Api(client)
        items = api.get("/api/portraits").json()["items"]
        scene_ids = {"ast_" + art.sha256[:24] for art in SCENE}
        assert all(api.get(f"/api/assets/{i}").status_code == 404 for i in scene_ids)
    for item in items:
        PORTRAIT(item)
    assert [i["label"] for i in items] == [a.label for a in BUNDLED]
    assert [i["assetId"] for i in items] == ["ast_" + a.sha256[:24] for a in BUNDLED]
    assert not {i["assetId"] for i in items} & scene_ids
    assert all(i["origin"] == "bundled" and i["dataBase64"] is None for i in items)


def test_the_lookup_returns_the_verified_body_or_none() -> None:
    body = get_scene_asset("arena-map")
    assert body is not None and body["key"] == "arena-map"
    assert get_scene_asset("arena-map") is body  # loaded once per process
    assert get_scene_asset("nope") is None


def test_every_hero_key_loads_with_its_size_and_none_is_skipped_silently() -> None:
    loaded = load_scene_art()
    assert [key for key in HERO_KEYS if key not in loaded] == []
    for key in HERO_KEYS:
        width, height = (512, 512) if key.endswith("-sprite") else (96, 96)
        assert (loaded[key]["width"], loaded[key]["height"]) == (width, height)
        assert (SIZES[key][0], SIZES[key][1]) == (width, height)


def test_every_hero_in_the_roster_has_a_sprite_and_a_thumbnail_pinned_in_the_allowlist() -> None:
    pinned = {art.key for art in HERO_SCENE}
    roster = {key for hero in load_heroes() for key in (hero.sprite_key, hero.thumbnail_key)}
    assert pinned == roster and len(pinned) == 22
    assert all(art.source.endswith(("-sprite.png", "-thumbnail.png")) for art in HERO_SCENE)


def test_a_tampered_hero_file_is_left_out_and_every_other_key_is_still_served() -> None:
    def tampered(path: Path) -> bytes:
        data = path.read_bytes()
        if path.name == "hero-moss-sprite.png":
            return data[:-20] + bytes([data[-20] ^ 1]) + data[-19:]
        return data

    served = load_scene_art(reader=tampered)
    assert "hero-moss-sprite" not in served
    assert list(served) == [key for key in KEYS if key != "hero-moss-sprite"]


def test_the_hero_route_headers_carry_size_hash_and_length(opened: Store) -> None:
    app, _service = started(opened)
    with TestClient(app) as client:
        api = Api(client)
        for key, side in (("hero-vell-sprite", 512), ("hero-vell-thumbnail", 96)):
            body = api.get(f"/api/scene-assets/{key}").json()
            SCHEMA(body)
            raw = (SCENE_DIR / f"{key}.png").read_bytes()
            assert (body["contractVersion"], body["width"], body["height"]) == (1, side, side)
            assert body["sha256"] == hashlib.sha256(raw).hexdigest()
            assert body["byteLength"] == len(raw)


def test_the_scene_directory_holds_only_allowlisted_pngs() -> None:
    tracked = {path.stem for path in SCENE_DIR.glob("*.png")}
    assert tracked == {art.key for art in SCENE}
