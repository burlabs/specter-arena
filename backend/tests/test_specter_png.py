import hashlib
import struct
import time
import zlib
from pathlib import Path

import pytest

from backend.specter_arena.specters.png import (
    MAX_INPUT_BYTES,
    SIGNATURE,
    ImageRejected,
    reencode_png,
)

from .png_support import SIG, chunk, ihdr, png, rows

ART = Path(__file__).resolve().parents[1] / "specter_arena" / "specters" / "art"


def reject(data: bytes) -> ImageRejected:
    with pytest.raises(ImageRejected) as raised:
        reencode_png(data)
    return raised.value


def test_a_small_rgba_png_is_reencoded_to_three_chunks() -> None:
    out = reencode_png(png(5, 4))
    assert (out.width, out.height) == (5, 4)
    kinds = []
    pos = len(SIGNATURE)
    while pos < len(out.data):
        (length,) = struct.unpack_from(">I", out.data, pos)
        kinds.append(out.data[pos + 4 : pos + 8])
        pos += 12 + length
    assert kinds == [b"IHDR", b"IDAT", b"IEND"]
    assert out.sha256 == hashlib.sha256(out.data).hexdigest()
    assert reencode_png(out.data).data == out.data  # stable


def test_rgb_is_accepted() -> None:
    assert reencode_png(png(3, 3, ctype=2)).width == 3


def test_ancillary_chunks_are_dropped() -> None:
    text = chunk(b"tEXt", b"Comment\x00<script>alert(1)</script>")
    out = reencode_png(png(extra=text + chunk(b"gAMA", b"\x00\x00\xb1\x8f")))
    assert b"tEXt" not in out.data and b"script" not in out.data and b"gAMA" not in out.data


@pytest.mark.parametrize(
    ("data", "code", "reason"),
    [
        (b"\x00" * (MAX_INPUT_BYTES + 1), "asset_too_large", "input-size"),
        (b"GIF89a" + b"\x00" * 30, "unsupported_media", "signature"),
        (b"", "unsupported_media", "signature"),
        (
            b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>",
            "unsupported_media",
            "signature",
        ),
        (png()[:-5], "invalid_image", "truncated"),
        (SIG + b"\x00\x00", "invalid_image", "truncated"),
        (
            png(header=chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 3, 8, 6, 0, 0, 0), crc=1)),
            "invalid_image",
            "bad-crc",
        ),
        (png(header=ihdr(4, 3, 8, 3)), "invalid_image", "colour-type"),  # palette
        (png(header=ihdr(4, 3, 8, 0)), "invalid_image", "colour-type"),  # grey
        (png(header=ihdr(4, 3, 16, 6)), "invalid_image", "colour-type"),  # 16-bit
        (png(header=ihdr(4, 3, 8, 6, interlace=1)), "invalid_image", "interlaced"),
        (png(header=ihdr(0, 3)), "invalid_image", "dimensions"),
        (png(header=ihdr(1025, 1)), "invalid_image", "dimensions"),
        (png(header=ihdr(1, 1025)), "invalid_image", "dimensions"),
        (png(extra=chunk(b"ABCD", b"x")), "invalid_image", "critical-chunk"),
        (png(tail=b"extra bytes"), "invalid_image", "trailing-data"),
        (png(raw=rows(4, 3, 4, filter_byte=5)), "invalid_image", "filter-byte"),
        (png(raw=rows(4, 2, 4)), "invalid_image", "size-mismatch"),  # too little pixel data
        (png(raw=rows(4, 4, 4)), "invalid_image", "bomb"),  # more than the header claims
        (
            png(extra=chunk(b"tRNS", b"\x00\x00\x00\x00\x00\x00"), ctype=2),
            "invalid_image",
            "colour-key",
        ),
    ],
)
def test_every_rejection_code(data: bytes, code: str, reason: str) -> None:
    rejected = reject(data)
    assert (rejected.code, rejected.reason) == (code, reason)


def test_ihdr_must_come_first_and_only_once() -> None:
    assert reject(SIG + chunk(b"IDAT", b"") + ihdr(4, 3)).reason == "ihdr-first"
    dup = (
        SIG
        + ihdr(4, 3)
        + ihdr(4, 3)
        + chunk(b"IDAT", zlib.compress(rows(4, 3, 4)))
        + chunk(b"IEND", b"")
    )
    assert reject(dup).reason == "duplicate-ihdr"


def test_idat_must_be_contiguous_and_present() -> None:
    z = zlib.compress(rows(4, 3, 4))
    split = (
        SIG
        + ihdr(4, 3)
        + chunk(b"IDAT", z[:5])
        + chunk(b"tEXt", b"a\x00b")
        + chunk(b"IDAT", z[5:])
        + chunk(b"IEND", b"")
    )
    assert reject(split).reason == "idat-split"
    assert reject(SIG + ihdr(4, 3) + chunk(b"IEND", b"")).reason == "no-idat"
    contiguous = (
        SIG + ihdr(4, 3) + chunk(b"IDAT", z[:5]) + chunk(b"IDAT", z[5:]) + chunk(b"IEND", b"")
    )
    assert reencode_png(contiguous).width == 4


def test_a_decompression_bomb_is_stopped_at_the_expected_size() -> None:
    bomb = png(1024, 1024, raw=b"\x00" * 50_000_000)
    assert len(bomb) < MAX_INPUT_BYTES
    started = time.perf_counter()
    assert reject(bomb).reason == "bomb"
    assert time.perf_counter() - started < 1.0


def test_corrupt_zlib_and_trailing_idat_bytes_are_invalid() -> None:
    corrupt = SIG + ihdr(4, 3) + chunk(b"IDAT", b"\x78\x9c" + b"\xff" * 20) + chunk(b"IEND", b"")
    assert reject(corrupt).reason in {"inflate", "size-mismatch"}
    z = zlib.compress(rows(4, 3, 4)) + b"junk"
    trailing = SIG + ihdr(4, 3) + chunk(b"IDAT", z) + chunk(b"IEND", b"")
    assert reject(trailing).reason == "idat-trailing"


def test_iend_with_a_body_and_bad_chunk_type_are_invalid() -> None:
    z = zlib.compress(rows(4, 3, 4))
    assert reject(SIG + ihdr(4, 3) + chunk(b"IDAT", z) + chunk(b"IEND", b"x")).reason == "iend-body"
    assert reject(SIG + ihdr(4, 3) + chunk(b"I1AT", z) + chunk(b"IEND", b"")).reason == "chunk-type"


def test_a_reencoded_image_that_would_exceed_the_cap_is_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    small = png(4, 3)  # built before the patch, which replaces the shared zlib.compress
    real = zlib.compress
    monkeypatch.setattr(
        zlib, "compress", lambda raw, level=6: real(raw, level) + b"\x00" * MAX_INPUT_BYTES
    )
    assert reject(small).reason == "reencoded-too-large"


@pytest.mark.parametrize("slug", ["vell", "stitch", "reeve"])
def test_the_bundled_a01_portraits_pass_the_upload_validator(slug: str) -> None:
    out = reencode_png((ART / f"{slug}.png").read_bytes())
    assert (out.width, out.height) == (256, 256)


def test_a_large_valid_image_is_reencoded_quickly() -> None:
    raw = b"".join(
        b"\x00" + bytes((x * y) & 255 for x in range(1024) for _ in range(4))[:4096]
        for y in range(1024)
    )
    big = png(1024, 1024, raw=raw)
    started = time.perf_counter()
    assert reencode_png(big).height == 1024
    assert time.perf_counter() - started < 5.0
