from __future__ import annotations

import hashlib
import struct
import zlib
from dataclasses import dataclass

MAX_INPUT_BYTES = 1_048_576
MAX_DIMENSION = 1024
SIGNATURE = b"\x89PNG\r\n\x1a\n"
_CHANNELS = {2: 3, 6: 4}  # colour type -> bytes per pixel at 8 bits per channel


class ImageRejected(Exception):
    """`code` is a wire error code; `reason` is a stable token for tests and logs, never shown."""

    def __init__(self, code: str, reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason


@dataclass(frozen=True)
class ReencodedPng:
    data: bytes
    width: int
    height: int
    sha256: str


def _chunk(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))


def _invalid(reason: str) -> ImageRejected:
    return ImageRejected("invalid_image", reason)


def reencode_png(data: bytes) -> ReencodedPng:
    if len(data) > MAX_INPUT_BYTES:
        raise ImageRejected("asset_too_large", "input-size")
    if not data.startswith(SIGNATURE):
        raise ImageRejected("unsupported_media", "signature")
    pos = len(SIGNATURE)
    header: tuple[int, int, int] | None = None  # width, height, colour type
    idat: list[bytes] = []
    seen_idat_end = False
    ended = False
    while pos < len(data):
        if ended:
            raise _invalid("trailing-data")
        if pos + 8 > len(data):
            raise _invalid("truncated")
        (length,) = struct.unpack_from(">I", data, pos)
        kind = data[pos + 4 : pos + 8]
        end = pos + 8 + length
        if length > 0x7FFFFFFF or end + 4 > len(data):
            raise _invalid("truncated")
        if not all(65 <= b <= 90 or 97 <= b <= 122 for b in kind):
            raise _invalid("chunk-type")
        body = data[pos + 8 : end]
        (crc,) = struct.unpack_from(">I", data, end)
        if zlib.crc32(kind + body) != crc:
            raise _invalid("bad-crc")
        pos = end + 4
        if header is None:
            if kind != b"IHDR" or length != 13:
                raise _invalid("ihdr-first")
            width, height, depth, ctype, comp, filt, interlace = struct.unpack(">IIBBBBB", body)
            if not (1 <= width <= MAX_DIMENSION and 1 <= height <= MAX_DIMENSION):
                raise _invalid("dimensions")
            if depth != 8 or ctype not in _CHANNELS:
                raise _invalid("colour-type")
            if comp != 0 or filt != 0 or interlace != 0:
                raise _invalid("interlaced" if interlace else "ihdr-method")
            header = (width, height, ctype)
        elif kind == b"IHDR":
            raise _invalid("duplicate-ihdr")
        elif kind == b"IDAT":
            if seen_idat_end:
                raise _invalid("idat-split")
            idat.append(body)
        else:
            if idat:
                seen_idat_end = True
            if kind == b"IEND":
                if length != 0:
                    raise _invalid("iend-body")
                ended = True
            elif kind[0] & 0x20 == 0 and kind != b"PLTE":
                raise _invalid("critical-chunk")
            elif kind == b"tRNS" and header[2] == 2:
                raise _invalid("colour-key")
    if header is None or not ended:
        raise _invalid("truncated")
    if not idat:
        raise _invalid("no-idat")
    width, height, ctype = header
    stride = 1 + width * _CHANNELS[ctype]
    expected = stride * height
    inflater = zlib.decompressobj()
    try:
        raw = inflater.decompress(b"".join(idat), expected + 1)
    except zlib.error as error:
        raise _invalid("inflate") from error
    if len(raw) > expected:
        raise _invalid("bomb")
    if len(raw) < expected or not inflater.eof:
        raise _invalid("size-mismatch")
    if inflater.unused_data:
        raise _invalid("idat-trailing")
    if max(raw[::stride]) > 4:
        raise _invalid("filter-byte")
    ihdr = struct.pack(">IIBBBBB", width, height, 8, ctype, 0, 0, 0)
    out = (
        SIGNATURE
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(raw, 6))
        + _chunk(b"IEND", b"")
    )
    if len(out) > MAX_INPUT_BYTES:
        raise _invalid("reencoded-too-large")
    return ReencodedPng(out, width, height, hashlib.sha256(out).hexdigest())
