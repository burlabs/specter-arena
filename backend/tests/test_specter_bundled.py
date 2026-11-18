"""The bundled A01 portraits (FP-07-AC01, AC03)."""

import hashlib
from pathlib import Path

import pytest

from backend.specter_arena.specters.bundled import ART_DIR, BUNDLED, BundledArtError, prepare

PINNED = {
    "vell": "268d5b2f0e068017002941afafe15d5c30375f2cf80ff144eec1c07b9c18dcf0",
    "stitch": "4aaf7e40efe11d627ffbfdf4eb3ca83b331026b99ab023088c803196c519d561",
    "reeve": "b6c7934853cf7c0a5e15653ce6fc7992d2b838b3724e95505b4d7a55c5c35cc7",
}


def test_the_three_files_exist_and_match_the_pinned_a01_hashes() -> None:
    assert {art.slug: art.a01_sha256 for art in BUNDLED} == PINNED
    for slug, digest in PINNED.items():
        assert hashlib.sha256((ART_DIR / f"{slug}.png").read_bytes()).hexdigest() == digest


def test_prepare_returns_three_square_portraits_with_hash_derived_data() -> None:
    items = prepare()
    assert [(i.art.slug, i.width, i.height) for i in items] == [
        ("vell", 256, 256),
        ("stitch", 256, 256),
        ("reeve", 256, 256),
    ]
    for item in items:
        assert item.sha256 == item.art.a01_sha256
        assert hashlib.sha256(item.data).hexdigest() == item.sha256


def test_a_tampered_file_is_never_served() -> None:
    def tampered(path: Path) -> bytes:
        data = path.read_bytes()
        return data[:-20] + bytes([data[-20] ^ 1]) + data[-19:]

    with pytest.raises(BundledArtError):
        prepare(reader=tampered)
