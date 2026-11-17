"""The synthetic collector fixtures carry the mark and invent no field the captures lack."""

import json
from pathlib import Path

from backend.specter_arena.collector.parse import ROW_FACTS
from backend.specter_arena.collector.vocabulary import IGNORED_TYPES
from backend.tests.collector_fixtures import (
    FIXTURE_DIR,
    FIXTURE_MARK,
    event_data_keys,
    event_types,
    rows,
)

RECORDED = Path(__file__).resolve().parents[2] / "tests" / "recorded" / "crew-0.12.2"
CAPTURE = json.loads((RECORDED / "s1-v1-event-capture.json").read_text(encoding="utf-8"))["_meta"]
ROW_KEYS = set(ROW_FACTS) | {"key", "created_by", "last_activity_ts"}


def test_every_fixture_file_carries_the_mark_and_lives_outside_recorded_and_cases() -> None:
    files = sorted(FIXTURE_DIR.glob("*.json"))
    assert {path.name for path in files} >= {"rows.json", "frames.json", "frame-types-0.12.2.json"}
    for path in files:
        if path.name != "frame-types-0.12.2.json":
            assert json.loads(path.read_text(encoding="utf-8"))["fixtureOnly"] == FIXTURE_MARK
    assert FIXTURE_DIR.is_relative_to(Path(__file__).resolve().parent / "fixtures")


def test_fixture_rows_use_only_the_fields_the_collector_reads() -> None:
    for name, body in rows().items():
        assert set(body) <= ROW_KEYS, name


def test_fixture_events_use_only_data_keys_the_capture_proves() -> None:
    proven = CAPTURE["keysSeen"]
    assert set(event_types()) == set(proven) - {"subagent_done"} | {"chat_status"}
    for event_type in event_types():
        assert event_data_keys(event_type) <= set(proven[event_type]), event_type


def test_the_twelve_other_types_add_up_to_the_capture_other_bucket() -> None:
    types = json.loads((FIXTURE_DIR / "frame-types-0.12.2.json").read_text(encoding="utf-8"))[
        "types"
    ]
    twelve = {name: count for name, count in types.items() if name not in CAPTURE["framesSeen"]}
    assert len(twelve) == 12 and "heartbeat" in twelve
    assert sum(twelve.values()) == CAPTURE["framesSeen"]["other"] == 370
    assert set(twelve) <= IGNORED_TYPES
    for name, count in types.items():
        if name in CAPTURE["framesSeen"]:
            assert count == CAPTURE["framesSeen"][name], name
