from backend.specter_arena.probe.events import (
    COUNT_ONLY,
    ENUM_FIELDS,
    EVENT_FIELDS,
    EVENT_VOCABULARY,
    EventLog,
    PendingEvent,
    PendingEvents,
    burst_max_per_second,
    percentile,
)


def test_the_vocabulary_is_sorted_unique_and_covers_every_named_type() -> None:
    assert list(EVENT_VOCABULARY) == sorted(set(EVENT_VOCABULARY))
    assert set(EVENT_FIELDS) <= set(EVENT_VOCABULARY)
    assert set(COUNT_ONLY) <= set(EVENT_VOCABULARY)
    assert not set(COUNT_ONLY) & set(EVENT_FIELDS)
    assert "slots" in EVENT_VOCABULARY


def test_every_allow_list_names_the_slot_and_no_prose_key() -> None:
    prose = {"task", "result", "label", "purpose", "input_preview", "tool_input", "tool"}
    prose |= {"tool_purpose", "agent", "model", "text", "chunk", "content", "message"}
    for event_type, fields in EVENT_FIELDS.items():
        assert "slot" in fields, event_type
        assert not fields & prose, event_type
    assert "status" not in EVENT_FIELDS["chat_status"]
    assert ENUM_FIELDS.isdisjoint({"slot", "id", "batch_id"})


def test_percentile_is_nearest_rank() -> None:
    assert percentile([], 0.5) == 0
    assert percentile([7], 0.95) == 7
    values = list(range(1, 101))
    assert percentile(values, 0.5) == 50
    assert percentile(values, 0.95) == 95
    assert percentile([30, 10, 20], 0.5) == 20


def test_burst_counts_frames_per_wall_clock_second() -> None:
    assert burst_max_per_second([]) == 0
    stamps = [1000, 1100, 1999, 2000, 2500, 5000]
    assert burst_max_per_second(stamps) == 3


def test_the_log_counts_every_frame_and_numbers_them_in_order() -> None:
    log = EventLog()
    seqs = [
        log.seen("chat_done", 120, 1_000),
        log.seen("chat_chunk", 40, 1_010),
        log.seen("chat_chunk", 60, 1_020),
        log.seen("chat_done", 80, 3_000),
    ]
    assert seqs == [1, 2, 3, 4]
    assert log.frames_seen == {"chat_done": 2, "chat_chunk": 2}
    measured = log.measurement()
    assert measured["chat_chunk"] == {
        "count": 2,
        "bytesP50": 40,
        "bytesP95": 60,
        "bytesMax": 60,
        "burstMaxPerSecond": 2,
    }
    assert list(measured) == ["chat_chunk", "chat_done"]


def test_count_only_types_are_never_kept() -> None:
    log = EventLog()
    seq = log.seen("chat_chunk", 10, 1)
    assert log.keep(seq, "chat_chunk", "probe", 1, {"slot": "member-probe"}) is False
    assert log.rows == []
    assert log.rows_kept == {}


def test_kept_rows_carry_the_capture_fields_and_the_cap_counts_drops() -> None:
    log = EventLog(max_rows=2)
    for n in range(3):
        seq = log.seen("chat_done", 10, 1_000 + n)
        log.keep(seq, "chat_done", "probe", 1_000 + n, {"slot": "member-probe", "turn": n})
    assert len(log.rows) == 2
    assert log.rows_dropped_by_cap == 1
    assert log.rows_kept == {"chat_done": 2}
    assert log.frames_seen == {"chat_done": 3}
    assert log.rows[0] == {
        "frameSeq": 1,
        "rowKind": "probe",
        "eventType": "chat_done",
        "receivedAtMs": 1_000,
        "data": {"slot": "member-probe", "turn": 0},
    }
    assert log.keys_seen == {"chat_done": {"slot", "turn"}}


def pending(slot: str, at: float) -> PendingEvent:
    return PendingEvent(slot, at, {"slot": slot}, {"slot": "sha256:000000000000"})


def test_pending_events_are_promoted_or_released_at_the_next_slots_frame() -> None:
    buffer = PendingEvents()
    buffer.hold(pending("w1", 0.0))
    buffer.hold(pending("chat-7", 0.1))
    promoted, unresolved = buffer.resolve(frozenset({"member-probe", "w1"}))
    assert [event.slot for event in promoted] == ["w1"]
    assert [event.slot for event in unresolved] == ["chat-7"]
    assert len(buffer) == 0


def test_pending_events_expire_after_the_ttl() -> None:
    buffer = PendingEvents(ttl_seconds=5.0)
    buffer.hold(pending("a", 0.0))
    buffer.hold(pending("b", 3.0))
    assert buffer.expire(4.9) == []
    assert [event.slot for event in buffer.expire(5.0)] == ["a"]
    assert [event.slot for event in buffer.expire(8.0)] == ["b"]
    assert len(buffer) == 0


def test_the_pending_buffer_is_bounded_and_evicts_the_oldest() -> None:
    buffer = PendingEvents()
    evicted = [buffer.hold(pending(f"s{n}", float(n))) for n in range(101)]
    assert evicted[:100] == [None] * 100
    assert evicted[100] is not None
    assert evicted[100].slot == "s0"
    assert len(buffer) == 100
