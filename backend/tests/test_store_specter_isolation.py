"""Identity work writes no monitoring, binding or progress data (FP-06-AC03/06, FP-07-AC04)."""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.store import (
    BindingSeen,
    DmKey,
    IngestBatch,
    IngestItem,
    ObservationIn,
    RosterPoll,
    RosterRowIn,
    Store,
    attempts_page,
    get_binding,
    ingest,
    open_store,
    rebuild_projection,
    roster_page,
    roster_revision,
    row_fact_digest,
    start_run,
)
from backend.specter_arena.store import specters as sp
from backend.specter_arena.store.bindings import store_id

ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
T0 = 1_800_000_000_000
DAY = 86_400_000
LIMITS: dict[str, Any] = {"binding_limit": 5, "install_limit": 20, "window_ms": DAY}
OWN_TABLES = {"asset", "generation_request", "specter", "specter_revision"}
PNG = sp.PNG_SIGNATURE + b"\x00" * 24
PROFILE: dict[str, Any] = {
    "contractVersion": 1,
    "name": "Vesper",
    "epithet": None,
    "personality": "Dry.",
    "appearance": "Lantern-bearer.",
    "mannerism": "Taps twice.",
    "signatureAction": None,
    "assignmentRationale": "Chosen from the display name.",
    "artBrief": "Grey coat.",
}


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    opened = open_store(tmp_path / "data")
    try:
        yield opened
    finally:
        opened.close()


def seed_monitoring(opened: Store) -> str:
    """One bot with a display revision, presence, an observation, an attempt and a projection."""
    with opened.read() as conn:
        installation = store_id(conn)
    start_run(opened, run_id="run-00000001", now_ms=T0 - 1)
    key = "member-alpha-0123456789ab.memory-memory-alpha"
    payload: dict[str, bool | int | str] = {"running": True, "turn": 1, "turnGen": "abc123"}
    row = ObservationIn(
        installation_id=installation,
        dm_key=key,
        slot_key=key,
        kind="row-change",
        event_type="slot-row",
        received_at_ms=T0 + 2,
        payload=payload,
        turn=1,
        turn_gen="abc123",
        fact_digest=row_fact_digest(payload),
    )
    items: tuple[IngestItem, ...] = (
        BindingSeen(ALPHA, T0),
        RosterPoll(
            True, T0 + 1, (RosterRowIn("memory-alpha", "Alpha", "Alpha Bot", "ghost", None),)
        ),
        row,
    )
    result = ingest(opened, IngestBatch("run-00000001", installation, items))
    return result.bindings[0].binding_id


def snapshot(opened: Store) -> dict[str, list[tuple[Any, ...]]]:
    """Every row of every table outside the Specter tables, found from sqlite_master so a table
    a later migration adds is covered without editing this test."""
    with opened.read() as conn:
        tables = [
            name
            for (name,) in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
                " ORDER BY name"
            )
            if name not in OWN_TABLES
        ]
        return {
            t: sorted((tuple(r) for r in conn.execute(f"SELECT * FROM {t}")), key=repr)
            for t in tables
        }


def test_the_snapshot_sees_every_non_specter_table_and_notices_a_write(store: Store) -> None:
    binding = seed_monitoring(store)
    before = snapshot(store)
    assert {"observation", "attempt", "bot_state", "bot_binding", "coverage_interval"} <= set(
        before
    )
    assert before["observation"] and before["bot_binding"] and before["bot_display_revision"]
    assert OWN_TABLES.isdisjoint(before)
    with store.write() as conn:  # negative control: a monitoring write must change the snapshot
        conn.execute(
            "INSERT INTO bot_presence (binding_id, state, since_ms) VALUES (?, 'absent', ?)",
            (binding, T0 + 9),
        )
    assert snapshot(store) != before


def test_a_full_summoning_flow_writes_nothing_outside_the_specter_tables(store: Store) -> None:
    binding = seed_monitoring(store)
    rebuild_projection(store, as_of_ms=T0 + 5)
    before = snapshot(store)
    roster_before = roster_page(store, cursor=None, limit=50, as_of_ms=T0 + 10)
    attempts_before = attempts_page(store, binding, cursor=None, limit=50, as_of_ms=T0 + 10)
    revision_before = roster_revision(store)
    binding_before = get_binding(store, binding)

    sp.create_request(
        store,
        request_id="req_" + "1" * 24,
        binding_id=binding,
        keep=(),
        prompt_version="summon-1",
        now_ms=T0 + 100,
        **LIMITS,
    )
    sp.mark_running(store, "req_" + "1" * 24, T0 + 101)
    sp.complete_request(
        store, "req_" + "1" * 24, candidate=PROFILE, model_label="auto", attempts=1, now_ms=T0 + 102
    )
    sp.accept_request(store, "req_" + "1" * 24, expected_version=0, now_ms=T0 + 103)
    asset = sp.insert_asset(
        store, data=PNG, width=8, height=8, origin="uploaded", label="a", now_ms=T0 + 104
    ).record
    sp.set_portrait(store, binding, expected_version=1, asset_id=asset.asset_id, now_ms=T0 + 105)
    sp.save_rename(
        store, binding, expected_version=2, profile={**PROFILE, "name": "Wren"}, now_ms=T0 + 106
    )
    sp.create_request(
        store,
        request_id="req_" + "2" * 24,
        binding_id=binding,
        keep=("name",),
        prompt_version="summon-1",
        now_ms=T0 + 107,
        **LIMITS,
    )
    sp.fail_request(store, "req_" + "2" * 24, error_code="timeout", attempts=1, now_ms=T0 + 108)
    sp.sweep_interrupted(store, T0 + 109)
    sp.archive_specter(store, binding, expected_version=3, now_ms=T0 + 110)

    assert snapshot(store) == before
    assert roster_page(store, cursor=None, limit=50, as_of_ms=T0 + 10) == roster_before
    assert attempts_page(store, binding, cursor=None, limit=50, as_of_ms=T0 + 10) == attempts_before
    assert roster_revision(store) == revision_before
    assert get_binding(store, binding) == binding_before
    with store.read() as conn:
        assert conn.execute("SELECT count(*) FROM specter_revision").fetchone() == (4,)
        assert conn.execute("SELECT DISTINCT internal_tag FROM generation_request").fetchall() == [
            ("summoning",)
        ]


def test_rebuilding_the_projection_leaves_identity_data_alone(store: Store) -> None:
    binding = seed_monitoring(store)
    sp.save_manual(store, binding, expected_version=0, profile=PROFILE, now_ms=T0 + 50)
    sp.insert_asset(
        store, data=PNG, width=8, height=8, origin="uploaded", label="a", now_ms=T0 + 51
    )

    def identity() -> dict[str, list[tuple[Any, ...]]]:
        with store.read() as conn:
            return {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t}")] for t in OWN_TABLES}

    before = identity()
    rebuild_projection(store, as_of_ms=T0 + 60)
    assert identity() == before


def test_the_store_has_no_observation_for_a_generation_slot_name(store: Store) -> None:
    """The store keeps only `generation_request` rows for summoning; there is no slot key,
    session id or transcript column for a generation (FP-06-AC06 at the data level)."""
    with store.read() as conn:
        columns = {c[1] for c in conn.execute("PRAGMA table_info(generation_request)")}
    assert not {"slot_key", "session_id", "prompt", "reply", "transcript", "raw"} & columns
    assert {"internal_tag", "prompt_version", "model_label"} <= columns
