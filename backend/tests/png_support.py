"""Builders for PNG test inputs, including malformed ones. Test-time only."""

from __future__ import annotations

import struct
import zlib

SIG = b"\x89PNG\r\n\x1a\n"


def chunk(kind: bytes, body: bytes, crc: int | None = None) -> bytes:
    check = zlib.crc32(kind + body) if crc is None else crc
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", check)


def ihdr(width: int, height: int, depth: int = 8, ctype: int = 6, interlace: int = 0) -> bytes:
    return chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, depth, ctype, 0, 0, interlace))


def rows(width: int, height: int, bpp: int, fill: int = 7, filter_byte: int = 0) -> bytes:
    return (bytes([filter_byte]) + bytes([fill]) * (width * bpp)) * height


def png(
    width: int = 4,
    height: int = 3,
    ctype: int = 6,
    raw: bytes | None = None,
    extra: bytes = b"",
    header: bytes | None = None,
    tail: bytes = b"",
) -> bytes:
    bpp = {2: 3, 6: 4}.get(ctype, 4)
    data = rows(width, height, bpp) if raw is None else raw
    head = ihdr(width, height, 8, ctype) if header is None else header
    return SIG + head + extra + chunk(b"IDAT", zlib.compress(data)) + chunk(b"IEND", b"") + tail
