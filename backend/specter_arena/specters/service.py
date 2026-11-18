from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final, TypeVar

from ..store import Store
from ..store import errors as store_errors
from ..store import specters as db
from ..summoner import Summoner, SummonFailure
from .brief import BriefRejected, build_brief, clean_text
from .bundled import BundledArtError, prepare
from .png import MAX_INPUT_BYTES, ImageRejected, reencode_png
from .profile import (
    CONTRACT_VERSION,
    ProfileRejected,
    apply_keep,
    parse_keep,
    parse_model_reply,
    validate_profile,
)
from .prompt import SUMMON_PROMPT_VERSION, build_prompt

T = TypeVar("T")

REQUEST_ID: Final = re.compile(r"req_[0-9a-f]{24}")
ASSET_ID: Final = re.compile(r"ast_[0-9a-f]{24}")
BINDING_ID: Final = re.compile(r"bnd_[0-9a-f]{24}")
MAX_BASE64_CHARS: Final = (MAX_INPUT_BYTES + 2) // 3 * 4  # 1,398,104
MAX_LABEL_CHARS: Final = 80
DEFAULT_UPLOAD_LABEL: Final = "Uploaded portrait"
IMAGE_STATUS: Final = {"asset_too_large": 413, "unsupported_media": 415, "invalid_image": 422}
CANDIDATE_VISIBLE: Final = frozenset({"ready", "accepted"})


class _Unset:
    """Marks an omitted optional body member, so `epithet: null` (clear it) differs from absent."""

    def __repr__(self) -> str:
        return "UNSET"


UNSET: Final = _Unset()


class SpecterError(Exception):
    """A contract error: `code` is an `api-error.v1` code and `status` its HTTP status."""

    def __init__(self, code: str, status: int) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True, slots=True)
class Limits:
    binding_per_window: int = 5
    install_per_window: int = 20
    window_ms: int = 86_400_000
    timeout_s: float = 90.0
    malformed_retries: int = 1
    grace_s: float = 5.0  # backstop beyond the summoner's own timeout


# Store error to api-error code (work-ledger table, V6.1-1). Specific classes before the base.
_ERRORS: Final[tuple[tuple[type[Exception], str, int], ...]] = (
    (store_errors.VersionConflict, "version_conflict", 409),
    (store_errors.UnknownSpecter, "no_specter", 404),
    (store_errors.UnknownRequest, "unknown_request", 404),
    (store_errors.UnknownAsset, "unknown_asset", 404),
    (store_errors.UnknownBinding, "unknown_binding", 404),
    (store_errors.GenerationInFlight, "generation_in_flight", 409),
    (store_errors.BudgetExhausted, "budget_exhausted", 429),
    (store_errors.NotReady, "not_ready", 409),
    (store_errors.StoreUsageError, "invalid_body", 400),
    (store_errors.StoreError, "store_unavailable", 503),  # StoreUnavailable, StoreClosed, ...
)


def asset_wire(record: db.AssetRecord, *, with_data: bool) -> dict[str, Any]:
    return {
        "contractVersion": CONTRACT_VERSION,
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


def specter_wire(record: db.SpecterRecord) -> dict[str, Any]:
    return {
        "contractVersion": CONTRACT_VERSION,
        "specterId": record.specter_id,
        "bindingId": record.binding_id,
        "version": record.version,
        "profile": dict(record.profile),
        "portrait": None
        if record.portrait is None
        else asset_wire(record.portrait, with_data=False),
        "source": record.source,
        "promptVersion": record.prompt_version,
        "createdAtMs": record.created_ms,
        "updatedAtMs": record.updated_ms,
    }


def summoning_wire(record: db.RequestRecord, budget: db.Budget) -> dict[str, Any]:
    visible = record.candidate is not None and record.status in CANDIDATE_VISIBLE
    return {
        "contractVersion": CONTRACT_VERSION,
        "requestId": record.request_id,
        "bindingId": record.binding_id,
        "status": record.status,
        "candidate": dict(record.candidate) if visible and record.candidate is not None else None,
        "error": record.error_code if record.status == "failed" else None,
        "promptVersion": record.prompt_version,
        "keep": list(record.keep),
        "createdAtMs": record.created_ms,
        "finishedAtMs": record.finished_ms,
        "budget": {
            "bindingRemaining": budget.binding_remaining,
            "bindingLimit": budget.binding_limit,
            "installRemaining": budget.install_remaining,
            "installLimit": budget.install_limit,
            "windowMs": budget.window_ms,
        },
    }


class SpecterService:
    """The only thing the routes call. Cosmetic only: it never reads or writes observations,
    attempts, bot configuration or experience, and it sends the generator nothing but the brief.
    Every store call is a function of `store/specters.py` run through `asyncio.to_thread`."""

    def __init__(
        self,
        store: Store,
        summoner: Summoner,
        *,
        clock: Callable[[], int],
        limits: Limits | None = None,
    ) -> None:
        self._store = store
        self._summoner = summoner
        self._clock = clock
        self._limits = limits or Limits()
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._admit = asyncio.Lock()
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

    async def _budget(self, binding_id: str) -> db.Budget:
        lim = self._limits
        return await self._call(
            db.get_budget,
            binding_id,
            self._clock(),
            binding_limit=lim.binding_per_window,
            install_limit=lim.install_per_window,
            window_ms=lim.window_ms,
        )

    async def _summoning(self, record: db.RequestRecord) -> dict[str, Any]:
        return summoning_wire(record, await self._budget(record.binding_id))

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
        """Fail requests a previous process left running, then install the bundled portraits."""
        await self._call(db.sweep_interrupted, self._clock())
        try:
            prepared = await asyncio.to_thread(prepare)
        except (BundledArtError, ImageRejected, OSError):
            return  # never serve art that fails its pinned hash; a test proves none is skipped
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
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # ---- reads ----------------------------------------------------------------------------

    async def list_specters(self) -> dict[str, Any]:
        records = await self._call(db.list_specters)
        return {"contractVersion": CONTRACT_VERSION, "items": [specter_wire(r) for r in records]}

    async def get_specter(self, binding_id: str) -> dict[str, Any]:
        record = await self._call(db.get_specter, self._binding(binding_id))
        if record is None:
            raise SpecterError("no_specter", 404)
        return specter_wire(record)

    async def _request(self, request_id: object) -> db.RequestRecord:
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise SpecterError("unknown_request", 404)
        record = await self._call(db.get_request, request_id)
        if record is None:
            raise SpecterError("unknown_request", 404)
        return record

    async def get_summoning(self, request_id: str) -> dict[str, Any]:
        return await self._summoning(await self._request(request_id))

    # ---- summoning ------------------------------------------------------------------------

    async def start_summoning(self, binding_id: str, body: object) -> tuple[int, dict[str, Any]]:
        binding_id = self._binding(binding_id)
        if self._closed:
            raise SpecterError("generation_unavailable", 503)
        if not isinstance(body, dict) or not set(body) <= {"requestId", "purpose", "style", "keep"}:
            raise SpecterError("invalid_body", 400)
        request_id = body.get("requestId")
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise SpecterError("invalid_body", 400)
        try:
            keep = parse_keep(body.get("keep"))
        except ValueError as error:
            raise SpecterError("invalid_body", 400) from error
        async with self._admit:  # admission is serial; generation itself is not
            display_name = await self._call(db.bot_display_name, binding_id)
            try:
                brief = build_brief(display_name, body.get("purpose"), body.get("style"))
            except BriefRejected as error:
                raise SpecterError("invalid_body", 400) from error
            keep_values: dict[str, Any] = {}
            if keep:
                current = await self._call(db.get_specter, binding_id)
                if current is None:
                    raise SpecterError("invalid_body", 400)
                keep_values = {name: current.profile[name] for name in keep}
            created = await self._create(request_id, binding_id, keep)
            if created.created:
                prompt = build_prompt(brief, keep_values)
                task = asyncio.create_task(self._run(request_id, prompt, keep, keep_values))
                self._tasks[request_id] = task
                task.add_done_callback(self._forget(request_id))
            return (202 if created.created else 200), await self._summoning(created.record)

    def _forget(self, request_id: str) -> Callable[[asyncio.Task[None]], None]:
        def done(_task: asyncio.Task[None]) -> None:
            self._tasks.pop(request_id, None)

        return done

    async def _create(
        self, request_id: str, binding_id: str, keep: Sequence[str]
    ) -> db.CreatedRequest:
        lim = self._limits
        for attempt in (1, 2):
            try:
                return await self._call(
                    db.create_request,
                    request_id=request_id,
                    binding_id=binding_id,
                    keep=keep,
                    prompt_version=SUMMON_PROMPT_VERSION,
                    now_ms=self._clock(),
                    binding_limit=lim.binding_per_window,
                    install_limit=lim.install_per_window,
                    window_ms=lim.window_ms,
                )
            except SpecterError as error:
                # A row stranded as queued/running with no task in this process can never finish
                # (for example a failed terminal write). Fail it once and retry.
                if error.code != "generation_in_flight" or self._tasks or attempt == 2:
                    raise
                await self._call(db.sweep_interrupted, self._clock())
        raise AssertionError("unreachable")

    async def _run(
        self, request_id: str, prompt: str, keep: Sequence[str], keep_values: Mapping[str, Any]
    ) -> None:
        limits = self._limits
        loop = asyncio.get_running_loop()
        try:
            if not await self._call(db.mark_running, request_id, self._clock()):
                return  # cancelled before it started
            deadline = loop.time() + limits.timeout_s
            attempt = 0
            while True:
                attempt += 1
                remaining = deadline - loop.time()
                if remaining <= 0:
                    await self._fail(request_id, "timeout", attempt - 1)
                    return
                try:
                    reply = await asyncio.wait_for(
                        self._summoner.summon(prompt, request_id=request_id, timeout_s=remaining),
                        timeout=remaining + limits.grace_s,
                    )
                except TimeoutError:
                    await self._fail(request_id, "timeout", attempt)
                    return
                except SummonFailure as failure:
                    await self._fail(request_id, failure.code, attempt)
                    return
                try:
                    candidate = parse_model_reply(reply.text)
                except ProfileRejected as rejected:
                    if rejected.code == "malformed" and attempt <= limits.malformed_retries:
                        continue
                    await self._fail(request_id, rejected.code, attempt)
                    return
                # The preview shows the held fields. The store overwrites them again with the
                # CURRENT values at accept time, so a rename after this request is not lost.
                candidate = apply_keep(candidate, keep, keep_values)
                # Conditional write: a request cancelled or swept meanwhile drops its reply.
                await self._call(
                    db.complete_request,
                    request_id,
                    candidate=candidate,
                    model_label=reply.model_label,
                    attempts=attempt,
                    now_ms=self._clock(),
                )
                return
        except asyncio.CancelledError:
            raise  # the canceller already wrote the terminal state
        except Exception:
            await self._fail(request_id, "unavailable", 0)

    async def _fail(self, request_id: str, code: str, attempts: int) -> None:
        with contextlib.suppress(SpecterError):  # the next admission sweeps the row
            await self._call(
                db.fail_request,
                request_id,
                error_code=code,
                attempts=min(attempts, db.MAX_ATTEMPTS),
                now_ms=self._clock(),
            )

    async def cancel_summoning(self, request_id: str) -> dict[str, Any]:
        record = await self._request(request_id)
        after = await self._call(db.cancel_request, record.request_id, self._clock())
        if after.status == "cancelled":
            task = self._tasks.get(record.request_id)
            if task is not None:
                task.cancel()  # the row is already terminal, so a racing reply is dropped
        return await self._summoning(after)

    async def accept(self, request_id: str, expected_version: object) -> dict[str, Any]:
        expected = self._expected(expected_version)
        record = await self._request(request_id)
        saved = await self._call(
            db.accept_request,
            record.request_id,
            expected_version=expected,
            now_ms=self._clock(),
        )
        return specter_wire(saved)

    # ---- direct edits ---------------------------------------------------------------------

    async def save_manual(
        self, binding_id: str, expected_version: object, profile: object
    ) -> dict[str, Any]:
        binding_id = self._binding(binding_id)
        expected = self._expected(expected_version)
        try:
            clean = validate_profile(profile, with_version=True)
        except ProfileRejected as error:
            raise SpecterError("invalid_body", 400) from error
        saved = await self._call(
            db.save_manual,
            binding_id,
            expected_version=expected,
            profile=clean,
            now_ms=self._clock(),
        )
        return specter_wire(saved)

    async def rename(
        self,
        binding_id: str,
        expected_version: object,
        name: object,
        epithet: object = UNSET,
    ) -> dict[str, Any]:
        binding_id = self._binding(binding_id)
        expected = self._expected(expected_version)
        current = await self._call(db.get_specter, binding_id)
        if current is None:
            raise SpecterError("no_specter", 404)
        edited = dict(current.profile)
        edited["name"] = name
        if epithet is not UNSET:
            edited["epithet"] = epithet
        try:
            clean = validate_profile(edited, with_version=True)
        except ProfileRejected as error:
            raise SpecterError("invalid_body", 400) from error
        saved = await self._call(
            db.save_rename,
            binding_id,
            expected_version=expected,
            profile=clean,
            now_ms=self._clock(),
        )
        return specter_wire(saved)

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
        saved = await self._call(
            db.set_portrait,
            binding_id,
            expected_version=expected,
            asset_id=asset_id,
            now_ms=self._clock(),
        )
        return specter_wire(saved)

    async def archive(self, binding_id: str, expected_version: object) -> dict[str, Any]:
        binding_id = self._binding(binding_id)
        expected = self._expected(expected_version)
        await self._call(
            db.archive_specter, binding_id, expected_version=expected, now_ms=self._clock()
        )
        return {"contractVersion": CONTRACT_VERSION, "archived": True}

    # ---- assets ---------------------------------------------------------------------------

    async def list_portraits(self) -> dict[str, Any]:
        records = await self._call(db.list_assets)
        return {
            "contractVersion": CONTRACT_VERSION,
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
