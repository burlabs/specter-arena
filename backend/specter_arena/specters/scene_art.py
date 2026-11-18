from __future__ import annotations

import base64
import functools
import hashlib
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

from .png import ImageRejected, reencode_png
from .profile import CONTRACT_VERSION

SCENE_DIR: Final = Path(__file__).with_name("scene")
SCENE_MAX_BYTES: Final = 4_194_304  # 4 MiB; the portrait limit is 1 MiB
SCENE_MAX_SIDE: Final = 4096  # the portrait limit is 1024
SCENE_KEY: Final = re.compile(r"[a-z][a-z0-9-]{0,63}")


@dataclass(frozen=True, slots=True)
class SceneArt:
    key: str
    sha256: str  # of the shipped file, pinned in code
    source: str  # file name in the Figma Make export, provenance only


# Rasters the arena draws from the backend instead of inlining them into ui/dist. They are not
# portraits and never appear in the gallery. The file for a key is `scene/<key>.png`.
SCENE: Final[tuple[SceneArt, ...]] = (
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
