from __future__ import annotations

import base64
import functools
import hashlib
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from .png import ImageRejected, reencode_png

CONTRACT_VERSION: Final = 1  # scene-asset.v1 (FROZEN)
SCENE_DIR: Final = Path(__file__).with_name("scene")
SCENE_MAX_BYTES: Final = 4_194_304  # 4 MiB; the portrait limit is 1 MiB
SCENE_MAX_SIDE: Final = 4096  # the portrait limit is 1024


@dataclass(frozen=True, slots=True)
class SceneArt:
    key: str
    sha256: str  # of the shipped file, pinned in code
    source: str  # file name in the Figma Make export, provenance only


# Rasters the arena draws from the backend instead of inlining them into ui/dist. They are not
# portraits and never appear in the gallery. The file for a key is `scene/<key>.png`.
_BASE_SCENE: Final[tuple[SceneArt, ...]] = (
    SceneArt(
        "arena-map",
        "58cac8daa5aa13448f075e203648f43c677cec5ef69e55b2638d7c7340565f7d",
        "arena-map.png",
    ),
    SceneArt(
        "minion-patchling-sprite",
        "e64f5a3de03b5df6f608871fded48f9ae8b91f719271fbdac4c6e3eae3826d6a",
        "minion-patchling-sprite.png",
    ),
    SceneArt(
        "minion-patchbrute-sprite",
        "e3dd138466d66a4fb3dddda64987366fd0b91a83e41f882619b0aa5abde254c9",
        "minion-patchbrute-sprite.png",
    ),
    SceneArt(
        "minion-patchling-portrait",
        "f540745966dc68bbea76e4168cc3cc50880f82c5384c3838d42dae8fe07d6be6",
        "minion-patchling-portrait.png",
    ),
    SceneArt(
        "minion-patchbrute-portrait",
        "08f4a47e140262cb2cfc5a5630618fea51c6021187a44bc10436463df8543e88",
        "minion-patchbrute-portrait.png",
    ),
)


# Hero id, export file prefix, sha256 of the 512 px sprite, sha256 of the 96 px thumbnail.
_HERO_PINS: Final[tuple[tuple[str, str, str, str], ...]] = (
    (
        "vell",
        "a01-vell",
        "8516a878b19dbce5a531fbd140c2c31f93d2bee240fc361bc30796f5cabd3850",
        "7a6ac9c30ef982bbd96ecfc5a322245335faeaf6277f0fec503f8062d406b816",
    ),
    (
        "stitch",
        "a01-stitch",
        "12a7ca36a67fa3d1216ddc6cb13be8e8604db747e85c14a7c881d5c1e85ece5f",
        "0cf0efbb396545df2412325914f4942e657557f9f137cee4356e4f1c3256091e",
    ),
    (
        "reeve",
        "a01-reeve",
        "4a2a44bd25923d73158ead6d03e8d0f5773e6792733f37ea2da5f1bca3e290da",
        "bc64af2946a18c9aedd844f98d26667f07977488976cc7012d6863aa237e59f7",
    ),
    (
        "rattle",
        "a02-rattle",
        "5f61f6bf8689d44f8563467237975afa26a2371b1d0373c2b2c4851eac7a6d09",
        "bbb5b61d3651395bc0a96ab15748c510117740baf99ad7d701aba59e4b2505f0",
    ),
    (
        "ember",
        "a02-ember",
        "5c1e6942b50c175b090517e0d86df320c242b405fcaf47dbc94b1f7e9b01e74d",
        "b3f13d9bd07eeeca7fe689b398bd0eb28c16276388e49479bf0bd7c53c1a116c",
    ),
    (
        "shard",
        "a02-shard",
        "70dc06555c4d20faa06f46aa7034f6aeb87058b4ddb6e15f3a312cca33c39ea7",
        "6a09b0c3c6b2dd367a68fc7da97b55a61098329cdf62c5b3514451c4f0f0066a",
    ),
    (
        "poly",
        "poly",
        "a167dcf9cc206afbd5d47ab2ad2339f94c798faee48410f619daab1fe904343d",
        "e85ce8b3a5e5c55a2955410f27d9083179567a5ca682071db4538ef6e4691fe6",
    ),
    (
        "tide",
        "a03-tide",
        "6c22e07caef201625770c1043cc84335a7115eafefefc4dde1a84c1826b5f1dc",
        "d02b7ec288bed4722a36e3d9851121471758740f717a3e7ca2367e59ae6ae645",
    ),
    (
        "lume",
        "a03-lume",
        "dc80b9f34011cb675e7727c0dd4407e8a24efe00c83d71425fc8773ec9139029",
        "31893b66277244405b307d928446a46ec094f21d7553d0ee9f634aa3b9485fcf",
    ),
    (
        "moss",
        "a03-moss",
        "0da5a3fbe87114661b826bef4f3e6dcc5566706cfc55129b1c61dd5d8a10ba37",
        "24a7b1025a0d95e9983a2e2eac2a952e5ed7d8c29c6e3a7a2030976835234257",
    ),
    (
        "bur",
        "bur",
        "c345fb7a0964868518ce28c53977eb05f2cef214a1672cb2362d494f0ca9df57",
        "fdd4655829f953bcbb6f1ff1da8371022c072c46b23987f22dcafefebd347909",
    ),
)

HERO_SCENE: Final[tuple[SceneArt, ...]] = tuple(
    art
    for hero, prefix, sprite_sha256, thumbnail_sha256 in _HERO_PINS
    for art in (
        SceneArt(f"hero-{hero}-sprite", sprite_sha256, f"{prefix}-sprite.png"),
        SceneArt(f"hero-{hero}-thumbnail", thumbnail_sha256, f"{prefix}-thumbnail.png"),
    )
)

SCENE: Final[tuple[SceneArt, ...]] = (*_BASE_SCENE, *HERO_SCENE)


class SceneArtError(Exception):
    """A shipped scene file does not match its pinned hash or the scene rules; it is not served."""


def _wire(art: SceneArt, raw: bytes, width: int, height: int) -> dict[str, Any]:
    return {
        "contractVersion": CONTRACT_VERSION,
        "key": art.key,
        "mediaType": "image/png",
        "width": width,
        "height": height,
        "sha256": art.sha256,
        "byteLength": len(raw),
        "dataBase64": base64.b64encode(raw).decode("ascii"),
    }


def prepare_scene_art(
    art: SceneArt, scene_dir: Path = SCENE_DIR, reader: Callable[[Path], bytes] = Path.read_bytes
) -> dict[str, Any]:
    """Verify one file against its pinned hash, run it through the PNG validator with the scene
    limits, and return the `scene-asset.v1` body. The served bytes are the verified original (its
    hash is pinned), not the re-encoder's output."""
    raw = reader(scene_dir / f"{art.key}.png")
    if hashlib.sha256(raw).hexdigest() != art.sha256:
        raise SceneArtError(art.key)
    try:
        checked = reencode_png(raw, max_bytes=SCENE_MAX_BYTES, max_side=SCENE_MAX_SIDE)
    except ImageRejected as error:
        raise SceneArtError(art.key) from error
    return _wire(art, raw, checked.width, checked.height)


def load_scene_art(
    scene_dir: Path = SCENE_DIR, reader: Callable[[Path], bytes] = Path.read_bytes
) -> Mapping[str, dict[str, Any]]:
    """Every key that verifies. A key that fails is left out, so it answers 404 and the others
    are unaffected; a test proves none is skipped in a normal tree. Missing files are skipped the
    same way."""
    out: dict[str, dict[str, Any]] = {}
    for art in SCENE:
        try:
            out[art.key] = prepare_scene_art(art, scene_dir, reader)
        except (SceneArtError, OSError):
            continue
    return out


@functools.cache
def _served() -> Mapping[str, dict[str, Any]]:
    return load_scene_art()


def get_scene_asset(key: str) -> dict[str, Any] | None:
    """The verified `scene-asset.v1` body for a key, or None for an unknown key or a file that
    failed verification. Loaded once per process; no store and no service are involved."""
    return _served().get(key)
