import json
import re
from collections import Counter
from pathlib import Path

import pytest

from backend.specter_arena.probe import questions
from backend.specter_arena.probe.matrix import empty_run, to_host_facts_json, to_matrix_json

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPAT = REPO_ROOT / "docs" / "compatibility"
KEBAB = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def test_there_are_57_unique_kebab_case_ids_sorted() -> None:
    ids = questions.question_ids()
    assert len(ids) == 57
    assert len(set(ids)) == 57
    assert list(ids) == sorted(ids)
    assert all(KEBAB.fullmatch(question_id) for question_id in ids)


def test_counts_by_kind_and_priority() -> None:
    assert Counter(q.kind for q in questions.QUESTIONS) == {"matrix": 46, "host-fact": 11}
    assert Counter(q.priority for q in questions.QUESTIONS) == {
        "must": 42,
        "best-effort": 14,
        "deferred": 1,
    }
    assert len(questions.matrix_questions()) == 46
    assert len(questions.host_fact_questions()) == 11


def test_scope_belongs_to_matrix_questions_only() -> None:
    for question in questions.QUESTIONS:
        assert (question.scope is None) == (question.kind == "host-fact")
        assert str(question.scope) != "host"


def test_every_question_names_what_it_covers_and_who_drives_it() -> None:
    for question in questions.QUESTIONS:
        assert question.intake
        assert question.method
        if question.kind == "host-fact":
            assert question.needs_owner


@pytest.mark.parametrize(
    "tag",
    [
        "bot-id-observable",
        "user-slots-visible",
        "user-signal-start",
        "user-signal-terminal",
        "user-signal-tool-error",
        "user-signal-approval",
        "user-source-links",
        "app-owned-slots-visible",
        "other-app-slots-absent",
        "closed-tab-collection",
        "reconnect-snapshot",
        "external-cli-slot-appears",
        "bot-list-via-agents",
        "bot-ledger-read",
        "bot-goals-read",
        "bot-key-results-read",
        "bot-activity-read",
        "bot-per-bot-opt-in",
        "bot-delete-behaviour",
        "bot-dashboard-member-record",
    ],
)
def test_intake_and_pa1_coverage_ids_exist(tag: str) -> None:
    assert tag in questions.question_ids()


def test_the_webview_hook_is_committed_as_deferred_and_not_probed() -> None:
    hook = questions.question_by_id("bot-dashboard-webview-hook")
    assert hook.priority == "deferred"
    assert hook.method == "not-probed"


def test_unknown_id_raises() -> None:
    with pytest.raises(KeyError):
        questions.question_by_id("no-such-question")


def test_export_json_reproduces_the_committed_file_byte_for_byte() -> None:
    committed = (COMPAT / "capability-questions.json").read_bytes()
    assert questions.export_json().encode() == committed
    assert committed.endswith(b"\n")


def test_exported_entries_have_the_v1_13_shape() -> None:
    document = json.loads(questions.export_json())
    assert list(document) == ["version", "questions"]
    assert document["version"] == 1
    for entry in document["questions"]:
        keys = list(entry)
        assert keys[:2] == ["id", "kind"]
        assert ("scope" in entry) == (entry["kind"] == "matrix")
        assert keys[-2:] == ["question", "priority"]


def test_committed_matrix_skeleton_is_what_an_empty_run_produces() -> None:
    expected = questions.canonical_json(to_matrix_json(empty_run()))
    assert (COMPAT / "capability-matrix.json").read_text() == expected


def test_committed_host_facts_skeleton_is_what_an_empty_run_produces() -> None:
    expected = questions.canonical_json(to_host_facts_json(empty_run()))
    assert (COMPAT / "host-facts.json").read_text() == expected
