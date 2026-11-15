from backend.specter_arena.probe.observers import (
    RenameObserver,
    closed_tab_verdict,
    resync_summary,
)
from backend.tests.probe_fakes import slot_row

DM = frozenset({"member-probe"})
WINDOW = ("2026-11-14T10:00:00+00:00", "2026-11-14T10:15:00+00:00")


def at(minute: int, second: int = 0) -> str:
    return f"2026-11-14T10:{minute:02d}:{second:02d}+00:00"


def test_a_name_change_with_the_same_dm_key_decides_the_rename_cell() -> None:
    observer = RenameObserver()
    for name in ("sha256:aaaaaaaaaaaa", "sha256:bbbbbbbbbbbb", "sha256:aaaaaaaaaaaa"):
        observer.record(name, DM)
    verdict = observer.verdict()
    assert verdict.decided
    assert verdict.text == "display_name changed (values not recorded); DM slot key unchanged"


def test_a_name_change_with_a_different_or_unseen_dm_key_is_not_decided() -> None:
    moved = RenameObserver()
    moved.record("sha256:aaaaaaaaaaaa", DM)
    moved.record("sha256:bbbbbbbbbbbb", frozenset({"member-probe.memory-x"}))
    unseen = RenameObserver()
    unseen.record("sha256:aaaaaaaaaaaa", frozenset())
    unseen.record("sha256:bbbbbbbbbbbb", frozenset())
    for observer in (moved, unseen):
        assert not observer.verdict().decided
        assert "not seen unchanged" in observer.verdict().text


def test_no_name_change_is_not_decided() -> None:
    observer = RenameObserver()
    observer.record("sha256:aaaaaaaaaaaa", DM)
    observer.record("sha256:aaaaaaaaaaaa", DM)
    assert observer.verdict().text == "display_name did not change across 2 reads"
    assert not RenameObserver().verdict().decided


def test_a_signal_inside_a_long_idle_gap_decides_the_closed_tab_cell() -> None:
    requests = [at(1), at(2), at(9)]
    verdict = closed_tab_verdict([at(5)], requests, WINDOW)
    assert verdict.decided
    assert "in a 420 s gap" in verdict.text
    assert "operator-attested" in verdict.text


def test_a_signal_in_a_short_gap_or_outside_the_window_is_not_decided() -> None:
    requests = [at(minute, second) for minute in range(16) for second in (0, 30)]
    assert not closed_tab_verdict([at(5, 30)], requests, WINDOW).decided
    assert not closed_tab_verdict(["2026-11-14T11:00:00+00:00"], [], WINDOW).decided
    assert not closed_tab_verdict([at(5)], [], (at(5), at(5, 30))).decided


def test_the_resync_summary_counts_rows_and_carried_running_state() -> None:
    before = {"member-probe": slot_row("member-probe", running=True), "w1": slot_row("w1")}
    after = {"member-probe": slot_row("member-probe", running=True)}
    assert resync_summary(before, after) == (
        "probe rows before 2, after 1, present in both 1; running state carried over for 1 of 1"
    )
