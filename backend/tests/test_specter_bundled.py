"""The bundled portrait gallery: the A01 roster art (FP-07-AC01, AC03) and the A02, A03, bur and
poly additions (FP-10-AC01 art release, SC10-2)."""

import hashlib
import re
from pathlib import Path

import pytest

from backend.specter_arena.specters.bundled import ART_DIR, BUNDLED, BundledArtError, prepare
from backend.specter_arena.specters.service import hero_default_asset_id
from backend.specter_arena.store import open_store
from backend.specter_arena.store import specters as db

PINNED = {
    "vell": "268d5b2f0e068017002941afafe15d5c30375f2cf80ff144eec1c07b9c18dcf0",
    "stitch": "4aaf7e40efe11d627ffbfdf4eb3ca83b331026b99ab023088c803196c519d561",
    "reeve": "b6c7934853cf7c0a5e15653ce6fc7992d2b838b3724e95505b4d7a55c5c35cc7",
    "ember": "8c6f9437ff40e1b1ae2ab55b861e90c8c09e9f26875270bc606a980f0f267d3f",
    "rattle": "86751f4a614d65e76750cdeadfd5c867b964fedc7508a52bf48749b56ce8f927",
    "shard": "2576bd49227ead05907c2accd1b3713c44f96417b998fca67377a0d7fe0ad214",
    "lume": "f9c206f6b911e62d087dbf786995ec9b9e928c56e002d5f2f19a8d1b7ba85cff",
    "moss": "0c4524e864e9a12ecefc134e1181bfe47da5b926ab251c588fb73dec8af14abd",
    "tide": "59fcffd06949711f7df0f821f602548420abc7d3d7875a69076e51bbc91977ea",
    "bur": "f5c5c7bec8d2a890905c3b6a9531e1ceb84126cfb88efff78ccd512490b608a4",
    "poly": "5e932feb493e778ea81a97e8abcbbe4fac17b34c61bbcd21a01083a804d28c51",
}
# The three A01 ids existed before the gallery grew; they must never move.
A01_ASSET_IDS = {
    "vell": "ast_268d5b2f0e068017002941af",
    "stitch": "ast_4aaf7e40efe11d627ffbfdf4",
    "reeve": "ast_b6c7934853cf7c0a5e15653c",
}


def test_the_eleven_files_exist_and_match_their_pinned_hashes() -> None:
    assert {art.slug: art.sha256 for art in BUNDLED} == PINNED
    assert [art.slug for art in BUNDLED][:3] == ["vell", "stitch", "reeve"]  # A01 stays first
    for slug, digest in PINNED.items():
        assert hashlib.sha256((ART_DIR / f"{slug}.png").read_bytes()).hexdigest() == digest


def test_prepare_returns_eleven_square_portraits_with_hash_derived_data() -> None:
    items = prepare()
    assert [(i.art.slug, i.width, i.height) for i in items] == [(slug, 256, 256) for slug in PINNED]
    for item in items:
        assert item.sha256 == item.art.sha256
        assert hashlib.sha256(item.data).hexdigest() == item.sha256
        assert len(item.data) <= 1_048_576


def test_the_a01_asset_ids_did_not_move() -> None:
    ids = {i.art.slug: "ast_" + i.sha256[:24] for i in prepare()}
    for slug, asset_id in A01_ASSET_IDS.items():
        assert ids[slug] == asset_id


def test_labels_are_unique_safe_and_name_the_picture_only() -> None:
    labels = [art.label for art in BUNDLED]
    assert len(set(labels)) == len(labels) == 11
    assert all(re.fullmatch(r"[^\x00-\x1f\x7f<>]{1,80}", label) for label in labels)
    assert {art.pack for art in BUNDLED} == {"A01", "A02", "A03", "bur", "poly"}


def test_a_tampered_file_is_never_served() -> None:
    def tampered(path: Path) -> bytes:
        data = path.read_bytes()
        return data[:-20] + bytes([data[-20] ^ 1]) + data[-19:]

    with pytest.raises(BundledArtError):
        prepare(reader=tampered)


def test_hero_default_asset_id_equals_the_inserted_asset_id(tmp_path: Path) -> None:
    store = open_store(tmp_path / "data")
    try:
        for index, item in enumerate(prepare()):
            inserted = db.insert_asset(
                store,
                data=item.data,
                width=item.width,
                height=item.height,
                origin="bundled",
                label=item.art.label,
                now_ms=1_800_000_000_000 + index,
            )
            assert inserted.record.asset_id == hero_default_asset_id(item.art)
    finally:
        store.close()
