from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from .png import reencode_png

ART_DIR: Final = Path(__file__).with_name("art")


@dataclass(frozen=True, slots=True)
class BundledArt:
    slug: str
    label: str
    a01_sha256: str  # sha256 of the A01 pack's portrait.png, from data/a01.assets.json
    source: str  # path inside the A01 pack, provenance only


# Approved roster art ("A01 approved-roster derivations"). A gallery, never a class: the generated
# name and text remain the identity.
BUNDLED: Final[tuple[BundledArt, ...]] = (
    BundledArt(
        "vell",
        "Vell (A01 roster art)",
        "268d5b2f0e068017002941afafe15d5c30375f2cf80ff144eec1c07b9c18dcf0",
        "characters/vell/portrait.png",
    ),
    BundledArt(
        "stitch",
        "Stitch (A01 roster art)",
        "4aaf7e40efe11d627ffbfdf4eb3ca83b331026b99ab023088c803196c519d561",
        "characters/stitch/portrait.png",
    ),
    BundledArt(
        "reeve",
        "Reeve (A01 roster art)",
        "b6c7934853cf7c0a5e15653ce6fc7992d2b838b3724e95505b4d7a55c5c35cc7",
        "characters/reeve/portrait.png",
    ),
)


class BundledArtError(Exception):
    """A shipped file does not match its recorded A01 hash; it is never served."""


@dataclass(frozen=True, slots=True)
class PreparedArt:
    art: BundledArt
    data: bytes
    width: int
    height: int
    sha256: str  # of `data`; the asset id derives from this


def prepare(
    art_dir: Path = ART_DIR, reader: Callable[[Path], bytes] = Path.read_bytes
) -> list[PreparedArt]:
    """Verify each bundled file against its pinned A01 hash, then run it through the upload
    validator so it is held to the same rules. The stored bytes are the verified original, not the
    re-encoder's output: the hash pins them, and the asset id then stays the same on every
    Python/zlib build (a re-encode is not byte-stable across zlib builds)."""
    out: list[PreparedArt] = []
    for art in BUNDLED:
        raw = reader(art_dir / f"{art.slug}.png")
        if hashlib.sha256(raw).hexdigest() != art.a01_sha256:
            raise BundledArtError(art.slug)
        checked = reencode_png(raw)  # raises ImageRejected if the file is not an acceptable PNG
        out.append(PreparedArt(art, raw, checked.width, checked.height, art.a01_sha256))
    return out
