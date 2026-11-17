"""Frame cap, unknown types, authentication stop and redaction through the real store
(FP-03-AC04, FP-03-AC06, FP-02-AC03).

Unit-level cap, 403 and credential-source behaviour is covered in test_collector_parse.py,
test_collector_auth.py and test_collector_no_fallback.py; these tests add the end-to-end half
against a store under tmp_path. The ignore-list tie is test_collector_vocabulary.py.
"""

import json
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena import wire
from backend.specter_arena.collector.gateway import AuthRejected, PolicyClose, Transient
from backend.specter_arena.collector.supervisor import State
from backend.specter_arena.collector.vocabulary import LIMITS
from backend.specter_arena.store import Store, open_store, recent_quarantine
from backend.tests.collector_fixtures import row, rows, slots_frame
from backend.tests.collector_scenarios import SENTINEL, chat_done, slots, until
from backend.tests.test_collector_store_contract import real, run, table

END = Transient("scripted-end")
CAP = LIMITS.raw_frame_max_chars
DM_A = rows()["botA"]["key"]
SEED_PROMPT = "SEED-PROMPT-TEXT-1"
SEED_SECRET = "SEED-SECRET-LOOKING-VALUE"


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def padded_chat_done(length: int) -> str:
    """A chat_done frame whose raw JSON text is exactly `length` characters."""
    shell = json.dumps({"type": "chat_done", "data": {"slot": DM_A, "turn": 2, "pad": ""}})
    return shell.replace('"pad": ""', '"pad": "' + "p" * (length - len(shell)) + '"')


def drive(harness: Any) -> None:
    async def scenario() -> None:
        assert await harness.collector.begin()
        await harness.collector.feed_once()
        await harness.collector.flush()
        await harness.collector.stop()

    run(scenario())


def test_a_frame_at_the_cap_is_kept_and_one_character_over_is_quarantined(store: Store) -> None:
    at_cap, over_cap = padded_chat_done(CAP), padded_chat_done(CAP + 1)
    assert len(at_cap) == CAP and len(over_cap) == CAP + 1
    harness = real(store, feeds=[[slots_frame("full"), at_cap, over_cap, END]])
    drive(harness)
    assert table(store, "SELECT COUNT(*) FROM observation WHERE event_type = 'chat_done'") == [(1,)]
    [record] = table(store, "SELECT reason, frame_type, size_bytes, digest, count FROM quarantine")
    assert record == ("oversize-frame", "chat_done", CAP + 1, None, 1)
    assert "ppp" not in repr(table(store, "SELECT * FROM quarantine"))
    assert harness.collector.diagnostics()["balanced"] is True


def test_an_unknown_frame_type_is_quarantined_and_collection_carries_on(store: Store) -> None:
    unknown = json.dumps({"type": "brand_new_type", "data": {"slot": DM_A}})
    harness = real(store, feeds=[[slots_frame("full"), unknown, chat_done(2, DM_A), END]])
    drive(harness)
    assert table(store, "SELECT reason, frame_type, count FROM quarantine") == [
        ("unknown-event-type", "brand_new_type", 1)
    ]
    assert table(store, "SELECT COUNT(*) FROM observation WHERE event_type = 'chat_done'") == [(1,)]
    assert harness.collector.diagnostics()["counts"]["ignored"] == 0


def test_two_403s_stop_collection_in_the_store_after_one_fresh_exchange(store: Store) -> None:
    harness = real(store, feeds=[AuthRejected(403), AuthRejected(403), [slots_frame("full")]])

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: harness.collector.status().state is State.STOPPED)
        await harness.collector.wait_closed()

    run(scenario())
    assert harness.collector.status().reason_code == "auth-stopped"
    assert harness.gateway.exchange_count == 2
    assert len(harness.gateway.calls_of("feed")) == 2
    assert table(store, "SELECT end_reason FROM collector_run") == [("auth-stopped",)]
    assert table(store, "SELECT COUNT(*) FROM observation") == [(0,)]
    assert {call.credential for call in harness.gateway.calls} <= {None, "token-1", "token-2"}


def test_close_1008_stops_in_the_store_with_app_disabled_and_no_further_dial(store: Store) -> None:
    harness = real(store, feeds=[[slots_frame("full"), PolicyClose()], [slots_frame("full")]])

    async def scenario() -> None:
        await harness.collector.start()
        await until(lambda: harness.collector.status().state is State.STOPPED)
        await harness.collector.wait_closed()

    run(scenario())
    assert harness.collector.status().reason_code == "app-disabled"
    assert len(harness.gateway.calls_of("feed")) == 1
    assert table(store, "SELECT end_reason FROM collector_run") == [("app-disabled",)]


def test_diagnostics_logs_and_stored_quarantine_hold_no_seeded_text(
    store: Store, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    bait = {"title": SEED_PROMPT, "last_message": SEED_SECRET, "prompt_preview": SEED_PROMPT}
    frames = [
        slots(row("botA", **bait), row("botB", **bait)),
        json.dumps({"type": "chat_done", "data": {"slot": DM_A, "text": SEED_SECRET, "turn": 2}}),
        json.dumps({"type": "tool_call", "data": {"slot": DM_A, "arguments": SEED_PROMPT}}),
        json.dumps({"type": "unseen_kind", "data": {"slot": DM_A, "text": SEED_PROMPT}}),
        '{"type":"chat_done","data":{"slot":"x","pad":"' + SEED_SECRET * (CAP // 25 + 1) + '"}}',
        "{" + SEED_PROMPT,
    ]
    harness = real(store, feeds=[[*frames, END]])
    drive(harness)
    stored = repr(
        [
            table(store, f"SELECT * FROM {name}")
            for name in ("observation", "quarantine", "coverage_interval", "collector_run")
        ]
    )
    everything = " ".join(
        [
            stored,
            json.dumps(harness.collector.diagnostics()),
            caplog.text,
            repr(harness.collector.status()),
        ]
    )
    for seed in (SEED_PROMPT, SEED_SECRET, SENTINEL):
        assert seed not in everything
    counters = set(harness.collector.diagnostics()["counts"])
    assert counters == {
        "received",
        "ignored",
        "coalesced",
        "persisted",
        "deduplicated",
        "quarantined",
        "rejected",
        "dropped_with_gap_record",
    }
    records = recent_quarantine(store, limit=50)
    assert records and all(record.count >= 1 for record in records)
    for record in records:
        body = wire.quarantine_record_to_wire(record)
        assert wire.READERS["quarantine-record"](body) == body
        assert body["count"] == record.count and body["firstReceivedAtMs"] is not None
