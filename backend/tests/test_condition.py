import ast
import itertools
from dataclasses import asdict, replace
from pathlib import Path

import pytest

from backend.specter_arena.condition import (
    CONDITION_RULES_VERSION,
    Condition,
    condition_rules_v1,
)
from backend.specter_arena.store import BotFacts, CoverageView, RosterRow

MODULE = Path(__file__).resolve().parents[1] / "specter_arena" / "condition.py"
ALLOWED_IMPORTS = {"__future__", "collections.abc", "dataclasses", "typing"}


def facts(running: bool | None = True, **overrides: bool | None) -> BotFacts:
    values: dict[str, object] = {
        "running": running,
        "turn": 3,
        "turn_gen": "a8b8767e",
        "pending_approval": False,
        "needs_input": False,
        "has_options": False,
        "waiting_for_input": False,
        "interrupted": False,
        "last_activity_ms": 1_760_000_000_000,
        "row_observed_ms": 1_760_000_000_500,
        "event_observed_ms": None,
    }
    values.update(overrides)
    return BotFacts(**values)  # type: ignore[arg-type]


def covered() -> CoverageView:
    return CoverageView("covered", None, 1_000, 0)


def row(
    *,
    presence: str = "present",
    bot_facts: BotFacts | None = None,
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
        facts=bot_facts,
        coverage=coverage or covered(),
        last_observed_ms=1_760_000_000_500,
        workers_running=0,
        workers_seen=0,
        workers_unknown=0,
    )


def test_version_is_one() -> None:
    assert CONDITION_RULES_VERSION == 1


def test_a_covered_present_running_bot_is_working() -> None:
    result = condition_rules_v1(row(bot_facts=facts(True)), 5)
    assert (result.state, result.reason_code, result.basis) == ("working", "running", "row")
    assert result.source_time_ms == 1_760_000_000_000
    assert result.observed_at_ms == 1_760_000_000_500


def test_a_covered_present_idle_bot_is_settled() -> None:
    result = condition_rules_v1(row(bot_facts=facts(False)), 5)
    assert (result.state, result.reason_code) == ("settled", "not-running")


@pytest.mark.parametrize("presence", ["absent", "unknown"])
@pytest.mark.parametrize("running", [True, False, None])
def test_absent_or_unknown_presence_is_unknown_even_when_the_last_fact_says_running(
    presence: str, running: bool | None
) -> None:
    result = condition_rules_v1(row(presence=presence, bot_facts=facts(running)), 5)
    assert (result.state, result.reason_code) == ("unknown", f"presence-{presence}")


@pytest.mark.parametrize("bot_facts", [None, facts(None)])
def test_a_bot_never_observed_running_is_unknown(bot_facts: BotFacts | None) -> None:
    result = condition_rules_v1(row(bot_facts=bot_facts), 5)
    assert (result.state, result.reason_code) == ("unknown", "never-observed")


@pytest.mark.parametrize("running", [True, False])
@pytest.mark.parametrize("state", ["gap", "unknown"])
def test_a_gap_never_leaves_a_bot_working_or_settled(running: bool, state: str) -> None:
    coverage = CoverageView(state, "disconnect", 900, 1)  # type: ignore[arg-type]
    result = condition_rules_v1(row(bot_facts=facts(running), coverage=coverage), 5)
    assert (result.state, result.reason_code) == ("unknown", "disconnect")


def test_a_coverage_state_without_a_reason_gets_a_fixed_reason() -> None:
    coverage = CoverageView("unknown", None, None, 0)
    result = condition_rules_v1(row(bot_facts=facts(True), coverage=coverage), 5)
    assert (result.state, result.reason_code) == ("unknown", "no-coverage")


@pytest.mark.parametrize("reason", ["no-slot-yet", "feed-absent", "heartbeat-stale", "new-reason"])
def test_coverage_reasons_pass_through_without_a_rules_bump(reason: str) -> None:
    coverage = CoverageView("gap", reason, 900, 1)
    assert (
        condition_rules_v1(row(bot_facts=facts(True), coverage=coverage), 5).reason_code == reason
    )


def test_flags_are_signals_and_never_change_the_state() -> None:
    flagged = facts(
        False,
        needs_input=True,
        has_options=True,
        pending_approval=True,
        waiting_for_input=True,
    )
    result = condition_rules_v1(row(bot_facts=flagged), 5)
    assert result.state == "settled"
    assert dict(result.signals) == {
        "needsInput": True,
        "hasOptions": True,
        "pendingApproval": True,
        "waitingForInput": True,
    }


def test_signals_are_all_none_without_facts() -> None:
    result = condition_rules_v1(row(bot_facts=None), 5)
    assert dict(result.signals) == dict.fromkeys(
        ("needsInput", "hasOptions", "pendingApproval", "waitingForInput")
    )
    assert (result.basis, result.source_time_ms, result.observed_at_ms) == (None, None, None)


def test_unknown_presence_still_reports_the_stored_signals_and_basis() -> None:
    result = condition_rules_v1(row(presence="absent", bot_facts=facts(True, needs_input=True)), 5)
    assert result.signals["needsInput"] is True
    assert result.basis == "row"


def test_the_result_is_pure_in_the_clock_argument() -> None:
    subject = row(bot_facts=facts(True))
    assert condition_rules_v1(subject, 1) == condition_rules_v1(subject, 10**12)


def test_truth_table_never_yields_a_state_outside_the_documented_set() -> None:
    flags = (None, False, True)
    for presence, running, coverage_state, flag in itertools.product(
        ("present", "absent", "unknown"),
        (None, False, True),
        ("covered", "gap", "unknown"),
        flags,
    ):
        coverage = CoverageView(coverage_state, "r" if coverage_state != "covered" else None, 1, 0)  # type: ignore[arg-type]
        subject = row(
            presence=presence,
            bot_facts=facts(running, needs_input=flag, has_options=flag),
            coverage=coverage,
        )
        result = condition_rules_v1(subject, 1)
        assert result.state in {"working", "settled", "unknown"}
        covered_and_present = presence == "present" and coverage_state == "covered"
        if result.state != "unknown":
            assert covered_and_present and running is not None


def test_no_output_field_is_numeric_except_the_two_timestamps() -> None:
    result = condition_rules_v1(row(bot_facts=facts(True)), 5)
    for name, value in asdict(result).items():
        if name in {"source_time_ms", "observed_at_ms"}:
            continue
        values = value.values() if isinstance(value, dict) else [value]
        assert not any(
            isinstance(item, int | float) and not isinstance(item, bool) for item in values
        )


def test_condition_is_immutable() -> None:
    result = condition_rules_v1(row(bot_facts=facts(True)), 5)
    with pytest.raises(AttributeError):
        result.state = "settled"  # type: ignore[misc]
    assert isinstance(result, Condition)
    assert replace(result, state="settled").state == "settled"


def test_module_imports_only_the_allowed_modules_and_store_only_for_types() -> None:
    tree = ast.parse(MODULE.read_text())
    runtime: set[str] = set()
    type_only: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module:
            runtime.add(node.module)
        elif isinstance(node, ast.Import):
            runtime.update(alias.name for alias in node.names)
        elif isinstance(node, ast.If):
            for inner in ast.walk(node):
                if isinstance(inner, ast.ImportFrom):
                    type_only.add(f"{'.' * inner.level}{inner.module}")
    assert runtime <= ALLOWED_IMPORTS
    assert type_only == {".store"}
