# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

from datetime import UTC, datetime

from .frames import Attempt
from .matrix import Cell, Run, cell_for, fact_for, fact_json
from .questions import host_fact_questions, matrix_questions

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

SANITISATION = (
    f"{MARKER}; non-probe values reduced to sha256:<12 hex> digests (salted per run, salt never "
    "stored) or <redacted type=... len=n> placeholders; probe rows keep values after secret "
    "redaction; frames that fail sanitising are dropped and counted"
)


def _cell_snapshot(cell: Cell) -> dict[str, object]:
    return {
        "key": cell.question.id,
        "question": cell.question.question,
        "scope": cell.question.scope,
        "state": cell.state,
        "evidence": [item.to_json() for item in cell.evidence],
    }


def _attempt_snapshot(attempt: Attempt) -> dict[str, object]:
    item: dict[str, object] = {
        "id": attempt.id,
        "kind": attempt.kind,
        "signals": [{"kind": signal.kind, "at": signal.at} for signal in attempt.signals],
        "outcomeEvidence": attempt.outcome_evidence,
    }
    if attempt.bot_ref is not None:
        item["botRef"] = attempt.bot_ref
    return item


def build_snapshot(run: Run, *, captured_at: str | None = None) -> dict[str, object]:
    """The SC-3 `DiagnosticSnapshot` for a live run: one provenance, never merged with others."""
    stamp = captured_at or datetime.now(UTC).isoformat()
    sanitisation = f"{SANITISATION}; dropped frames: {run.stats.dropped}"
    return {
        "provenance": {
            "source": "live",
            "runId": run.run_id,
            "capturedAt": stamp,
            "hostVersion": run.host_version,
            "sanitisation": sanitisation,
        },
        "cells": [_cell_snapshot(cell_for(run, question)) for question in matrix_questions()],
        "hostFacts": [fact_json(fact_for(run, question)) for question in host_fact_questions()],
        "attempts": [_attempt_snapshot(attempt) for attempt in run.attempts.values()],
    }
