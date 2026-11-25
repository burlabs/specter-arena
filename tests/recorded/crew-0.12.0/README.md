# Recorded Crew 0.12.0 payloads

This directory holds real payloads observed from an installed Kiro Crew 0.12.0 during the FP-01 live probe run. No capture is committed here yet: the FP-01 exports are kept as evidence under `docs/compatibility/evidence/` because they are not in the file shape below. These are recorded captures, not the synthetic stand-ins under `ui/fixtures/`; the FP-01 intake word "fixtures" means this directory.

Rules:

- Release code never reads this directory. `scripts/check-recorded.mjs` fails if `ui/src/` or the backend runtime references `tests/recorded`.
- Nothing here carries the `SPECTER-FIXTURE-ONLY` marker. These are not fixtures.
- Each file is one JSON object: `{ "_meta": { "sanitisation": "<how the capture was sanitised>", "hostVersion": "0.12.0", ... }, "rows": [ ... ] }`.
- Each row has `rowKind`, either `probe` (from the throwaway probe bot, values kept after credential redaction) or `non-probe` (anything else, shape only).
- Within one file, `id`, `key` and `attemptId` values are unique, and no `outcomeEvidence` value claims acceptance. A completed model turn is not accepted work.
- The operator reads the diff for real names, titles and ids before committing any file here.

## Sanitised value grammar (FD-22)

Non-probe values are exactly one of: number, boolean, null, `"sha256:<12 lowercase hex>"` (salted per run), `"<redacted type=<str|list|object> len=<n>>"`. Object keys are kept.

The grammar as a regular expression for string values:

```text
^(sha256:[0-9a-f]{12}|<redacted type=(str|list|object) len=\d+>)$
```

Valid examples: `sha256:0123456789ab`, `<redacted type=str len=12>`, `<redacted type=list len=0>`. Invalid examples: `sha256:0123456789a` (11 hex digits), `sha256:0123456789AB` (uppercase), `h:0123456789ab` (wrong prefix), `<redacted type=int len=3>` (unknown type), any free text.

The check cannot tell whether a hash is of something sensitive, or whether a probe row really came from the probe bot. The operator diff review covers both.
