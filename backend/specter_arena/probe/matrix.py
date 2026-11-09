# SPECTER-DIAGNOSTIC-ONLY
from __future__ import annotations

import secrets
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal, cast

from .frames import Attempt
from .questions import (
    Question,
    host_fact_questions,
    matrix_questions,
    question_by_id,
)
from .sanitise import SanitiseStats, redact_text

MARKER = "SPECTER-DIAGNOSTIC-ONLY"

HOST_VERSION = "0.12.0"
RING_SIZE = 500
MAX_EXCERPT_CHARS = 500
NOT_YET_PROBED = "not yet probed"

CapabilityState = Literal["ALLOWED", "DENIED", "UNSUPPORTED", "UNTESTED"]
Credential = Literal["APP-TOKEN", "OWNER-SESSION"]
HostFactStatus = Literal["OBSERVED", "NOT-OBSERVED", "UNTESTED"]
BodyShape = Literal["expected", "error", "other", "none"]

CREDENTIALS: tuple[Credential, ...] = ("APP-TOKEN", "OWNER-SESSION")
DENIAL_STATUSES = frozenset({401, 403, 404})


class InvalidEvidence(ValueError):
    """A state was asked for without the evidence its rule requires."""


@dataclass(frozen=True)
class Evidence:
    credential: Credential
    at: str
    ref: str
    excerpt: str
    status: int | str | None = None

    def __post_init__(self) -> None:
        if self.credential not in CREDENTIALS:
            raise InvalidEvidence(f"unknown credential {self.credential!r}")

    @classmethod
    def of(
        cls,
        credential: Credential,
        at: str,
        ref: str,
        excerpt: str,
        status: int | str | None = None,
    ) -> Evidence:
        """Build evidence with the excerpt redacted and capped."""
        return cls(credential, at, ref, redact_text(excerpt)[:MAX_EXCERPT_CHARS], status)

    def to_json(self) -> dict[str, object]:
        item: dict[str, object] = {
            "credential": self.credential,
            "at": self.at,
            "ref": self.ref,
            "excerpt": self.excerpt,
        }
        if self.status is not None:
            item["status"] = self.status
        return item


@dataclass(frozen=True)
class Cell:
    question: Question
    state: CapabilityState = "UNTESTED"
    evidence: tuple[Evidence, ...] = ()
    notes: str | None = NOT_YET_PROBED
    probed_at: str | None = None

    @property
    def decisive(self) -> Evidence | None:
        """The evidence item the committed credential label comes from."""
        if self.state == "ALLOWED":
            return next((item for item in self.evidence if item.credential == "APP-TOKEN"), None)
        return self.evidence[0] if self.evidence else None


def to_cell(
    question: Question,
    state: CapabilityState,
    evidence: tuple[Evidence, ...] = (),
    *,
    notes: str | None = None,
    probed_at: str | None = None,
) -> Cell:
    """Build a matrix cell, enforcing the evidence rule for its state in every scope.

    ALLOWED needs an APP-TOKEN evidence item and has no exception for any scope. DENIED and
    UNSUPPORTED need evidence from either credential. UNTESTED carries a reason and no evidence.
    """
    if question.kind != "matrix":
        raise InvalidEvidence(f"{question.id} is a host fact; use record_host_fact")
    if state == "UNTESTED":
        if not notes:
            raise InvalidEvidence(f"{question.id}: UNTESTED needs notes saying why")
        if evidence:
            raise InvalidEvidence(f"{question.id}: UNTESTED carries no evidence")
        return Cell(question, "UNTESTED", (), notes, None)
    if not evidence:
        raise InvalidEvidence(f"{question.id}: {state} needs an evidence item")
    if state == "ALLOWED" and not any(item.credential == "APP-TOKEN" for item in evidence):
        raise InvalidEvidence(f"{question.id}: ALLOWED requires APP-TOKEN evidence")
    return Cell(question, state, evidence, notes, probed_at or evidence[-1].at)


def add_evidence(cell: Cell, item: Evidence) -> Cell:
    """Append evidence to a decided cell; the result is validated like any other cell."""
    if cell.state == "UNTESTED":
        raise InvalidEvidence(f"{cell.question.id}: decide the state before adding evidence")
    return to_cell(
        cell.question,
        cell.state,
        (*cell.evidence, item),
        notes=cell.notes,
        probed_at=item.at,
    )


@dataclass(frozen=True)
class HostFact:
    question: Question
    status: HostFactStatus = "UNTESTED"
    evidence: tuple[Evidence, ...] = ()
    notes: str | None = NOT_YET_PROBED


def record_host_fact(
    fact_id: str,
    status: HostFactStatus,
    evidence: tuple[Evidence, ...] = (),
    notes: str | None = None,
) -> HostFact:
    """Record a host mechanism fact. Either credential may support it; it is not a permission."""
    question = question_by_id(fact_id)
    if question.kind != "host-fact":
        raise InvalidEvidence(f"{fact_id} is a matrix cell; use to_cell")
    if status == "UNTESTED":
        if not notes:
            raise InvalidEvidence(f"{fact_id}: UNTESTED needs notes saying why")
        return HostFact(question, "UNTESTED", evidence, notes)
    if not evidence:
        raise InvalidEvidence(f"{fact_id}: {status} needs an evidence item")
    return HostFact(question, status, evidence, notes)


@dataclass(frozen=True)
class Observation:
    """One probe result before it becomes a cell.

    An HTTP result sets `status` and `body_shape` and is classified. A result that is not an
    HTTP answer (a signal seen on the feed, a frame count) sets `state` itself.
    """

    cell_id: str
    credential: Credential
    at: str
    ref: str
    excerpt: str
    status: int | str | None = None
    body_shape: BodyShape = "none"
    state: CapabilityState | None = None
    untested_reason: str | None = None


def classify_http(status: int | str | None, body_shape: BodyShape) -> CapabilityState:
    """ALLOWED: a 2xx with the expected shape. DENIED: 401/403/404 with a structured error.

    Anything else is UNTESTED: the probe cannot tell a denial from a fault, so it does not guess.
    """
    if not isinstance(status, int):
        return "UNTESTED"
    if 200 <= status < 300 and body_shape == "expected":
        return "ALLOWED"
    if status in DENIAL_STATUSES and body_shape == "error":
        return "DENIED"
    return "UNTESTED"


def classify(observation: Observation) -> CapabilityState:
    if observation.untested_reason:
        return "UNTESTED"
    if observation.state is not None:
        return observation.state
    return classify_http(observation.status, observation.body_shape)


@dataclass
class Run:
    """Everything one probe run has learned. Held in memory; `snapshot` reads it."""

    run_id: str
    started_at: str
    probe_slug: str = ""
    host_version: str = HOST_VERSION
    cells: dict[str, Cell] = field(default_factory=dict)
    host_facts: dict[str, HostFact] = field(default_factory=dict)
    attempts: dict[str, Attempt] = field(default_factory=dict)
    stats: SanitiseStats = field(default_factory=SanitiseStats)
    frames: deque[dict[str, object]] = field(default_factory=lambda: deque(maxlen=RING_SIZE))
    frame_sink: Callable[[dict[str, object]], None] | None = None
    last_rows: dict[str, dict[str, object]] = field(default_factory=dict)
    # Per-run salt for digests: held in memory only, excluded from repr and never serialised.
    salt: bytes = field(default_factory=lambda: secrets.token_bytes(16), repr=False)
    probed_at: str | None = None

    def record_frame(self, frame: dict[str, object]) -> None:
        self.frames.append(frame)
        if self.frame_sink is not None:
            self.frame_sink(frame)


def apply_observation(run: Run, observation: Observation) -> Cell:
    """Classify an observation and store the resulting cell on the run."""
    question = question_by_id(observation.cell_id)
    state = classify(observation)
    if state == "UNTESTED":
        reason = observation.untested_reason or (
            f"response not decisive (status {observation.status})"
        )
        cell = to_cell(question, "UNTESTED", notes=reason)
    else:
        evidence = Evidence.of(
            observation.credential,
            observation.at,
            observation.ref,
            observation.excerpt,
            observation.status,
        )
        cell = to_cell(question, state, (evidence,), probed_at=observation.at)
    run.cells[question.id] = cell
    run.probed_at = observation.at
    return cell


def annotate(
    run: Run,
    target_id: str,
    state: str,
    note: str,
    credential: Credential,
    *,
    at: str,
) -> None:
    """Operator annotation: UNSUPPORTED, DENIED or UNTESTED for a cell, any status for a fact.

    ALLOWED is never reachable from here; only a probe observation with APP-TOKEN evidence
    produces it.
    """
    question = question_by_id(target_id)
    if not note.strip():
        raise InvalidEvidence("an annotation needs a note")
    evidence = Evidence.of(credential, at, f"annotation/{run.run_id}/{target_id}", note)
    if question.kind == "host-fact":
        if state not in ("OBSERVED", "NOT-OBSERVED", "UNTESTED"):
            raise InvalidEvidence(f"{state} is not a host fact status")
        status = cast(HostFactStatus, state)
        items = () if status == "UNTESTED" else (evidence,)
        run.host_facts[target_id] = record_host_fact(target_id, status, items, evidence.excerpt)
    else:
        if state not in ("UNSUPPORTED", "DENIED", "UNTESTED"):
            raise InvalidEvidence(f"{state} cannot be set by annotation")
        cell_state = cast(CapabilityState, state)
        if cell_state == "UNTESTED":
            run.cells[target_id] = to_cell(question, "UNTESTED", notes=evidence.excerpt)
        else:
            run.cells[target_id] = to_cell(
                question, cell_state, (evidence,), notes=evidence.excerpt, probed_at=at
            )
    run.probed_at = at


def cell_for(run: Run, question: Question) -> Cell:
    return run.cells.get(question.id) or Cell(question)


def fact_for(run: Run, question: Question) -> HostFact:
    return run.host_facts.get(question.id) or HostFact(question)


def _cell_json(cell: Cell) -> dict[str, object]:
    decisive = cell.decisive
    item: dict[str, object] = {
        "id": cell.question.id,
        "question": cell.question.question,
        "scope": cell.question.scope,
        "state": cell.state,
        "credential": decisive.credential if decisive else None,
        "evidenceRef": decisive.ref if decisive else None,
        "probedAt": cell.probed_at,
    }
    if cell.notes:
        item["notes"] = cell.notes
    return item


def to_matrix_json(run: Run) -> dict[str, object]:
    """SC-4 capability-matrix.json: one cell per matrix question, UNTESTED until probed."""
    cells = [_cell_json(cell_for(run, question)) for question in matrix_questions()]
    return {
        "hostVersion": run.host_version,
        "runId": run.run_id,
        "probedAt": run.probed_at,
        "cells": cells,
    }


def fact_json(fact: HostFact) -> dict[str, object]:
    item: dict[str, object] = {
        "id": fact.question.id,
        "question": fact.question.question,
        "status": fact.status,
        "evidence": [evidence.to_json() for evidence in fact.evidence],
    }
    if fact.notes:
        item["notes"] = fact.notes
    return item


def to_host_facts_json(run: Run) -> dict[str, object]:
    """host-facts.json: one fact per host-fact question, UNTESTED until recorded."""
    facts = [fact_json(fact_for(run, question)) for question in host_fact_questions()]
    return {
        "hostVersion": run.host_version,
        "runId": run.run_id,
        "probedAt": run.probed_at,
        "facts": facts,
    }


def empty_run() -> Run:
    """The run behind the committed all-UNTESTED skeletons."""
    return Run(run_id="none", started_at="")
