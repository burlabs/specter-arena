import json
from dataclasses import dataclass, replace

import pytest

from backend.specter_arena.roster_view import (
    MAX_NOTES,
    STANDING_NOTE,
    roster_body,
    roster_item_wire,
)
from backend.specter_arena.store import BotFacts, CoverageView, Page, RosterRow
from backend.specter_arena.wire import READERS
from backend.tests.contract_support import compile_schema, load_registry

REGISTRY = load_registry()
VALIDATE_ROSTER = compile_schema("urn:specter-arena:contract:roster:v1", REGISTRY)
VALIDATE_ITEM = compile_schema("urn:specter-arena:contract:roster-item:v1", REGISTRY)

MEMBER_ID = "bot-a-9d63166ee3a3"
STORE = "member-bot-a-9d63166ee3a3-aa11"
DM_KEY = f"member-{MEMBER_ID}.memory-{STORE}"
SLOT_KEY = "chat-61-1794779966"
FORBIDDEN_TEXT = ("member-", ".memory-", "chat-61", MEMBER_ID, STORE, "/Users/")


@dataclass(frozen=True)
class FakeStatus:
    state: str = "running"
    reason_code: str | None = None
    since_ms: int = 1_759_999_000_000
    notes: tuple[tuple[str, int | None], ...] = ()


class FakeCollector:
    def __init__(self, status: FakeStatus) -> None:
        self._status = status

    def status(self) -> FakeStatus:
        return self._status


def facts(running: bool | None = True) -> BotFacts:
    return BotFacts(
        running=running,
        turn=3,
        turn_gen="a8b8767e",
        pending_approval=False,
        needs_input=True,
        has_options=False,
        waiting_for_input=False,
        interrupted=False,
        last_activity_ms=1_760_000_000_000,
        row_observed_ms=1_760_000_000_500,
        event_observed_ms=None,
    )


def make_row(**overrides: object) -> RosterRow:
    base = RosterRow(
        binding_id="bnd_0a1b2c3d",
        binding_seq=1,
        display_name="Probe Bot",
        name="probe-bot",
        avatar_kind="image",
        avatar_ref="probe-bot.png",
        presence="present",
        presence_since_ms=1_000,
        facts=facts(),
        coverage=CoverageView("covered", None, 1_759_999_000_000, 0),
        last_observed_ms=1_760_000_000_500,
        workers_running=1,
        workers_seen=3,
        workers_unknown=1,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def page(*rows: RosterRow, cursor: str | None = None) -> Page[RosterRow]:
    return Page(items=tuple(rows), next_cursor=cursor)


def body_for(*rows: RosterRow, collector: FakeCollector | None = None) -> dict[str, object]:
    return roster_body(page(*rows), 7, collector, 1_760_000_001_000)


def test_item_maps_every_field_and_validates() -> None:
    item = roster_item_wire(make_row(), 1)
    VALIDATE_ITEM(item)
    assert item == {
        "contractVersion": 1,
        "bindingId": "bnd_0a1b2c3d",
        "displayName": "Probe Bot",
        "avatar": {"kind": "image", "ref": "probe-bot.png"},
        "presence": "present",
        "condition": {
            "state": "working",
            "reasonCode": "running",
            "basis": "row",
            "sourceTimeMs": 1_760_000_000_000,
            "observedAtMs": 1_760_000_000_500,
            "signals": {
                "needsInput": True,
                "hasOptions": False,
                "pendingApproval": False,
                "waitingForInput": False,
            },
        },
        "coverage": {
            "state": "covered",
            "sinceMs": 1_759_999_000_000,
            "reasonCode": None,
            "openGapCount": 0,
        },
        "lastObservedAtMs": 1_760_000_000_500,
        "workers": {"running": 1, "seen": 3, "unknown": 1},
    }


def test_display_name_falls_back_to_name_then_null_and_is_cut_to_128() -> None:
    assert roster_item_wire(make_row(display_name=None), 1)["displayName"] == "probe-bot"
    assert roster_item_wire(make_row(display_name=None, name=None), 1)["displayName"] is None
    assert roster_item_wire(make_row(display_name="", name=""), 1)["displayName"] is None
    long = roster_item_wire(make_row(display_name="x" * 300), 1)
    assert long["displayName"] == "x" * 128
    VALIDATE_ITEM(long)


@pytest.mark.parametrize(
    ("kind", "ref", "expected"),
    [
        ("image", "a.png", {"kind": "image", "ref": "a.png"}),
        ("ghost", None, {"kind": "ghost", "ref": None}),
        ("pack", "has space", {"kind": "pack", "ref": None}),
        ("pack", "x" * 129, {"kind": "pack", "ref": None}),
        (None, "a.png", None),
        ("Bad Kind", "a.png", None),
        ("k" * 40, "a.png", None),
    ],
)
def test_avatar_mapping(kind: str | None, ref: str | None, expected: object) -> None:
    item = roster_item_wire(make_row(avatar_kind=kind, avatar_ref=ref), 1)
    assert item["avatar"] == expected
    VALIDATE_ITEM(item)


@pytest.mark.parametrize("presence", ["present", "absent", "unknown"])
def test_all_three_presence_values_pass_through(presence: str) -> None:
    item = roster_item_wire(make_row(presence=presence), 1)
    assert item["presence"] == presence
    VALIDATE_ITEM(item)


def test_a_gap_makes_the_condition_unknown_and_keeps_the_coverage_reason() -> None:
    gap = CoverageView("gap", "disconnect", 900, 2)
    item = roster_item_wire(make_row(coverage=gap), 1)
    assert item["condition"]["state"] == "unknown"  # type: ignore[index]
    assert item["coverage"] == {
        "state": "gap",
        "sinceMs": 900,
        "reasonCode": "disconnect",
        "openGapCount": 2,
    }
    VALIDATE_ITEM(item)


def test_a_malformed_coverage_reason_never_reaches_the_wire() -> None:
    gap = CoverageView("gap", "Bad Reason!", 900, 1)
    item = roster_item_wire(make_row(coverage=gap), 1)
    assert item["coverage"]["reasonCode"] is None  # type: ignore[index]
    assert item["condition"]["reasonCode"] == "no-coverage"  # type: ignore[index]
    VALIDATE_ITEM(item)


def test_a_bot_with_no_facts_has_a_null_basis_and_all_null_signals() -> None:
    item = roster_item_wire(
        make_row(facts=None, coverage=CoverageView("unknown", None, None, 0)), 1
    )
    condition = item["condition"]
    assert condition["basis"] is None  # type: ignore[index]
    assert set(condition["signals"].values()) == {None}  # type: ignore[index]
    VALIDATE_ITEM(item)


def test_body_has_the_standing_note_collector_state_revision_and_cursor() -> None:
    collector = FakeCollector(FakeStatus())
    body = body_for(
        make_row(),
        collector=collector,
    )
    VALIDATE_ROSTER(body)
    assert body["rosterRevision"] == 7
    assert body["nextCursor"] is None
    assert body["notes"] == [{"code": "cron-turns-not-observable", "count": None}]
    assert body["collector"] == {
        "state": "running",
        "reasonCode": None,
        "sinceMs": 1_759_999_000_000,
    }
    assert READERS["roster"](json.loads(json.dumps(body))) is not None


def test_a_missing_collector_reads_as_unavailable() -> None:
    body = body_for(make_row())
    VALIDATE_ROSTER(body)
    assert body["collector"] == {
        "state": "unavailable",
        "reasonCode": "collector-not-started",
        "sinceMs": 1_760_000_001_000,
    }
    assert body["notes"] == [{"code": STANDING_NOTE, "count": None}]


def test_collector_notes_follow_the_standing_note_as_code_count_objects() -> None:
    collector = FakeCollector(
        FakeStatus(notes=(("unsupported-store-less-bot", 2), ("other-note", None)))
    )
    body = body_for(collector=collector)
    VALIDATE_ROSTER(body)
    assert body["notes"] == [
        {"code": STANDING_NOTE, "count": None},
        {"code": "unsupported-store-less-bot", "count": 2},
        {"code": "other-note", "count": None},
    ]


def test_notes_are_capped_at_eight_with_the_standing_note_first() -> None:
    notes = tuple((f"note-{index}", index) for index in range(20))
    body = body_for(collector=FakeCollector(FakeStatus(notes=notes)))
    assert len(body["notes"]) == MAX_NOTES  # type: ignore[arg-type]
    assert body["notes"][0]["code"] == STANDING_NOTE  # type: ignore[index]
    VALIDATE_ROSTER(body)


def test_a_note_code_outside_the_token_pattern_is_dropped() -> None:
    notes = (("Has Space", 1), ("fine-note", 1))
    body = body_for(collector=FakeCollector(FakeStatus(notes=notes)))
    assert [note["code"] for note in body["notes"]] == [STANDING_NOTE, "fine-note"]  # type: ignore[attr-defined]


def test_a_malformed_collector_state_is_reported_unavailable() -> None:
    body = body_for(
        collector=FakeCollector(FakeStatus(state="Bad State", reason_code="Bad Reason"))
    )
    VALIDATE_ROSTER(body)
    assert body["collector"]["state"] == "unavailable"  # type: ignore[index]
    assert body["collector"]["reasonCode"] is None  # type: ignore[index]


def test_cursor_and_items_pass_through_in_order() -> None:
    rows = [make_row(binding_id=f"bnd_{index:04d}", binding_seq=index) for index in range(3)]
    body = body_for(*rows, collector=None)
    body = roster_body(page(*rows, cursor="abc_-123"), 9, None, 1)
    VALIDATE_ROSTER(body)
    assert [item["bindingId"] for item in body["items"]] == ["bnd_0000", "bnd_0001", "bnd_0002"]  # type: ignore[attr-defined]
    assert body["nextCursor"] == "abc_-123"


def test_an_empty_page_validates() -> None:
    VALIDATE_ROSTER(body_for())


def test_no_body_contains_a_slot_key_member_id_memory_store_or_path() -> None:
    row = make_row(
        display_name="Probe Bot",
        name="probe-bot",
        avatar_ref="probe-bot.png",
    )
    text = json.dumps(body_for(row, collector=FakeCollector(FakeStatus())))
    for needle in (*FORBIDDEN_TEXT, DM_KEY, SLOT_KEY):
        assert needle not in text
