"""FP-20 PR-B: `waiting`, `tokenReading` and `roster-item.v2` / `roster.v2`.

Every Crew frame below mirrors Crew 0.13.0 source (installed under
`/Applications/KiroCrew.app/.../site-packages/kiro_crew/`), cited as `kiro_crew/<path>:<line>`.
This is a source reading, not a live proof: the owner sitting was skipped by Eric on 2026-11-21.
"""

import itertools
import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Literal

import pytest

from backend.app import app
from backend.specter_arena import store as store_api
from backend.specter_arena.collector.parse import parse_event, parse_slots
from backend.specter_arena.condition import (
    APPROVAL_PENDING,
    CONDITION_RULES_VERSION,
    QUESTION_PENDING,
    WAITING,
    condition_rules_v1,
    condition_rules_v2,
)
from backend.specter_arena.roster_view import (
    roster_item_v2_wire,
    roster_item_wire,
    roster_v2_body,
    token_reading_wire,
)
from backend.specter_arena.store import (
    BindingSeen,
    BotFacts,
    CoverageMark,
    CoverageView,
    DmKey,
    IngestBatch,
    ObservationIn,
    Page,
    RosterPoll,
    RosterRow,
    RosterRowIn,
    Store,
    TokenReading,
    open_store,
    start_run,
)
from backend.tests.contract_support import compile_schema, load_registry
from backend.tests.test_routes_ping import SECRET, sign_headers
from backend.tests.test_routes_roster import NoLifespan, Runtime

REGISTRY = load_registry()
VALIDATE_ITEM_V2 = compile_schema("urn:specter-arena:contract:roster-item:v2", REGISTRY)
VALIDATE_ROSTER_V2 = compile_schema("urn:specter-arena:contract:roster:v2", REGISTRY)
VALIDATE_ROSTER_V1 = compile_schema("urn:specter-arena:contract:roster:v1", REGISTRY)

NOW_MS = 1_760_000_000_000
DM = "member-bot-a-9d63166ee3a3.memory-member-bot-a-9d63166ee3a3-aa11"
WORKER = "chat-61-1794779966"
SENTINEL = "SENTINEL-free-text-must-not-leave-the-parser"


def facts(running: bool | None = True, **overrides: object) -> BotFacts:
    values: dict[str, object] = {
        "running": running,
        "turn": 3,
        "turn_gen": "a8b8767e",
        "pending_approval": False,
        "needs_input": False,
        "has_options": False,
        "waiting_for_input": False,
        "interrupted": False,
        "last_activity_ms": NOW_MS,
        "row_observed_ms": NOW_MS + 500,
        "event_observed_ms": None,
    }
    values.update(overrides)
    return BotFacts(**values)  # type: ignore[arg-type]


def make_row(
    bot_facts: BotFacts | None = None,
    *,
    presence: str = "present",
    coverage: CoverageView | None = None,
) -> RosterRow:
    return RosterRow(
        binding_id="bnd_0a1b2c3d",
        binding_seq=1,
        display_name="Probe Bot",
        name="probe-bot",
        avatar_kind="image",
        avatar_ref="probe-bot.png",
        presence=presence,  # type: ignore[arg-type]
        presence_since_ms=1_000,
        facts=bot_facts if bot_facts is not None else facts(),
        coverage=coverage or CoverageView("covered", None, NOW_MS - 1_000, 0),
        last_observed_ms=NOW_MS + 500,
        workers_running=0,
        workers_seen=0,
        workers_unknown=0,
    )


# --- condition rules v2 ------------------------------------------------------------------------


def test_rules_version_is_two_and_v1_still_never_reads_a_flag() -> None:
    assert CONDITION_RULES_VERSION == 2
    flagged = make_row(facts(True, pending_approval=True, needs_input=True))
    assert condition_rules_v1(flagged, 1).state == "working"


@pytest.mark.parametrize(
    ("running", "approval", "question", "state", "reason"),
    [
        # kiro_crew/dashboard/slot_projection.py:381-382 pending_approval; :422 needs_input.
        (True, True, False, WAITING, APPROVAL_PENDING),
        (True, False, True, WAITING, QUESTION_PENDING),
        (True, True, True, WAITING, APPROVAL_PENDING),
        (False, False, True, WAITING, QUESTION_PENDING),
        # A pending approval needs a turn in flight; on a settled row it is a stale reading.
        (False, True, False, "settled", "not-running"),
        (False, True, True, WAITING, QUESTION_PENDING),
        (True, False, False, "working", "running"),
        (False, False, False, "settled", "not-running"),
        (True, None, None, "working", "running"),
    ],
)
def test_waiting_table_for_a_covered_present_bot(
    running: bool, approval: bool | None, question: bool | None, state: str, reason: str
) -> None:
    subject = make_row(facts(running, pending_approval=approval, needs_input=question))
    result = condition_rules_v2(subject, 1)
    assert (result.state, result.reason_code) == (state, reason)
    assert result.basis == "row"
    assert (result.source_time_ms, result.observed_at_ms) == (NOW_MS, NOW_MS + 500)


@pytest.mark.parametrize("flag", ["has_options", "waiting_for_input"])
def test_options_and_waiting_for_input_never_make_a_bot_wait(flag: str) -> None:
    # kiro_crew/dashboard/slot_projection.py:415-420: waiting_for_input is true for any bot whose
    # last row is an assistant reply, so it says nothing about a person owing an answer.
    for running in (True, False):
        subject = make_row(facts(running, **{flag: True}))
        assert condition_rules_v2(subject, 1).state != WAITING


@pytest.mark.parametrize("approval", [True, False])
@pytest.mark.parametrize("question", [True, False])
def test_presence_and_coverage_win_over_a_flag(approval: bool, question: bool) -> None:
    flags = {"pending_approval": approval, "needs_input": question}
    for presence in ("absent", "unknown"):
        subject = make_row(facts(True, **flags), presence=presence)
        result = condition_rules_v2(subject, 1)
        assert (result.state, result.reason_code) == ("unknown", f"presence-{presence}")
    states: tuple[Literal["gap", "unknown"], ...] = ("gap", "unknown")
    for state in states:
        gap = CoverageView(state, "disconnect", 900, 1)
        result = condition_rules_v2(make_row(facts(True, **flags), coverage=gap), 1)
        assert (result.state, result.reason_code) == ("unknown", "disconnect")
    never = condition_rules_v2(make_row(facts(None, **flags)), 1)
    assert (never.state, never.reason_code) == ("unknown", "never-observed")


def test_v2_truth_table_changes_only_covered_present_rows_with_a_flag() -> None:
    flags = (None, False, True)
    for presence, running, coverage_state, approval, question in itertools.product(
        ("present", "absent", "unknown"),
        (None, False, True),
        ("covered", "gap", "unknown"),
        flags,
        flags,
    ):
        reason = "r" if coverage_state != "covered" else None
        coverage = CoverageView(coverage_state, reason, 1, 0)  # type: ignore[arg-type]
        subject = make_row(
            facts(running, pending_approval=approval, needs_input=question),
            presence=presence,
            coverage=coverage,
        )
        before, after = condition_rules_v1(subject, 1), condition_rules_v2(subject, 1)
        assert after.state in {"working", "settled", "unknown", "waiting"}
        assert after.signals == before.signals
        if after != before:
            assert after.state == WAITING
            assert presence == "present" and coverage_state == "covered" and running is not None


def test_a_waiting_condition_keeps_the_signals_and_carries_no_number() -> None:
    result = condition_rules_v2(make_row(facts(True, pending_approval=True)), 1)
    assert dict(result.signals)["pendingApproval"] is True
    assert isinstance(result.reason_code, str) and isinstance(result.state, str)


# --- token reading ------------------------------------------------------------------------------


def reading(used: int = 71_806, window: int = 1_000_000, at: int = NOW_MS + 400) -> TokenReading:
    return TokenReading(used, window, at)


def test_a_reading_is_a_context_gauge_with_four_fields() -> None:
    wire = token_reading_wire(reading(), make_row())
    assert wire == {
        "kind": "context",
        "used": 71_806,
        "window": 1_000_000,
        "observedAt": NOW_MS + 400,
    }


@pytest.mark.parametrize(
    "subject",
    [
        make_row(coverage=CoverageView("gap", "disconnect", 900, 1)),
        make_row(coverage=CoverageView("unknown", "no-slot-yet", 900, 0)),
    ],
)
def test_a_reading_is_dropped_when_the_bot_is_not_covered(subject: RosterRow) -> None:
    assert token_reading_wire(reading(), subject) is None


def test_a_reading_older_than_the_current_coverage_is_dropped() -> None:
    covered_since = NOW_MS + 10_000
    subject = make_row(coverage=CoverageView("covered", None, covered_since, 0))
    assert token_reading_wire(reading(at=covered_since - 1), subject) is None
    assert token_reading_wire(reading(at=covered_since), subject) is not None


@pytest.mark.parametrize(("used", "window"), [(5, 4), (1, 0), (0, 0)])
def test_an_impossible_reading_is_dropped(used: int, window: int) -> None:
    assert token_reading_wire(reading(used, window), make_row()) is None


def test_no_reading_is_null_and_the_wire_never_sums_or_ranks() -> None:
    assert token_reading_wire(None, make_row()) is None
    body = roster_item_v2_wire(make_row(), NOW_MS, reading())
    text = json.dumps(body).lower()
    for word in ("total", "xp", "rank", "score", "hp", "spend", "cost"):
        assert f'"{word}' not in text


# --- wire ---------------------------------------------------------------------------------------


def test_item_v2_validates_and_v1_is_unchanged() -> None:
    subject = make_row(facts(True, pending_approval=True))
    v2 = roster_item_v2_wire(subject, NOW_MS, reading())
    VALIDATE_ITEM_V2(v2)
    assert v2["contractVersion"] == 2
    assert v2["condition"]["state"] == "waiting"  # type: ignore[index]
    v1 = roster_item_wire(subject, NOW_MS)
    assert v1["contractVersion"] == 1 and "tokenReading" not in v1
    assert v1["condition"]["state"] == "working"  # type: ignore[index]
    shared = ("tokenReading", "contractVersion", "condition")
    assert {k: v for k, v in v2.items() if k not in shared} == {
        k: v for k, v in v1.items() if k not in shared
    }


def test_roster_v2_body_validates_with_and_without_readings() -> None:
    rows = (make_row(facts(True, needs_input=True)),)
    page: Page[RosterRow] = Page(items=rows, next_cursor=None)
    with_reading = roster_v2_body(page, 4, None, NOW_MS, {"bnd_0a1b2c3d": reading()})
    VALIDATE_ROSTER_V2(with_reading)
    assert with_reading["contractVersion"] == 2
    assert with_reading["items"][0]["tokenReading"]["kind"] == "context"  # type: ignore[index]
    bare = roster_v2_body(page, 4, None, NOW_MS, {})
    VALIDATE_ROSTER_V2(bare)
    assert bare["items"][0]["tokenReading"] is None  # type: ignore[index]
    assert bare["items"][0]["condition"]["reasonCode"] == QUESTION_PENDING  # type: ignore[index]


# --- frames mirrored from Crew 0.13.0 -----------------------------------------------------------


def crew_dm_row(**overrides: object) -> dict[str, object]:
    """A bot DM row with the fields `slot_projection.py:565-660` puts on it, free text included."""
    row: dict[str, object] = {
        "key": DM,
        "mode": "member",
        "running": True,
        "turn": 7,
        "turn_gen": "a8b8767e",
        "last_activity_ts": "2026-11-21T12:00:00+00:00",
        "pending_approval": True,
        "pending_approval_info": {  # slot_projection.py:448-462
            "origin": "native",
            "tool": SENTINEL,
            "tool_input": SENTINEL,
            "tool_kind": "execute",
            "request_id": "req-1",
            "request_mid": "m-1",
            "tool_purpose": SENTINEL,
        },
        "needs_input": False,
        "has_options": False,
        "waiting_for_input": False,
        "last_message": SENTINEL,
        "prompt_preview": SENTINEL,
        "options": [SENTINEL],
        "title": SENTINEL,
    }
    row.update(overrides)
    return row


def test_a_pending_approval_row_keeps_the_flag_and_drops_every_free_text_field() -> None:
    parsed = parse_slots({"type": "slots", "data": [crew_dm_row()]}, frozenset())
    [bot] = parsed.bots
    assert bot.facts["pendingApproval"] is True
    kept = json.dumps(dict(bot.facts))
    assert SENTINEL not in kept and "request" not in kept and "tool" not in kept


def test_a_question_pending_row_keeps_needs_input() -> None:
    # slot_projection.py:422 needs_input = bool(slot._question_pending)
    row = crew_dm_row(pending_approval=False, needs_input=True, running=False)
    [bot] = parse_slots({"type": "slots", "data": [row]}, frozenset()).bots
    assert bot.facts["needsInput"] is True and bot.facts["pendingApproval"] is False


def test_context_usage_event_keeps_two_counts_and_drops_pct() -> None:
    # kiro_crew/dashboard/dashboard_persistence.py:548 broadcast_context_usage; frame keys as
    # recorded in tests/recorded/crew-0.12.2 (`pct`, `slot`, `used_tokens`, `window_tokens`).
    frame = {
        "type": "context_usage",
        "data": {"slot": DM, "pct": 7.2, "used_tokens": 71806, "window_tokens": 1000000},
    }
    parsed = parse_event("context_usage", frame)
    assert not isinstance(parsed, str)
    assert dict(parsed.payload) == {"usedTokens": 71806, "windowTokens": 1000000}


def test_a_worker_restored_with_an_unverified_creator_stays_unattributed() -> None:
    # kiro_crew/dashboard/slot_persistence/metadata_codec.py:575-607 restores `created_by` only when
    # the crew log names the same creator; otherwise slot._created_by becomes
    # "unverified:creator" (session_revive.py:282), and `_lineage_minted` stays False
    # (metadata_codec.py:575-607; slot_projection.py:666).
    worker = {
        "key": WORKER,
        "origin": "user",
        "created_by": "unverified:creator",
        "lineage_minted": False,
        "running": True,
    }
    verified = dict(worker, created_by=DM)
    parsed = parse_slots({"type": "slots", "data": [crew_dm_row(), worker]}, frozenset())
    assert parsed.workers == () and parsed.other_rows == 1
    alone = parse_slots({"type": "slots", "data": [worker]}, frozenset())
    assert alone.workers == () and alone.other_rows == 1
    attributed = parse_slots({"type": "slots", "data": [crew_dm_row(), verified]}, frozenset())
    assert [w.slot_key for w in attributed.workers] == [WORKER]


# --- store and route ----------------------------------------------------------------------------

KEY = DmKey("bot-a-9d63166ee3a3", "member-bot-a-9d63166ee3a3-aa11")


@pytest.fixture
def opened(tmp_path: Path) -> Iterator[Store]:
    instance = open_store(tmp_path / "data")
    try:
        yield instance
    finally:
        instance.close()


@pytest.fixture(autouse=True)
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KIROCREW_PROXY_SECRET", SECRET)


@pytest.fixture
def use_app() -> Iterator[None]:
    runtime, collector = app.state.store_runtime, app.state.collector
    yield
    app.state.store_runtime, app.state.collector = runtime, collector


def seed(
    opened: Store, row_payload: dict[str, Any], events: list[tuple[str, int, dict[str, Any]]]
) -> str:
    started = start_run(opened, run_id="run-00000001", now_ms=NOW_MS)
    seen = IngestBatch("run-00000001", started.installation_id, (BindingSeen(KEY, NOW_MS),))
    store_api.ingest(opened, seen)
    dm_key = store_api.build_dm_key(KEY)
    roster_row = RosterRowIn(KEY.memory_store, "bot-a", "Bot A", "image", "a.png")
    items: list[Any] = [
        CoverageMark("open-covered", NOW_MS),
        RosterPoll(True, NOW_MS, (roster_row,)),
        ObservationIn(
            installation_id=started.installation_id,
            dm_key=dm_key,
            slot_key=dm_key,
            kind="row-change",
            event_type="slot-row",
            received_at_ms=NOW_MS,
            payload=row_payload,
            turn=1,
            turn_gen="a8b8767e",
            fact_digest=store_api.row_fact_digest(row_payload),
        ),
    ]
    for slot, at, payload in events:
        items.append(
            ObservationIn(
                installation_id=started.installation_id,
                dm_key=dm_key,
                slot_key=dm_key if slot == "dm" else slot,
                kind="event",
                event_type="context_usage",
                received_at_ms=at,
                payload=payload,
            )
        )
    store_api.ingest(opened, IngestBatch("run-00000001", started.installation_id, tuple(items)))
    page = store_api.roster_page(opened, cursor=None, limit=10, as_of_ms=NOW_MS)
    return str(page.items[0].binding_id)


def use(opened: Store) -> None:
    app.state.store_runtime = Runtime(opened)
    app.state.collector = None


def test_token_readings_take_the_newest_dm_slot_event_and_ignore_workers(opened: Store) -> None:
    binding = seed(
        opened,
        {"running": True, "turn": 1, "turnGen": "a8b8767e"},
        [
            ("dm", NOW_MS + 100, {"usedTokens": 10, "windowTokens": 100}),
            (WORKER, NOW_MS + 150, {"usedTokens": 99, "windowTokens": 100}),
            ("dm", NOW_MS + 200, {"usedTokens": 20, "windowTokens": 100}),
        ],
    )
    found = store_api.token_readings(opened, [binding, "bnd_unknown", binding])
    assert found == {binding: TokenReading(20, 100, NOW_MS + 200)}
    assert store_api.token_readings(opened, []) == {}


def test_a_bot_with_no_context_event_has_no_reading(opened: Store) -> None:
    binding = seed(opened, {"running": True, "turn": 1, "turnGen": "a8b8767e"}, [])
    assert store_api.token_readings(opened, [binding]) == {}


def test_too_many_bindings_is_a_usage_error(opened: Store) -> None:
    with pytest.raises(store_api.StoreUsageError):
        store_api.token_readings(opened, [f"b{n}" for n in range(201)])


def fresh_beat(opened: Store) -> None:
    store_api.heartbeat(opened, run_id="run-00000001", now_ms=int(time.time() * 1000))


def fetch(target: str) -> tuple[int, Any]:
    response = NoLifespan().client.get(target, headers=sign_headers(target))
    return response.status_code, response.json()


def test_view_signals_serves_roster_v2_and_the_default_stays_v1(
    use_app: None, opened: Store
) -> None:
    seed(
        opened,
        {"running": True, "turn": 1, "turnGen": "a8b8767e", "pendingApproval": True},
        [("dm", NOW_MS + 100, {"usedTokens": 10, "windowTokens": 100})],
    )
    use(opened)
    fresh_beat(opened)
    status, v2 = fetch("/api/roster?view=signals")
    assert status == 200
    VALIDATE_ROSTER_V2(v2)
    [item] = v2["items"]
    assert item["condition"]["state"] == "waiting"
    assert item["condition"]["reasonCode"] == "approval-pending"
    reading_wire = {"kind": "context", "used": 10, "window": 100, "observedAt": NOW_MS + 100}
    assert item["tokenReading"] == reading_wire
    status, v1 = fetch("/api/roster")
    assert status == 200
    VALIDATE_ROSTER_V1(v1)
    assert v1["items"][0]["condition"]["state"] == "working"
    assert "tokenReading" not in v1["items"][0]


def test_a_stale_heartbeat_reads_unknown_with_no_reading_in_v2(
    use_app: None, opened: Store
) -> None:
    seed(
        opened,
        {"running": True, "turn": 1, "turnGen": "a8b8767e", "needsInput": True},
        [("dm", NOW_MS + 100, {"usedTokens": 10, "windowTokens": 100})],
    )
    use(opened)
    _, body = fetch("/api/roster?view=signals")
    [item] = body["items"]
    assert item["condition"]["state"] == "unknown"
    assert item["tokenReading"] is None


def test_an_unknown_view_is_400_and_the_body_holds_no_identifiers(
    use_app: None, opened: Store
) -> None:
    seed(opened, {"running": True, "turn": 1, "turnGen": "a8b8767e"}, [])
    use(opened)
    status, body = fetch("/api/roster?view=everything")
    assert (status, body["error"]) == (400, "invalid_view")
    _, ok = fetch("/api/roster?view=signals")
    text = json.dumps(ok)
    for needle in ("member-", ".memory-", KEY.member_id, KEY.memory_store, "/Users/"):
        assert needle not in text


@pytest.mark.parametrize(
    "stored", ["[1, 2]", '{"usedTokens": "7", "windowTokens": 9}', '{"usedTokens": 1}']
)
def test_a_stored_payload_that_is_not_two_counts_reads_as_no_reading(
    opened: Store, stored: str
) -> None:
    binding = seed(
        opened,
        {"running": True, "turn": 1, "turnGen": "a8b8767e"},
        [("dm", NOW_MS + 100, {"usedTokens": 10, "windowTokens": 100})],
    )
    with opened.write() as conn:
        conn.execute("DROP TRIGGER IF EXISTS observation_immutable")
        conn.execute(
            "UPDATE observation SET payload = ? WHERE event_type = 'context_usage'", (stored,)
        )
    assert store_api.token_readings(opened, [binding]) == {}
