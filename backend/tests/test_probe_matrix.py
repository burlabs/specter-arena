from typing import Any

import pytest

from backend.specter_arena.probe.matrix import (
    Cell,
    Evidence,
    InvalidEvidence,
    Observation,
    add_evidence,
    annotate,
    apply_observation,
    classify,
    classify_http,
    empty_run,
    record_host_fact,
    to_cell,
    to_host_facts_json,
    to_matrix_json,
)
from backend.specter_arena.probe.questions import (
    host_fact_questions,
    matrix_questions,
    question_by_id,
)
from backend.tests.probe_fakes import NOW

ALL_MATRIX = [question.id for question in matrix_questions()]
ALL_FACTS = [question.id for question in host_fact_questions()]


def evidence(credential: Any, excerpt: str = "answered 200") -> Evidence:
    return Evidence.of(credential, NOW, "run/r1/step", excerpt, 200)


def test_every_matrix_question_covers_all_five_scopes() -> None:
    scopes = {question.scope for question in matrix_questions()}
    assert scopes == {"app-owned", "user-owned", "other-app", "bot", "external-cli"}


@pytest.mark.parametrize("cell_id", ALL_MATRIX)
def test_allowed_without_app_token_raises_in_every_cell(cell_id: str) -> None:
    question = question_by_id(cell_id)
    with pytest.raises(InvalidEvidence):
        to_cell(question, "ALLOWED", (evidence("OWNER-SESSION"),))
    with pytest.raises(InvalidEvidence):
        to_cell(question, "ALLOWED", ())


@pytest.mark.parametrize("cell_id", ALL_MATRIX)
def test_allowed_with_app_token_is_accepted_in_every_cell(cell_id: str) -> None:
    question = question_by_id(cell_id)
    cell = to_cell(question, "ALLOWED", (evidence("OWNER-SESSION"), evidence("APP-TOKEN")))
    assert cell.state == "ALLOWED"
    assert cell.decisive is not None
    assert cell.decisive.credential == "APP-TOKEN"


def test_denied_and_unsupported_need_evidence_from_either_credential() -> None:
    question = question_by_id("bot-list-members-denied")
    for state in ("DENIED", "UNSUPPORTED"):
        with pytest.raises(InvalidEvidence):
            to_cell(question, state, ())
        assert to_cell(question, state, (evidence("OWNER-SESSION"),)).state == state
        assert to_cell(question, state, (evidence("APP-TOKEN"),)).state == state


def test_untested_needs_notes_and_carries_no_evidence() -> None:
    question = question_by_id("bot-goals-read")
    with pytest.raises(InvalidEvidence):
        to_cell(question, "UNTESTED")
    with pytest.raises(InvalidEvidence):
        to_cell(question, "UNTESTED", (evidence("APP-TOKEN"),), notes="why")
    cell = to_cell(question, "UNTESTED", notes="not run")
    assert cell.evidence == ()
    assert cell.probed_at is None
    assert cell.decisive is None


def test_unknown_credential_is_refused() -> None:
    with pytest.raises(InvalidEvidence):
        bad: Any = "ROOT"
        Evidence(bad, NOW, "ref", "text")


def test_host_facts_are_not_cells() -> None:
    with pytest.raises(InvalidEvidence):
        to_cell(question_by_id("host-react-version"), "UNTESTED", notes="x")


def test_add_evidence_appends_and_revalidates() -> None:
    question = question_by_id("bot-activity-read")
    denied = to_cell(question, "DENIED", (evidence("APP-TOKEN"),))
    more = add_evidence(denied, evidence("OWNER-SESSION", "second look"))
    assert len(more.evidence) == 2
    untested = to_cell(question, "UNTESTED", notes="x")
    with pytest.raises(InvalidEvidence):
        add_evidence(untested, evidence("APP-TOKEN"))


def test_evidence_excerpts_are_redacted_and_capped() -> None:
    dull = "q" * 20
    item = Evidence.of("APP-TOKEN", NOW, "ref", f"token={dull} " + "n" * 900)
    assert dull not in item.excerpt
    assert len(item.excerpt) <= 500


def test_evidence_json_includes_status_only_when_present() -> None:
    assert "status" not in Evidence("APP-TOKEN", NOW, "r", "e").to_json()
    assert Evidence("APP-TOKEN", NOW, "r", "e", 403).to_json()["status"] == 403


@pytest.mark.parametrize(
    ("status", "shape", "expected"),
    [
        (200, "expected", "ALLOWED"),
        (204, "expected", "ALLOWED"),
        (200, "other", "UNTESTED"),
        (200, "error", "UNTESTED"),
        (401, "error", "DENIED"),
        (403, "error", "DENIED"),
        (404, "error", "DENIED"),
        (403, "other", "UNTESTED"),
        (500, "error", "UNTESTED"),
        (302, "expected", "UNTESTED"),
        (None, "none", "UNTESTED"),
        ("timeout", "none", "UNTESTED"),
    ],
)
def test_classify_http_table(status: Any, shape: Any, expected: str) -> None:
    assert classify_http(status, shape) == expected


def test_classify_prefers_an_untested_reason_then_an_explicit_state() -> None:
    base: dict[str, Any] = {
        "cell_id": "bot-goals-read",
        "credential": "APP-TOKEN",
        "at": NOW,
        "ref": "r",
    }
    reasoned = Observation(**base, excerpt="", state="ALLOWED", untested_reason="skipped")
    assert classify(reasoned) == "UNTESTED"
    explicit = Observation(**base, excerpt="", state="DENIED")
    assert classify(explicit) == "DENIED"


def observe(**kwargs: object) -> Observation:
    fields: dict[str, Any] = {
        "cell_id": "bot-goals-read",
        "credential": "APP-TOKEN",
        "at": NOW,
        "ref": "run/r/step",
        "excerpt": "GET answered",
    }
    fields.update(kwargs)
    return Observation(**fields)


def test_apply_observation_stores_a_decided_cell() -> None:
    run = empty_run()
    cell = apply_observation(run, observe(status=200, body_shape="expected"))
    assert cell.state == "ALLOWED"
    assert run.cells["bot-goals-read"] is cell
    assert run.probed_at == NOW


def test_apply_observation_turns_an_unclear_answer_into_untested_with_a_reason() -> None:
    run = empty_run()
    cell = apply_observation(run, observe(status=500, body_shape="other"))
    assert cell.state == "UNTESTED"
    assert "500" in (cell.notes or "")


def test_an_owner_session_observation_can_never_make_a_cell_allowed() -> None:
    run = empty_run()
    with pytest.raises(InvalidEvidence):
        apply_observation(
            run, observe(credential="OWNER-SESSION", status=200, body_shape="expected")
        )


def test_annotate_cannot_produce_allowed() -> None:
    run = empty_run()
    for credential in ("APP-TOKEN", "OWNER-SESSION"):
        with pytest.raises(InvalidEvidence):
            annotate(run, "bot-goals-read", "ALLOWED", "looked fine", credential, at=NOW)
    assert run.cells == {}


def test_annotate_records_unsupported_denied_and_untested_cells() -> None:
    run = empty_run()
    annotate(
        run, "bot-per-bot-opt-in", "UNSUPPORTED", "grants are app-wide", "OWNER-SESSION", at=NOW
    )
    annotate(run, "bot-goals-read", "DENIED", "403 seen by owner", "OWNER-SESSION", at=NOW)
    annotate(run, "bot-fresh-start", "UNTESTED", "ran out of time", "OWNER-SESSION", at=NOW)
    assert run.cells["bot-per-bot-opt-in"].state == "UNSUPPORTED"
    assert run.cells["bot-goals-read"].decisive is not None
    untested = run.cells["bot-fresh-start"]
    assert untested.state == "UNTESTED"
    assert untested.evidence == ()


def test_annotate_records_host_facts_with_owner_session_evidence() -> None:
    run = empty_run()
    annotate(
        run, "host-react-version", "OBSERVED", "React.version is 18.3.1", "OWNER-SESSION", at=NOW
    )
    annotate(run, "host-consent-screen", "UNTESTED", "no screenshot taken", "OWNER-SESSION", at=NOW)
    assert run.host_facts["host-react-version"].status == "OBSERVED"
    assert run.host_facts["host-consent-screen"].evidence == ()


def test_annotate_rejects_wrong_states_and_empty_notes() -> None:
    run = empty_run()
    with pytest.raises(InvalidEvidence):
        annotate(run, "host-react-version", "ALLOWED", "x", "OWNER-SESSION", at=NOW)
    with pytest.raises(InvalidEvidence):
        annotate(run, "bot-goals-read", "OBSERVED", "x", "OWNER-SESSION", at=NOW)
    with pytest.raises(InvalidEvidence):
        annotate(run, "bot-goals-read", "DENIED", "   ", "OWNER-SESSION", at=NOW)


def test_record_host_fact_accepts_owner_session_evidence() -> None:
    fact = record_host_fact("host-react-version", "OBSERVED", (evidence("OWNER-SESSION"),))
    assert fact.status == "OBSERVED"
    absent = record_host_fact("host-react-version", "NOT-OBSERVED", (evidence("APP-TOKEN"),))
    assert absent.status == "NOT-OBSERVED"


def test_record_host_fact_needs_evidence_and_notes_where_required() -> None:
    with pytest.raises(InvalidEvidence):
        record_host_fact("host-react-version", "OBSERVED", ())
    with pytest.raises(InvalidEvidence):
        record_host_fact("host-react-version", "UNTESTED")
    assert record_host_fact("host-react-version", "UNTESTED", notes="why").notes == "why"
    with pytest.raises(InvalidEvidence):
        record_host_fact("bot-goals-read", "OBSERVED", (evidence("APP-TOKEN"),))


def test_matrix_json_is_all_untested_for_an_empty_run() -> None:
    document = to_matrix_json(empty_run())
    cells = document["cells"]
    assert isinstance(cells, list)
    assert len(cells) == 46
    assert {cell["state"] for cell in cells} == {"UNTESTED"}
    assert all(
        cell["credential"] is None and cell["evidenceRef"] is None and cell["probedAt"] is None
        for cell in cells
    )


def test_matrix_json_with_one_allowed_one_denied_and_the_rest_untested() -> None:
    run = empty_run()
    apply_observation(run, observe(cell_id="app-owned-token-exchange", state="ALLOWED"))
    apply_observation(run, observe(status=403, body_shape="error", credential="OWNER-SESSION"))
    document = to_matrix_json(run)
    cells = {cell["id"]: cell for cell in document["cells"]}  # type: ignore[attr-defined]
    allowed, denied = cells["app-owned-token-exchange"], cells["bot-goals-read"]
    assert (allowed["state"], allowed["credential"]) == ("ALLOWED", "APP-TOKEN")
    assert (denied["state"], denied["credential"]) == ("DENIED", "OWNER-SESSION")
    assert allowed["evidenceRef"] and allowed["probedAt"] == NOW
    assert cells["bot-fresh-start"]["state"] == "UNTESTED"
    assert document["probedAt"] == NOW


def test_host_facts_json_shape() -> None:
    run = empty_run()
    run.host_facts["host-react-version"] = record_host_fact(
        "host-react-version", "OBSERVED", (evidence("OWNER-SESSION"),), "read from the page"
    )
    document = to_host_facts_json(run)
    assert list(document) == ["hostVersion", "runId", "probedAt", "facts"]
    facts = {fact["id"]: fact for fact in document["facts"]}  # type: ignore[attr-defined]
    assert len(facts) == 11
    assert facts["host-react-version"]["status"] == "OBSERVED"
    assert facts["host-react-version"]["evidence"][0]["credential"] == "OWNER-SESSION"
    assert facts["host-backend-spawn"]["status"] == "UNTESTED"


def test_cell_defaults_to_untested() -> None:
    cell = Cell(question_by_id("bot-goals-read"))
    assert cell.state == "UNTESTED"
    assert cell.notes == "not yet probed"
