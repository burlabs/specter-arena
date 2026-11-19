"""Hero and avatar work writes no monitoring, binding or progress data (FP-06-AC03/06, FP-07-AC04,
FP-16)."""

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
    get_hero,
    ingest,
    open_store,
    rebuild_projection,
    roster_page,
    roster_revision,
    row_fact_digest,
    set_avatar,
    start_run,
)
from backend.specter_arena.store import specters as sp
from backend.specter_arena.store.bindings import store_id

ALPHA = DmKey("alpha-0123456789ab", "memory-alpha")
T0 = 1_800_000_000_000
OWN_TABLES = {"asset", "hero_assignment", "avatar_revision"}
PNG = sp.PNG_SIGNATURE + b"\x00" * 24


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
    """Every row of every table outside the identity tables, found from sqlite_master so a table
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


def test_the_snapshot_sees_every_non_identity_table_and_notices_a_write(store: Store) -> None:
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


def test_a_full_avatar_flow_writes_nothing_outside_the_identity_tables(store: Store) -> None:
    binding = seed_monitoring(store)
    rebuild_projection(store, as_of_ms=T0 + 5)
    before = snapshot(store)
    roster_before = roster_page(store, cursor=None, limit=50, as_of_ms=T0 + 10)
    attempts_before = attempts_page(store, binding, cursor=None, limit=50, as_of_ms=T0 + 10)
    revision_before = roster_revision(store)
    binding_before = get_binding(store, binding)
    hero_before = get_hero(store, binding)

    first = sp.insert_asset(
        store, data=PNG, width=8, height=8, origin="uploaded", label="a", now_ms=T0 + 104
    ).record
    second = sp.insert_asset(
        store, data=PNG + b"2", width=8, height=8, origin="uploaded", label="b", now_ms=T0 + 105
    ).record
    set_avatar(store, binding, expected_version=0, asset_id=first.asset_id, now_ms=T0 + 106)
    set_avatar(store, binding, expected_version=1, asset_id=second.asset_id, now_ms=T0 + 107)
    set_avatar(store, binding, expected_version=2, asset_id=None, now_ms=T0 + 108)

    assert snapshot(store) == before
    assert roster_page(store, cursor=None, limit=50, as_of_ms=T0 + 10) == roster_before
    assert attempts_page(store, binding, cursor=None, limit=50, as_of_ms=T0 + 10) == attempts_before
    assert roster_revision(store) == revision_before
    assert get_binding(store, binding) == binding_before
    after = get_hero(store, binding)
    assert (after.hero_id, after.ordinal, after.assignment_no, after.assigned_ms) == (
        hero_before.hero_id,
        hero_before.ordinal,
        hero_before.assignment_no,
        hero_before.assigned_ms,
    )
    assert (after.version, after.asset_id) == (3, None)
    with store.read() as conn:
        assert conn.execute("SELECT count(*) FROM avatar_revision").fetchone() == (3,)


def test_rebuilding_the_projection_leaves_identity_data_alone(store: Store) -> None:
    binding = seed_monitoring(store)
    asset = sp.insert_asset(
        store, data=PNG, width=8, height=8, origin="uploaded", label="a", now_ms=T0 + 51
    ).record
    set_avatar(store, binding, expected_version=0, asset_id=asset.asset_id, now_ms=T0 + 52)

    def identity() -> dict[str, list[tuple[Any, ...]]]:
        with store.read() as conn:
            return {t: [tuple(r) for r in conn.execute(f"SELECT * FROM {t}")] for t in OWN_TABLES}

    before = identity()
    rebuild_projection(store, as_of_ms=T0 + 60)
    assert identity() == before


def test_no_identity_table_has_a_slot_session_prompt_or_transcript_column(store: Store) -> None:
    """The identity tables hold no slot key, session id, prompt or reply (FP-06-AC06 at the data
    level, kept after summoning is gone)."""
    with store.read() as conn:
        for table in sorted(OWN_TABLES):
            columns = {c[1] for c in conn.execute(f"PRAGMA table_info({table})")}
            assert not {"slot_key", "session_id", "prompt", "reply", "transcript", "raw"} & columns
