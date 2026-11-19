"""FP-06-AC06, crew side: a generation slot is never a bot, observation or attempt."""

from backend.specter_arena.collector.identity import bot_dm_key
from backend.specter_arena.collector.parse import parse_slots

# Slots left in Crew history by RC-1 builds that summoned; the collector must keep ignoring them.
SLOT_PREFIX = "specter-summon-"
REQUEST_ID = "req_" + "0" * 24
SLOT_KEY = SLOT_PREFIX + REQUEST_ID


def test_a_summoning_slot_key_is_not_a_bindable_bot_key() -> None:
    assert bot_dm_key(SLOT_KEY) is None


def test_a_frame_whose_only_row_is_a_summoning_slot_yields_no_bot_or_worker() -> None:
    row = {"key": SLOT_KEY, "app": "specter-arena", "mode": "member", "title": "Specter summoning"}
    result = parse_slots({"type": "slots", "data": [row]}, frozenset())
    assert result.bots == () and result.workers == ()
