from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Protocol

FAILURE_CODES: Final = frozenset({"timeout", "refused", "unavailable", "cancelled", "malformed"})
MAX_REPLY_BYTES: Final = 16 * 1024
MAX_MODEL_LABEL: Final = 64


@dataclass(frozen=True, slots=True)
class SummonReply:
    text: str
    model_label: str


class SummonFailure(Exception):
    """The generation did not produce a reply. `code` is one of FAILURE_CODES; never Crew text."""

    def __init__(self, code: str) -> None:
        if code not in FAILURE_CODES:
            raise ValueError("unknown summon failure code")
        super().__init__(code)
        self.code = code


class Summoner(Protocol):
    async def summon(self, prompt: str, *, request_id: str, timeout_s: float) -> SummonReply: ...

    async def discard(self, request_id: str) -> None: ...


class UnavailableSummoner:
    """Used when the gateway environment or the /api/chat grant is absent."""

    async def summon(self, prompt: str, *, request_id: str, timeout_s: float) -> SummonReply:
        raise SummonFailure("unavailable")

    async def discard(self, request_id: str) -> None:
        return None
