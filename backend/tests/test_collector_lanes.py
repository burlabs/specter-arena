from dataclasses import dataclass

import pytest

from backend.specter_arena.collector.accounting import Accounting
from backend.specter_arena.collector.lanes import DropRecord, EventLane, RowLane
from backend.specter_arena.collector.vocabulary import LIMITS


@dataclass(frozen=True)
class Row:
    slot_key: str
    turn: int | None = None
    turn_gen: str | None = None
    source_time_ms: int | None = None
    tag: str = ""


def test_row_lane_keeps_one_entry_per_slot_key() -> None:
    lane: RowLane[Row] = RowLane()
    replaced = 0
    for index in range(100_000):
        replaced += lane.put(Row(f"slot-{index % 7}", tag=str(index)), index)
    assert len(lane) == 7
    assert replaced == 100_000 - 7


def test_row_lane_first_put_is_not_a_replacement() -> None:
    lane: RowLane[Row] = RowLane()
    assert lane.put(Row("a"), 1) is False
    assert lane.put(Row("a", tag="later"), 2) is True
    [(row, received)] = lane.drain(10)
    assert (row.tag, received) == ("later", 2)


def test_later_receipt_wins_without_ordering_evidence() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a", tag="first"), 1)
    lane.put(Row("a", tag="second"), 2)
    assert lane.drain(1)[0][0].tag == "second"


def test_older_turn_never_replaces_a_newer_one_on_the_same_turn_gen() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a", turn=5, turn_gen="aa", tag="new"), 1)
    assert lane.put(Row("a", turn=4, turn_gen="aa", tag="old"), 2) is True
    assert lane.drain(1)[0][0].tag == "new"


def test_higher_turn_replaces_on_the_same_turn_gen() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a", turn=4, turn_gen="aa", tag="old"), 1)
    lane.put(Row("a", turn=5, turn_gen="aa", tag="new"), 2)
    assert lane.drain(1)[0][0].tag == "new"


def test_same_turn_falls_back_to_source_time() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a", turn=3, turn_gen="aa", source_time_ms=900, tag="new"), 1)
    lane.put(Row("a", turn=3, turn_gen="aa", source_time_ms=800, tag="old"), 2)
    assert lane.drain(1)[0][0].tag == "new"
    lane.put(Row("a", turn=3, turn_gen="aa", source_time_ms=800, tag="old"), 3)
    lane.put(Row("a", turn=3, turn_gen="aa", source_time_ms=900, tag="new"), 4)
    assert lane.drain(1)[0][0].tag == "new"


def test_equal_evidence_takes_the_later_receipt() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a", turn=3, turn_gen="aa", source_time_ms=900, tag="first"), 1)
    lane.put(Row("a", turn=3, turn_gen="aa", source_time_ms=900, tag="second"), 2)
    assert lane.drain(1)[0][0].tag == "second"


def test_a_new_turn_gen_is_a_source_restart_and_the_later_receipt_wins() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a", turn=90, turn_gen="aa", tag="before restart"), 1)
    lane.put(Row("a", turn=1, turn_gen="bb", tag="after restart"), 2)
    assert lane.drain(1)[0][0].tag == "after restart"


def test_missing_turn_gen_gives_no_ordering_evidence() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a", turn=9, turn_gen=None, tag="first"), 1)
    lane.put(Row("a", turn=2, turn_gen=None, tag="second"), 2)
    assert lane.drain(1)[0][0].tag == "second"


def test_drain_respects_the_limit_and_insertion_order() -> None:
    lane: RowLane[Row] = RowLane()
    for name in "abcde":
        lane.put(Row(name), 1)
    assert [row.slot_key for row, _ in lane.drain(2)] == ["a", "b"]
    assert [row.slot_key for row, _ in lane.drain(0)] == []
    assert len(lane) == 3


def test_requeue_restores_rows_from_a_failed_write() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a"), 1)
    taken = lane.drain(10)
    assert lane.requeue(taken) == 0
    assert len(lane) == 1


def test_requeue_never_replaces_a_newer_row() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a", turn=4, turn_gen="aa", tag="failed"), 1)
    taken = lane.drain(10)
    lane.put(Row("a", turn=5, turn_gen="aa", tag="newer"), 2)
    assert lane.requeue(taken) == 1
    assert lane.drain(1)[0][0].tag == "newer"


def test_requeue_replaces_an_older_queued_row() -> None:
    lane: RowLane[Row] = RowLane()
    lane.put(Row("a", turn=5, turn_gen="aa", tag="failed"), 1)
    taken = lane.drain(10)
    lane.put(Row("a", turn=4, turn_gen="aa", tag="older"), 2)
    assert lane.requeue(taken) == 1
    assert lane.drain(1)[0][0].tag == "failed"


def test_event_lane_rejects_a_zero_bound() -> None:
    with pytest.raises(ValueError):
        EventLane[str](0)


def test_event_lane_is_fifo() -> None:
    lane: EventLane[str] = EventLane(10)
    for index, name in enumerate(["x", "y", "z"]):
        lane.put(name, "dm-1", index)
    assert lane.drain(2) == [("x", "dm-1", 0), ("y", "dm-1", 1)]
    assert lane.drain(5) == [("z", "dm-1", 2)]
    assert lane.drain(5) == []
    assert len(lane) == 0


def test_burst_of_ten_thousand_stays_bounded_and_records_nine_thousand_drops() -> None:
    lane: EventLane[int] = EventLane(LIMITS.event_queue_max)
    accounting = Accounting()
    for index in range(10_000):
        accounting.received += 1
        lane.put(index, "dm-1", index)
        assert len(lane) <= LIMITS.event_queue_max
    drops = lane.take_drops()
    assert drops == [DropRecord("dm-1", 9_000, 0, 8_999)]
    accounting.dropped_with_gap_record += sum(record.count for record in drops)
    assert accounting.balanced(in_flight=len(lane))
    survivors = lane.drain(2_000)
    assert [event for event, _, _ in survivors] == list(range(9_000, 10_000))


def test_take_drops_clears_the_records() -> None:
    lane: EventLane[int] = EventLane(1)
    lane.put(1, "dm-1", 1)
    lane.put(2, "dm-1", 2)
    assert lane.take_drops() == [DropRecord("dm-1", 1, 1, 1)]
    assert lane.take_drops() == []


def test_full_lane_drops_the_oldest_event_of_the_same_binding() -> None:
    lane: EventLane[str] = EventLane(3)
    lane.put("a1", "dm-a", 1)
    lane.put("b1", "dm-b", 2)
    lane.put("a2", "dm-a", 3)
    lane.put("a3", "dm-a", 4)
    assert lane.take_drops() == [DropRecord("dm-a", 1, 1, 1)]
    assert [event for event, _, _ in lane.drain(10)] == ["b1", "a2", "a3"]


def test_full_lane_drops_the_oldest_overall_when_the_binding_has_nothing_queued() -> None:
    lane: EventLane[str] = EventLane(2)
    lane.put("a1", "dm-a", 1)
    lane.put("a2", "dm-a", 2)
    lane.put("b1", "dm-b", 3)
    assert lane.take_drops() == [DropRecord("dm-a", 1, 1, 1)]
    assert [event for event, _, _ in lane.drain(10)] == ["a2", "b1"]


def test_drops_are_summed_per_binding_with_ranges() -> None:
    lane: EventLane[str] = EventLane(2)
    for index in range(4):
        lane.put(f"a{index}", "dm-a", 10 + index)
    lane.put("b0", "dm-b", 20)
    lane.put("b1", "dm-b", 21)
    lane.put("b2", "dm-b", 22)
    drops = lane.take_drops()
    assert drops == [DropRecord("dm-a", 3, 10, 12), DropRecord("dm-b", 2, 20, 21)]
    assert sum(record.count for record in drops) == 5


def test_requeue_front_restores_order_ahead_of_newer_events() -> None:
    lane: EventLane[str] = EventLane(10)
    for index, name in enumerate(["a", "b", "c"]):
        lane.put(name, "dm-1", index)
    taken = lane.drain(2)
    lane.put("d", "dm-2", 3)
    lane.requeue_front(taken)
    assert [event for event, _, _ in lane.drain(10)] == ["a", "b", "c", "d"]
    assert lane.take_drops() == []


def test_requeue_front_over_capacity_drops_the_oldest_and_records_it() -> None:
    lane: EventLane[str] = EventLane(3)
    for index, name in enumerate(["a", "b", "c"]):
        lane.put(name, "dm-1", index)
    taken = lane.drain(3)
    for index, name in enumerate(["d", "e"], start=3):
        lane.put(name, "dm-1", index)
    lane.requeue_front(taken)
    assert [event for event, _, _ in lane.drain(10)] == ["c", "d", "e"]
    assert lane.take_drops() == [DropRecord("dm-1", 2, 0, 1)]


def test_drain_cleans_up_bindings_so_a_later_put_starts_fresh() -> None:
    lane: EventLane[str] = EventLane(2)
    lane.put("a", "dm-a", 1)
    lane.drain(5)
    lane.put("b", "dm-b", 2)
    lane.put("c", "dm-b", 3)
    lane.put("d", "dm-b", 4)
    assert lane.take_drops() == [DropRecord("dm-b", 1, 2, 2)]
