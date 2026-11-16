import pytest

from backend.specter_arena import store
from backend.specter_arena.collector import identity
from backend.specter_arena.collector.identity import (
    bot_dm_key,
    is_store_less_key,
    ref_key_ok,
    slot_key_ok,
)
from backend.specter_arena.collector.vocabulary import LIMITS
from backend.specter_arena.store.records import MAX_PAYLOAD_BYTES

OLD_GENERATION = (
    "member-specter-probe-bot-9d63166ee3a3.memory-member-specter-probe-bot-9d63166ee3a3-aa11"
)
NEW_GENERATION = (
    "member-specter-probe-bot-0a1b2c3d4e5f.memory-member-specter-probe-bot-0a1b2c3d4e5f-bb22"
)
SAME_MEMBER_NEW_STORE = (
    "member-specter-probe-bot-9d63166ee3a3.memory-member-specter-probe-bot-9d63166ee3a3-cc33"
)
STORE_LESS = "member-specter-probe-bot"

HOSTILE = [
    "member-bad\n",
    "member-" + "a" * 10_000,
    "member-ünï.memory-x",
    "member-a.memory-x\n",
    "member-a.memory-",
    "member-.memory-x",
    "member-A.memory-x",
    "chat-61-1794779966",
    "",
]


def test_the_collector_uses_the_stores_parser_not_its_own() -> None:
    assert identity.parse_dm_key is store.parse_dm_key


def test_payload_cap_matches_the_store() -> None:
    assert LIMITS.payload_max_bytes == MAX_PAYLOAD_BYTES


def test_two_generations_never_share_a_dm_key() -> None:
    old = bot_dm_key(OLD_GENERATION)
    new = bot_dm_key(NEW_GENERATION)
    assert old is not None and new is not None
    assert old != new
    assert old.member_id != new.member_id


def test_a_recreated_store_under_the_same_member_is_a_different_key() -> None:
    old = bot_dm_key(OLD_GENERATION)
    again = bot_dm_key(SAME_MEMBER_NEW_STORE)
    assert old is not None and again is not None
    assert old.member_id == again.member_id
    assert old != again


def test_a_bindable_key_carries_its_private_store() -> None:
    parsed = bot_dm_key(OLD_GENERATION)
    assert parsed is not None
    assert parsed.memory_store == "member-specter-probe-bot-9d63166ee3a3-aa11"


def test_a_store_less_key_is_detected_and_never_bindable() -> None:
    assert is_store_less_key(STORE_LESS)
    assert bot_dm_key(STORE_LESS) is None
    assert not is_store_less_key(OLD_GENERATION)


@pytest.mark.parametrize("key", HOSTILE)
def test_hostile_strings_are_neither_bindable_nor_store_less(key: str) -> None:
    assert bot_dm_key(key) is None
    assert is_store_less_key(key) is False


@pytest.mark.parametrize("value", [None, 5, b"member-x", ["member-x"], {"key": "member-x"}])
def test_non_strings_are_refused_everywhere(value: object) -> None:
    assert bot_dm_key(value) is None
    assert is_store_less_key(value) is False
    assert slot_key_ok(value) is False
    assert ref_key_ok(value) is False


def test_worker_keys() -> None:
    assert slot_key_ok("chat-61-1794779966")
    assert not slot_key_ok("chat 61")
    assert not slot_key_ok("chat-61\n")
    assert not slot_key_ok("a" * 129)
    assert not slot_key_ok("")


def test_reference_keys_fit_a_bot_dm_key() -> None:
    assert ref_key_ok(OLD_GENERATION)
    assert ref_key_ok("a" * 256)
    assert not ref_key_ok("a" * 257)
    assert not ref_key_ok("member x")
    assert not ref_key_ok("")
