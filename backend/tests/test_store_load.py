import sqlite3
import time
from pathlib import Path

from backend.specter_arena.store import (
    BindingSeen,
    CoverageMark,
    DmKey,
    IngestBatch,
    IngestItem,
    ObservationIn,
    backup,
    ingest,
    latest_version,
    open_store,
    rebuild_projection,
    roster_page,
    row_fact_digest,
    start_run,
)

BOTS = 10
OBSERVATIONS = 20_000
BATCH = 100
T0 = 1_800_000_000_000
BUDGET_S = 10.0


def dm_of(n: int) -> str:
    return f"member-bot{n}-0123456789ab.memory-memory-bot{n}"


def test_twenty_thousand_observations_in_batches_of_a_hundred_stay_inside_the_budget_and_rebuild(
    tmp_path: Path,
) -> None:
    store = open_store(tmp_path / "data")
    try:
        started = start_run(store, run_id="run-00000001", now_ms=T0)
        setup: tuple[IngestItem, ...] = (
            *(
                BindingSeen(DmKey(f"bot{n}-0123456789ab", f"memory-bot{n}"), T0)
                for n in range(BOTS)
            ),
            CoverageMark("open-covered", T0),
        )

        ingest(store, IngestBatch("run-00000001", started.installation_id, setup))
        clock = time.monotonic()
        persisted = 0
        for first in range(0, OBSERVATIONS, BATCH):
            items: list[IngestItem] = []
            for i in range(first, first + BATCH):
                n = i % BOTS
                payload: dict[str, bool | int | str] = {
                    "running": i % 2 == 0,
                    "turn": i,
                    "turnGen": "ab12",
                    "lastActivityMs": i,
                }
                items.append(
                    ObservationIn(
                        installation_id=started.installation_id,
                        dm_key=dm_of(n),
                        slot_key=dm_of(n),
                        kind="row-change",
                        event_type="slot-row",
                        received_at_ms=T0 + i,
                        payload=payload,
                        turn=i,
                        turn_gen="ab12",
                        fact_digest=row_fact_digest(payload),
                    )
                )
            result = ingest(
                store, IngestBatch("run-00000001", started.installation_id, tuple(items))
            )
            persisted += result.counts["observation"].persisted
            assert result.rejections == ()
        elapsed = time.monotonic() - clock
        assert persisted == OBSERVATIONS
        assert elapsed < BUDGET_S
        with store.read() as conn:
            assert conn.execute("SELECT count(*) FROM observation").fetchone() == (OBSERVATIONS,)
        page = roster_page(store, cursor=None, limit=50, as_of_ms=T0 + OBSERVATIONS)
        assert len(page.items) == BOTS
        assert all(item.facts is not None and item.facts.turn is not None for item in page.items)
        report = rebuild_projection(store, as_of_ms=T0 + OBSERVATIONS)
        assert (report.observations_folded, report.bot_states) == (OBSERVATIONS, BOTS)
        assert time.monotonic() - clock < 2 * BUDGET_S
        copy = sqlite3.connect(backup(store, tmp_path / "saved"))
        try:
            assert copy.execute("SELECT count(*) FROM observation").fetchone() == (OBSERVATIONS,)
            assert copy.execute("SELECT count(*) FROM bot_state").fetchone() == (BOTS,)
            assert copy.execute("PRAGMA user_version").fetchone() == (latest_version(),)
        finally:
            copy.close()
    finally:
        store.close()
