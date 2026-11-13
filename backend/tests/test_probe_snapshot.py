import json
from typing import Any, cast

from backend.specter_arena.probe import MARKER
from backend.specter_arena.probe.frames import Attempt, Signal
from backend.specter_arena.probe.matrix import (
    Evidence,
    Observation,
    Run,
    apply_observation,
    empty_run,
    record_host_fact,
)
from backend.specter_arena.probe.snapshot import build_snapshot
from backend.tests.probe_fakes import NOW

SCOPES = {"app-owned", "user-owned", "other-app", "bot", "external-cli"}


def populated_run() -> Run:
    run = empty_run()
    run.run_id = "run-1"
    apply_observation(
        run,
        Observation(
            "app-owned-token-exchange", "APP-TOKEN", NOW, "run/run-1/t", "ok", state="ALLOWED"
        ),
    )
    run.host_facts["host-react-version"] = record_host_fact(
        "host-react-version",
        "OBSERVED",
        (Evidence("OWNER-SESSION", NOW, "annotation/run-1/x", "18.3.1"),),
    )
    run.attempts["member-probe"] = Attempt(
        "member-probe",
        "bot-turn",
        bot_ref="probe",
        signals=[Signal("start", "member-probe", NOW)],
        outcome_evidence="idle",
    )
    run.attempts["w1"] = Attempt("w1", "worker-session")
    run.stats.dropped = 2
    return run


def test_top_level_keys_are_the_sc3_names() -> None:
    snapshot = build_snapshot(populated_run(), captured_at=NOW)
    assert list(snapshot) == ["provenance", "cells", "hostFacts", "attempts"]


def test_provenance_is_live_and_names_the_marker() -> None:
    provenance = build_snapshot(populated_run(), captured_at=NOW)["provenance"]
    assert isinstance(provenance, dict)
    assert list(provenance) == ["source", "runId", "capturedAt", "hostVersion", "sanitisation"]
    assert provenance["source"] == "live"
    assert provenance["runId"] == "run-1"
    assert provenance["capturedAt"] == NOW
    assert provenance["hostVersion"] == "0.12.0"
    assert MARKER in str(provenance["sanitisation"])
    assert "dropped frames: 2" in str(provenance["sanitisation"])


def test_captured_at_defaults_to_now() -> None:
    provenance = build_snapshot(empty_run())["provenance"]
    assert isinstance(provenance, dict)
    assert str(provenance["capturedAt"]).endswith("+00:00")


def test_cells_use_the_sc3_names_and_no_host_scope() -> None:
    cells = build_snapshot(populated_run(), captured_at=NOW)["cells"]
    assert isinstance(cells, list)
    assert len(cells) == 46
    for cell in cells:
        assert list(cell) == ["key", "question", "scope", "state", "evidence"]
        assert cell["scope"] in SCOPES
    allowed = next(cell for cell in cells if cell["key"] == "app-owned-token-exchange")
    assert allowed["state"] == "ALLOWED"
    assert allowed["evidence"][0]["credential"] == "APP-TOKEN"


def test_no_allowed_cell_lacks_app_token_evidence() -> None:
    cells = cast(list[Any], build_snapshot(populated_run(), captured_at=NOW)["cells"])
    for cell in cells:
        if cell["state"] == "ALLOWED":
            assert any(item["credential"] == "APP-TOKEN" for item in cell["evidence"])
        if cell["state"] == "UNTESTED":
            assert cell["evidence"] == []


def test_host_facts_are_a_separate_list_of_every_host_fact_question() -> None:
    facts = build_snapshot(populated_run(), captured_at=NOW)["hostFacts"]
    assert isinstance(facts, list)
    assert len(facts) == 16
    observed = next(fact for fact in facts if fact["id"] == "host-react-version")
    assert observed["status"] == "OBSERVED"
    assert list(observed["evidence"][0]) == ["credential", "at", "ref", "excerpt"]


def test_attempts_use_the_sc3_names() -> None:
    attempts = build_snapshot(populated_run(), captured_at=NOW)["attempts"]
    assert attempts == [
        {
            "id": "member-probe",
            "kind": "bot-turn",
            "signals": [{"kind": "start", "at": NOW}],
            "outcomeEvidence": "idle",
            "botRef": "probe",
        },
        {"id": "w1", "kind": "worker-session", "signals": [], "outcomeEvidence": None},
    ]


def test_the_snapshot_serialises_to_json() -> None:
    snapshot = build_snapshot(populated_run(), captured_at=NOW)
    assert json.loads(json.dumps(snapshot)) == snapshot


def test_no_outcome_evidence_or_excerpt_names_the_verdict() -> None:
    text = json.dumps(build_snapshot(populated_run(), captured_at=NOW)["attempts"])
    assert "accept" not in text.lower()
