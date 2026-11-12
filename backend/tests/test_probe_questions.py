import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from backend.specter_arena.probe import questions

REPO_ROOT = Path(__file__).resolve().parents[2]
COMPAT = REPO_ROOT / "docs" / "compatibility"
KEBAB = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def test_there_are_62_unique_kebab_case_ids_sorted() -> None:
    ids = questions.question_ids()
    assert len(ids) == 62
    assert len(set(ids)) == 62
    assert list(ids) == sorted(ids)
    assert all(KEBAB.fullmatch(question_id) for question_id in ids)


def test_counts_by_kind_and_priority() -> None:
    assert Counter(q.kind for q in questions.QUESTIONS) == {"matrix": 46, "host-fact": 16}
    assert Counter(q.priority for q in questions.QUESTIONS) == {
        "must": 45,
        "best-effort": 16,
        "deferred": 1,
    }
    assert len(questions.matrix_questions()) == 46
    assert len(questions.host_fact_questions()) == 16


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


def _committed(name: str) -> dict[str, Any]:
    document: dict[str, Any] = json.loads((COMPAT / name).read_text())
    return document


def test_committed_matrix_has_one_cell_per_matrix_question_in_order() -> None:
    cells = _committed("capability-matrix.json")["cells"]
    expected = questions.matrix_questions()
    assert [cell["id"] for cell in cells] == [question.id for question in expected]
    assert [cell["question"] for cell in cells] == [question.question for question in expected]
    assert [cell["scope"] for cell in cells] == [question.scope for question in expected]
    text = (COMPAT / "capability-matrix.json").read_text()
    assert questions.canonical_json(json.loads(text)) == text


def test_committed_host_facts_have_one_fact_per_host_fact_question_in_order() -> None:
    facts = _committed("host-facts.json")["facts"]
    expected = questions.host_fact_questions()
    assert [fact["id"] for fact in facts] == [question.id for question in expected]
    assert [fact["question"] for fact in facts] == [question.question for question in expected]
    text = (COMPAT / "host-facts.json").read_text()
    assert questions.canonical_json(json.loads(text)) == text
