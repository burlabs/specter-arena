from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import Any, Final, TypeVar

from ..store import Store
from ..store import errors as store_errors
from ..store import specters as db
from .bundled import BUNDLED, BundledArt, BundledArtError, prepare
from .heroes import Hero, display_name, hero_by_id
from .png import MAX_INPUT_BYTES, ImageRejected, reencode_png
from .text import clean_text

T = TypeVar("T")

_LOG = logging.getLogger("specter_arena.specters.service")
ASSET_CONTRACT_VERSION: Final = 1  # portrait-asset.v1 (FROZEN)
SPECTER_CONTRACT_VERSION: Final = 2  # specter.v2 and specters.v2
HEROES_CONTRACT_VERSION: Final = 1  # heroes.v1

ASSET_ID: Final = re.compile(r"ast_[0-9a-f]{24}")
BINDING_ID: Final = re.compile(r"bnd_[0-9a-f]{24}")
MAX_BASE64_CHARS: Final = (MAX_INPUT_BYTES + 2) // 3 * 4  # 1,398,104
MAX_LABEL_CHARS: Final = 80
DEFAULT_UPLOAD_LABEL: Final = "Uploaded portrait"
IMAGE_STATUS: Final = {"asset_too_large": 413, "unsupported_media": 415, "invalid_image": 422}


class SpecterError(Exception):
    """A contract error: `code` is an `api-error.v1` code and `status` its HTTP status."""

    def __init__(self, code: str, status: int) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


# Store error to api-error code (work-ledger table, V6.1-1). Specific classes before the base.
_ERRORS: Final[tuple[tuple[type[Exception], str, int], ...]] = (
    (store_errors.VersionConflict, "version_conflict", 409),
    (store_errors.UnknownAsset, "unknown_asset", 404),
    (store_errors.UnknownBinding, "unknown_binding", 404),
    (store_errors.StoreUsageError, "invalid_body", 400),
    (store_errors.StoreError, "store_unavailable", 503),  # StoreUnavailable, StoreClosed, ...
)


def asset_wire(record: db.AssetRecord, *, with_data: bool) -> dict[str, Any]:
    return {
        "contractVersion": ASSET_CONTRACT_VERSION,
        "assetId": record.asset_id,
        "mediaType": "image/png",
        "width": record.width,
        "height": record.height,
        "byteLength": record.byte_length,
        "origin": record.origin,
        "label": record.label,
        "dataBase64": base64.b64encode(record.data).decode("ascii")
        if with_data and record.data is not None
        else None,
    }


def hero_default_asset_id(art: BundledArt) -> str:
    """The stored bytes are the verified original, so the pinned hash is the stored hash."""
    return "ast_" + art.sha256[:24]


_BUNDLED_BY_SLUG: Final = {art.slug: art for art in BUNDLED}


def specter_wire(record: db.HeroRecord, hero: Hero, portrait: db.AssetRecord) -> dict[str, Any]:
    return {
        "contractVersion": SPECTER_CONTRACT_VERSION,
        "bindingId": record.binding_id,
        "version": record.version,
        "heroId": hero.id,
        "ordinal": record.ordinal,
        "displayName": display_name(hero, record.ordinal),
        "name": hero.name,
        "epithet": hero.epithet,
        "personality": hero.personality,
        "appearance": hero.appearance,
        "portrait": asset_wire(portrait, with_data=False),
        "avatarChosen": record.asset_id is not None,
        "source": "roster",
        "createdAtMs": record.assigned_ms,
        "updatedAtMs": record.updated_ms,
    }


def heroes_wire(heroes: Iterable[Hero], counts: Mapping[str, int]) -> dict[str, Any]:
    """`heroes.v1`: every roster hero in roster order with how many bindings hold it."""
    return {
        "contractVersion": HEROES_CONTRACT_VERSION,
        "items": [
            {
                "heroId": hero.id,
                "name": hero.name,
                "epithet": hero.epithet,
                "personality": hero.personality,
                "assigned": counts.get(hero.id, 0) > 0,
                "assignedCount": counts.get(hero.id, 0),
            }
            for hero in heroes
        ],
    }


class SpecterService:
    """The only thing the routes call. Cosmetic only: it never reads or writes observations,
    attempts, bot configuration or experience. Every store call is a function of
    `store/specters.py` run through `asyncio.to_thread`."""

    def __init__(self, store: Store, *, clock: Callable[[], int]) -> None:
        self._store = store
        self._clock = clock
        self._heroes = hero_by_id()  # raises HeroRosterError: boot catches it and starts no service
        self._image_gate = asyncio.Semaphore(1)
        self._closed = False

    # ---- plumbing -------------------------------------------------------------------------

    async def _call(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        try:
            return await asyncio.to_thread(fn, self._store, *args, **kwargs)
        except Exception as error:
            for kind, code, status in _ERRORS:
                if isinstance(error, kind):
                    raise SpecterError(code, status) from error
            raise

    @staticmethod
    def _binding(binding_id: object) -> str:
        if not isinstance(binding_id, str) or not BINDING_ID.fullmatch(binding_id):
            raise SpecterError("unknown_binding", 404)  # one outcome for malformed and unknown
        return binding_id

    @staticmethod
    def _expected(value: object) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 2**53 - 1:
            raise SpecterError("invalid_body", 400)
        return value

    # ---- lifecycle ------------------------------------------------------------------------

    async def start(self) -> None:
        """Install the bundled portraits."""
        try:
            prepared = await asyncio.to_thread(prepare)
        except (BundledArtError, ImageRejected, OSError) as error:
            # Never serve art that fails its pinned hash; a test proves none is skipped. Log the
            # exception type once so a missing or tampered portrait is not silent.
            _LOG.warning("bundled portraits not installed: %s", type(error).__name__)
            return
        base_ms = self._clock()
        for index, item in enumerate(prepared):
            await self._call(
                db.insert_asset,
                data=item.data,
                width=item.width,
                height=item.height,
                origin="bundled",
                label=item.art.label,
                now_ms=base_ms + index,  # the gallery lists bundled art in BUNDLED order
            )

    async def close(self) -> None:
        self._closed = True

    # ---- reads ----------------------------------------------------------------------------

    async def list_specters(self) -> dict[str, Any]:
        records = await self._call(db.list_heroes)
        portraits = await self._call(self._portraits, records)
        return {
            "contractVersion": SPECTER_CONTRACT_VERSION,
            "items": [self._wire(r, portraits) for r in records],
        }

    async def list_heroes(self) -> dict[str, Any]:
        counts = await self._call(self._hero_counts)
        return heroes_wire(self._heroes.values(), counts)

    def _hero_counts(self, store: Store) -> dict[str, int]:
        """The stored counts, refused when they name a hero the roster file does not hold."""
        counts = db.count_hero_assignments(store)
        if not counts.keys() <= self._heroes.keys():
            raise store_errors.StoreUnavailable("hero assignment names an unknown hero")
        return counts

    async def get_specter(self, binding_id: str) -> dict[str, Any]:
        record = await self._call(db.get_hero, self._binding(binding_id))
        portraits = await self._call(self._portraits, [record])
        return self._wire(record, portraits)

    def _default_asset_id(self, record: db.HeroRecord) -> str:
        return hero_default_asset_id(_BUNDLED_BY_SLUG[self._heroes[record.hero_id].portrait_slug])

    def _portraits(
        self, store: Store, records: Sequence[db.HeroRecord]
    ) -> dict[str, db.AssetRecord]:
        """Metadata for every asset the records show, one read each (the gallery list is capped)."""
        found: dict[str, db.AssetRecord] = {}
        for record in records:
            asset_id = record.asset_id or self._default_asset_id(record)
            if asset_id not in found:
                asset = db.get_asset(store, asset_id, with_data=False)
                if asset is None:
                    raise store_errors.StoreUnavailable("portrait asset missing")
                found[asset_id] = asset
        return found

    def _wire(
        self, record: db.HeroRecord, portraits: Mapping[str, db.AssetRecord]
    ) -> dict[str, Any]:
        hero = self._heroes[record.hero_id]
        asset_id = record.asset_id or self._default_asset_id(record)
        return specter_wire(record, hero, portraits[asset_id])

    # ---- avatar ---------------------------------------------------------------------------

    async def set_portrait(
        self, binding_id: str, expected_version: object, asset_id: object
    ) -> dict[str, Any]:
        binding_id = self._binding(binding_id)
        expected = self._expected(expected_version)
        if asset_id is not None:
            if not isinstance(asset_id, str):
                raise SpecterError("invalid_body", 400)
            if not ASSET_ID.fullmatch(asset_id):
                raise SpecterError("unknown_asset", 404)
        saved = await self._call(db.set_avatar, binding_id, expected, asset_id, self._clock())
        portraits = await self._call(self._portraits, [saved])
        return self._wire(saved, portraits)

    # ---- assets ---------------------------------------------------------------------------

    async def list_portraits(self) -> dict[str, Any]:
        records = await self._call(db.list_assets)
        return {
            "contractVersion": ASSET_CONTRACT_VERSION,
            "items": [asset_wire(r, with_data=False) for r in records],
        }

    async def upload_asset(self, body: object) -> dict[str, Any]:
        if not isinstance(body, dict) or not set(body) <= {"mediaType", "dataBase64", "label"}:
            raise SpecterError("invalid_body", 400)
        if body.get("mediaType") != "image/png":
            raise SpecterError("unsupported_media", 415)
        encoded = body.get("dataBase64")
        if not isinstance(encoded, str):
            raise SpecterError("invalid_body", 400)
        if len(encoded) > MAX_BASE64_CHARS:
            raise SpecterError("asset_too_large", 413)
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise SpecterError("invalid_body", 400) from error
        label = self._label(body.get("label"))
        async with self._image_gate:  # one re-encode at a time; it is CPU work in a thread
            try:
                result = await asyncio.to_thread(reencode_png, raw)
            except ImageRejected as rejected:
                raise SpecterError(rejected.code, IMAGE_STATUS[rejected.code]) from rejected
        inserted = await self._call(
            db.insert_asset,
            data=result.data,
            width=result.width,
            height=result.height,
            origin="uploaded",
            label=label,
            now_ms=self._clock(),
        )
        return asset_wire(inserted.record, with_data=False)

    @staticmethod
    def _label(value: object) -> str:
        if value is None:
            return DEFAULT_UPLOAD_LABEL
        if not isinstance(value, str) or len(value) > 4 * MAX_LABEL_CHARS:
            raise SpecterError("invalid_body", 400)
        text = clean_text(value)
        if text == "" or len(text) > MAX_LABEL_CHARS or "<" in text or ">" in text:
            raise SpecterError("invalid_body", 400)
        return text

    async def get_asset(self, asset_id: str) -> dict[str, Any]:
        if not isinstance(asset_id, str) or not ASSET_ID.fullmatch(asset_id):
            raise SpecterError("unknown_asset", 404)
        record = await self._call(db.get_asset, asset_id)
        if record is None:
            raise SpecterError("unknown_asset", 404)
        return asset_wire(record, with_data=True)
