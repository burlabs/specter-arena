from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Mapping, Sequence
from typing import Any, Final

CONTRACT_VERSION: Final = 1
FIELDS: Final[tuple[str, ...]] = (
    "name",
    "epithet",
    "personality",
    "appearance",
    "mannerism",
    "signatureAction",
    "assignmentRationale",
    "artBrief",
)
NULLABLE: Final = frozenset({"epithet", "signatureAction"})
# Fields where a newline is allowed; the others are one line.
MULTILINE: Final = frozenset(
    {"personality", "appearance", "mannerism", "assignmentRationale", "artBrief"}
)
MAX_CHARS: Final[Mapping[str, int]] = {
    "name": 40,
    "epithet": 60,
    "personality": 400,
    "appearance": 400,
    "mannerism": 200,
    "signatureAction": 200,
    "assignmentRationale": 300,
    "artBrief": 400,
}
NO_MARKUP: Final = frozenset({"name", "epithet"})
MAX_REPLY_CHARS: Final = 16 * 1024
_DROPPED_CATEGORIES: Final = frozenset({"Cc", "Cf", "Cs", "Co", "Cn", "Zl", "Zp"})
_FENCE: Final = re.compile(r"\A```(?:json)?[ \t]*\n(.*)\n```\Z", re.DOTALL)


class ProfileRejected(Exception):
    """`code` is `malformed` (retryable) or `refused`; `reason` is a stable token for tests."""

    def __init__(self, code: str, reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason


def _malformed(reason: str) -> ProfileRejected:
    return ProfileRejected("malformed", reason)


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise ValueError("duplicate key")
        out[key] = value
    return out


def _no_constant(token: str) -> Any:
    raise ValueError(token)


def extract_object(text: str) -> dict[str, Any]:
    """Exactly one JSON object, bare or inside one code fence. Prose around it is `malformed`;
    a reply with no object at all is the model declining, `refused`."""
    if len(text) > MAX_REPLY_CHARS:
        raise _malformed("reply-too-long")
    body = text.strip()
    if body == "":
        raise _malformed("empty")
    fenced = _FENCE.match(body)
    if fenced is not None:
        body = fenced.group(1).strip()
    if "{" not in body:
        raise ProfileRejected("refused", "no-object")
    if not body.startswith("{"):
        raise _malformed("leading-text")
    decoder = json.JSONDecoder(object_pairs_hook=_no_duplicate_keys, parse_constant=_no_constant)
    try:
        value, end = decoder.raw_decode(body)
    except (ValueError, RecursionError) as error:
        raise _malformed("not-json") from error
    if body[end:].strip() != "":
        raise _malformed("trailing-text")
    if not isinstance(value, dict):
        raise _malformed("not-object")
    return value


def _normalise(field: str, value: object) -> str | None:
    if value is None:
        if field in NULLABLE:
            return None
        raise _malformed(f"{field}-null")
    if not isinstance(value, str):
        raise _malformed(f"{field}-type")
    text = unicodedata.normalize("NFC", value).strip()
    for char in text:
        if char == "\n" and field in MULTILINE:
            continue
        if unicodedata.category(char) in _DROPPED_CATEGORIES:
            raise _malformed(f"{field}-control")
        if field in NO_MARKUP and char in "<>":
            raise _malformed(f"{field}-markup")
    if text == "":
        if field in NULLABLE:
            return None
        raise _malformed(f"{field}-empty")
    if len(text) > MAX_CHARS[field]:
        raise _malformed(f"{field}-long")
    return text


def validate_profile(raw: object, *, with_version: bool) -> dict[str, Any]:
    """The normalised `specter-profile.v1` object. `with_version` is True for a client-supplied or
    stored profile (it must carry `contractVersion` 1) and False for a model reply (it must not)."""
    if not isinstance(raw, dict):
        raise _malformed("not-object")
    expected = set(FIELDS) | ({"contractVersion"} if with_version else set())
    if set(raw) != expected:
        raise _malformed("keys")
    if with_version and (
        raw["contractVersion"] != CONTRACT_VERSION or isinstance(raw["contractVersion"], bool)
    ):
        raise _malformed("contract-version")
    profile: dict[str, Any] = {"contractVersion": CONTRACT_VERSION}
    for field in FIELDS:
        profile[field] = _normalise(field, raw[field])
    return profile


def parse_model_reply(text: str) -> dict[str, Any]:
    """Model reply text to a validated profile, or `ProfileRejected`."""
    value = extract_object(text)
    refusal = value.get("refusal")
    if set(value) == {"refusal"} and isinstance(refusal, str):
        raise ProfileRejected("refused", "refusal-object")
    return validate_profile(value, with_version=False)


def parse_keep(value: object) -> tuple[str, ...]:
    """The `keep` list of a reroll: known field names, no duplicates, never all eight."""
    if value is None:
        return ()
    if not isinstance(value, list) or len(value) > len(FIELDS):
        raise ValueError("keep must be a list of field names")
    seen: list[str] = []
    for item in value:
        if not isinstance(item, str) or item not in FIELDS or item in seen:
            raise ValueError("keep names an unknown or repeated field")
        seen.append(item)
    if len(seen) == len(FIELDS):
        raise ValueError("keep cannot hold every field")
    return tuple(seen)


def apply_keep(
    candidate: Mapping[str, Any], keep: Sequence[str], values: Mapping[str, Any]
) -> dict[str, Any]:
    """The candidate with each kept field overwritten by `values`, so the model cannot change it."""
    out = dict(candidate)
    for field in keep:
        out[field] = values[field]
    return out
