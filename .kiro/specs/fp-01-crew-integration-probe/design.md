# FP-01 design pointer

This file states the decisions that shape the repository. Planning artifacts stay local to the planning session, so the decisions are stated here rather than linked.

## Where things live

- `docs/compatibility/capability-questions.json`: the canonical question list, `{ "version": 1, "questions": [...] }` sorted by id. Each entry has `kind` (`matrix` or `host-fact`), `scope` (matrix only), `question` and `priority`. The probe code generates it in a later slice; until then it is a placeholder with the same ids and kinds.
- `docs/compatibility/capability-matrix.json` and `.md`: one cell per matrix question.
- `docs/compatibility/host-facts.json` and `crew-0.12.0.md`: one fact per host-fact question, plus the pinned compatibility record.
- `docs/compatibility/monitoring-scope.md`: the AC05 decision record. Status is NOT APPROVED until the decision gate with Eric.
- `docs/compatibility/evidence/<runId>/`: run evidence the cells cite.
- `tests/recorded/crew-0.12.0/`: sanitised real payloads. Never imported by release code.
- `docs/ops/crew-probe-runbook.md`: how the live run is performed.
- `scripts/check-matrix.mjs` and `scripts/check-recorded.mjs`: offline validators. They run under `node --test scripts/__tests__/` and can be run directly.

## Rules the validators enforce

- ALLOWED needs an APP-TOKEN credential in every scope. There is no host-scope exception.
- Credential, evidence reference and probe time are null only for UNTESTED, which needs notes.
- DENIED and UNSUPPORTED need an evidence file that exists under the evidence directory.
- Matrix cells equal the matrix questions; host facts equal the host-fact questions; the Markdown tables agree with the JSON.
- Non-probe recorded values are numbers, booleans, null, a `sha256:` plus 12 lowercase hex digits, or a redaction marker. No outcome evidence says "accepted".

## Slices

S0 (this folder, skeletons, validators, runbook), S1 (live baseline, signed round trip), S2 (diagnostic seam and exclusion proof), S3 (probe logic and view), S4 (live run and decision gate).
