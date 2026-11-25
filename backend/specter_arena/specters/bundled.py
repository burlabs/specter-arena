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
    pack: str  # provenance only ("A01", "A02", "A03", "bur", "poly"), never a category
    sha256: str  # of the shipped file; for A01 it is the pack's portrait.png hash
    source: str  # where the file came from, provenance only


# Bundled portrait gallery (A01 roster art, then the A02, A03, bur and poly exports). A gallery,
# never a class: the generated name and text remain the identity. Asset ids derive from the file
# bytes, so the three A01 ids do not change when the pin field is renamed or art is added.
BUNDLED: Final[tuple[BundledArt, ...]] = (
    BundledArt(
        "vell",
        "Vell (A01 roster art)",
        "A01",
        "268d5b2f0e068017002941afafe15d5c30375f2cf80ff144eec1c07b9c18dcf0",
        "characters/vell/portrait.png",
    ),
    BundledArt(
        "stitch",
        "Stitch (A01 roster art)",
        "A01",
        "4aaf7e40efe11d627ffbfdf4eb3ca83b331026b99ab023088c803196c519d561",
        "characters/stitch/portrait.png",
    ),
    BundledArt(
        "reeve",
        "Reeve (A01 roster art)",
        "A01",
        "b6c7934853cf7c0a5e15653ce6fc7992d2b838b3724e95505b4d7a55c5c35cc7",
        "characters/reeve/portrait.png",
    ),
    BundledArt(
        "ember",
        "Ember (A02 art)",
        "A02",
        "8c6f9437ff40e1b1ae2ab55b861e90c8c09e9f26875270bc606a980f0f267d3f",
        "a02-ember-portrait.png",
    ),
    BundledArt(
        "rattle",
        "Rattle (A02 art)",
        "A02",
        "86751f4a614d65e76750cdeadfd5c867b964fedc7508a52bf48749b56ce8f927",
        "a02-rattle-portrait.png",
    ),
    BundledArt(
        "shard",
        "Shard (A02 art)",
        "A02",
        "2576bd49227ead05907c2accd1b3713c44f96417b998fca67377a0d7fe0ad214",
        "a02-shard-portrait.png",
    ),
    BundledArt(
        "lume",
        "Lume (A03 art)",
        "A03",
        "f9c206f6b911e62d087dbf786995ec9b9e928c56e002d5f2f19a8d1b7ba85cff",
        "a03-lume-portrait.png",
    ),
    BundledArt(
        "moss",
        "Moss (A03 art)",
        "A03",
        "0c4524e864e9a12ecefc134e1181bfe47da5b926ab251c588fb73dec8af14abd",
        "a03-moss-portrait.png",
    ),
    BundledArt(
        "tide",
        "Tide (A03 art)",
        "A03",
        "59fcffd06949711f7df0f821f602548420abc7d3d7875a69076e51bbc91977ea",
        "a03-tide-portrait.png",
    ),
    BundledArt(
        "bur",
        "Bur (art)",
        "bur",
        "f5c5c7bec8d2a890905c3b6a9531e1ceb84126cfb88efff78ccd512490b608a4",
        "bur-portrait.png",
    ),
    BundledArt(
        "poly",
        "Poly (art)",
        "poly",
        "5e932feb493e778ea81a97e8abcbbe4fac17b34c61bbcd21a01083a804d28c51",
        "poly-portrait.png",
    ),
)


class BundledArtError(Exception):
    """A shipped file does not match its pinned hash; it is never served."""


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
        if hashlib.sha256(raw).hexdigest() != art.sha256:
            raise BundledArtError(art.slug)
        checked = reencode_png(raw)  # raises ImageRejected if the file is not an acceptable PNG
        out.append(PreparedArt(art, raw, checked.width, checked.height, art.sha256))
    return out
