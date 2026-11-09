import random

from backend.specter_arena.probe.frames import (
    MAX_EVIDENCE_CHARS,
    diff_slots,
    outcome_evidence,
    probe_keys,
    slot_role,
    slot_rows,
)
from backend.tests.probe_fakes import slot_row, slots_frame

AT = "2026-11-09T12:00:00+00:00"
VERB = "accept" + "ed"

Rows = dict[str, dict[str, object]]


def test_slot_rows_reads_only_slots_frames_and_only_object_rows() -> None:
    assert slot_rows(slots_frame(slot_row("a"), slot_row("b"))) == [slot_row("a"), slot_row("b")]
    assert slot_rows({"type": "log", "data": [slot_row("a")]}) == []
    assert slot_rows({"type": "slots", "data": "no"}) == []
    assert slot_rows({"type": "slots", "data": [1, slot_row("a")]}) == [slot_row("a")]


def test_probe_keys_follow_the_created_by_chain() -> None:
    rows = [
        slot_row("member-probe"),
        slot_row("w1", created_by="member-probe"),
        slot_row("w2", created_by="w1"),
        slot_row("other", created_by="somebody"),
        slot_row("lonely"),
    ]
    assert probe_keys(rows, "probe") == {"member-probe", "w1", "w2"}


def test_probe_keys_are_empty_without_a_slug_or_a_dm_slot() -> None:
    rows = [slot_row("member-probe"), slot_row("w1", created_by="member-probe")]
    assert probe_keys(rows, "") == set()
    assert probe_keys(rows, "someone-else") == set()


def test_probe_keys_survive_cycles_and_missing_parents() -> None:
    rows = [
        slot_row("member-probe"),
        slot_row("a", created_by="b"),
        slot_row("b", created_by="a"),
        slot_row("orphan", created_by="gone"),
        slot_row("c", created_by="member-probe"),
        slot_row("d", created_by="c"),
        slot_row("c", created_by="d"),
    ]
    assert probe_keys(rows, "probe") == {"member-probe", "c", "d"}


def test_probe_keys_stop_at_the_depth_limit() -> None:
    rows = [slot_row("member-probe")]
    parent = "member-probe"
    for index in range(12):
        rows.append(slot_row(f"w{index}", created_by=parent))
        parent = f"w{index}"
    found = probe_keys(rows, "probe")
    assert "w7" in found
    assert "w8" not in found


def test_slot_role() -> None:
    assert slot_role(slot_row("member-probe"), "probe") == "bot-dm"
    assert slot_role(slot_row("w1", created_by="member-probe"), "probe") == "worker"
    assert slot_role(slot_row("chat-1"), "probe") == "other"
    assert slot_role(slot_row("member-probe"), "") == "other"


def kinds(prev: Rows, curr: Rows) -> list[str]:
    return [signal.kind for signal in diff_slots(prev, curr, at=AT)]


def test_a_new_running_slot_is_a_start() -> None:
    assert kinds({}, {"s": slot_row("s", running=True)}) == ["start"]


def test_running_turning_true_is_a_start() -> None:
    prev = {"s": slot_row("s", running=False)}
    assert kinds(prev, {"s": slot_row("s", running=True)}) == ["start"]


def test_advancing_activity_while_running_is_progress() -> None:
    prev = {"s": slot_row("s", running=True, last_activity_ts=1.0)}
    assert kinds(prev, {"s": slot_row("s", running=True, last_activity_ts=2.0)}) == ["progress"]


def test_unchanged_or_non_numeric_activity_is_not_progress() -> None:
    prev = {"s": slot_row("s", running=True, last_activity_ts=1.0)}
    assert kinds(prev, {"s": slot_row("s", running=True, last_activity_ts=1.0)}) == []
    assert kinds(prev, {"s": slot_row("s", running=True, last_activity_ts=0.5)}) == []
    odd = {"s": slot_row("s", running=True, last_activity_ts="soon")}
    assert kinds(prev, odd) == []
    assert kinds(odd, prev) == []
    flag = {"s": slot_row("s", running=True, last_activity_ts=True)}
    assert kinds(prev, flag) == []


def test_running_turning_false_is_terminal() -> None:
    prev = {"s": slot_row("s", running=True)}
    assert kinds(prev, {"s": slot_row("s", running=False)}) == ["terminal"]


def test_an_idle_slot_that_stays_idle_signals_nothing() -> None:
    assert kinds({"s": slot_row("s")}, {"s": slot_row("s")}) == []


def test_approval_and_needs_input_are_signalled_once_on_transition() -> None:
    idle = {"s": slot_row("s")}
    waiting = {"s": slot_row("s", pending_approval=True, needs_input=True)}
    assert kinds(idle, waiting) == ["approval", "needs-input"]
    assert kinds(waiting, waiting) == []


def test_a_slot_leaving_the_snapshot_is_removed() -> None:
    prev = {"a": slot_row("a"), "b": slot_row("b")}
    assert kinds(prev, {"a": slot_row("a")}) == ["removed"]


def test_signals_carry_the_slot_key_and_time() -> None:
    (signal,) = diff_slots({}, {"s": slot_row("s", running=True)}, at=AT)
    assert (signal.kind, signal.slot_key, signal.at) == ("start", "s", AT)


def test_outcome_evidence_prefers_wait_state_then_last_message() -> None:
    assert outcome_evidence(slot_row("s", wait_state="waiting for review")) == "waiting for review"
    assert outcome_evidence(slot_row("s", last_message="done with step 3")) == "done with step 3"
    both = slot_row("s", wait_state="idle", last_message="done")
    assert outcome_evidence(both) == "idle"


def test_outcome_evidence_is_none_when_there_is_no_text() -> None:
    assert outcome_evidence(slot_row("s")) is None
    assert outcome_evidence(slot_row("s", wait_state="   ", last_message=5)) is None


def test_outcome_evidence_never_carries_the_verdict_word() -> None:
    for text in (f"The change was {VERB}", f"{VERB.upper()} by reviewer", "acceptance given"):
        result = outcome_evidence(slot_row("s", last_message=text))
        assert result is not None
        assert "accept" not in result.lower()


def test_outcome_evidence_is_capped() -> None:
    result = outcome_evidence(slot_row("s", last_message="n" * 5000))
    assert result is not None
    assert len(result) == MAX_EVIDENCE_CHARS


def test_no_signal_over_random_sequences_names_the_verdict() -> None:
    rng = random.Random(5)
    prev: Rows = {}
    for step in range(200):
        curr = {
            f"s{index}": slot_row(
                f"s{index}",
                running=rng.random() < 0.5,
                pending_approval=rng.random() < 0.3,
                needs_input=rng.random() < 0.3,
                last_activity_ts=float(step),
                last_message=VERB,
            )
            for index in range(rng.randint(0, 4))
        }
        for signal in diff_slots(prev, curr, at=AT):
            assert "accept" not in f"{signal.kind}{signal.slot_key}{signal.at}"
        prev = curr
