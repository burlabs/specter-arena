# FP-08+09 design

Status: planned. The five wire contracts `work-item`, `work-items`, `xp-summary`, `xp-summaries` and `xp-history` are `DRAFT` in `contracts/OWNERS.md` until their first UI consumer merges (PR-C).

## Shape of the work

| Component | PR-A | PR-B | PR-C |
|---|---|---|---|
| work-ledger | five contracts, cases, OWNERS DRAFT rows, migration 0006, `store/work.py`, `store/xp.py`, `store/xp_policy.py`, store errors, `schema-v6.sql`, state, concurrency, property and isolation tests | none | OWNERS freeze flips |
| crew-integration | none | `work/service.py`, `work_routes.py`, `app.py` wiring, route and producer tests, isolation guards | none |
| specter-identity | none | none | none |
| experience | `BACKEND_ONLY` rows in `contracts.test.ts` | none | `ui/src/work/`, Work tab entry, XP in roster detail, Progression panel, types, fixtures, scoped `work.css` |
| delivery | spec ids, this folder, producer meta-test count of twenty, `DEPENDENCIES.md` line | monitoring-scope paragraph, doc upkeep | provenance rows, measured bundle budget, `tests/e2e/work.spec.ts`, doc upkeep |

## Decisions

| Id | Decision |
|---|---|
| FP89-D1 | A WorkItem is a user-created record over observed attempts. Nothing creates one automatically, and an unlinked attempt is inspectable and never reward eligible. |
| FP89-D2 | Acceptance is a human decision through a signed route. The actor is the constant `app-owner` because the proxy gives an app no per-user identity. There is no automatic verifier. |
| FP89-D3 | The reviewer echoes back an `evidenceRevision`, a hash of the linked attempts as the projection holds them. A changed attempt makes the request `stale_evidence`. Work rows hold attempt ids without a foreign key, because `rebuild_projection` empties and refills `attempt`. |
| FP89-D4 | Policy `xp-policy-1`: a fixed bounty of 100 XP per rewardable leaf, split by integer shares among at most 8 contributors with the remainder to the first ids in sorted order. A parent is a container and is never rewarded. |
| FP89-D5 | The ledger is append-only with a trigger-enforced sequence of `award`, `correction` and `reinstatement`, so the net per `(work, bot binding)` is only ever 0 or the original award and re-accepting cannot farm XP. |
| FP89-D6 | Levels come from the versioned table `levels-1` and are derived at read time, never stored. |
| FP89-D7 | XP hangs on `bot_binding.binding_id`. Specter tables are not read or written by the ledger and the Specter code does not import the work modules. |
| FP89-D8 | Property tests use `random.Random(seed)` and real threads. A property-testing package would be a new dependency and is on the escalation list. |
| FP89-D9 | The wire contracts declare states, actions and kinds as pattern tokens, not enums, so they carry no closed list. work-ledger owns them, so no guard exemption is needed. |
| FP89-D10 | The five contracts compose by `$ref` as property values or array items, following `specters.v1` embedding `specter.v1`. `work-item` and `xp-summary` use no local `#/definitions` refs because other schemas embed them whole. |

## End-to-end loop

1. The collector projects an attempt for bot B (FP-04). `GET /api/roster/{bindingId}/attempts` lists it as "Ended"; no outcome exists.
2. The owner creates a WorkItem from that attempt (`POST /api/work`, `requestId`, title, acceptance condition, optional milestones). The item is `open`, `bountyXp` is 100, and `evidenceRevision` is computed from the attempt.
3. The owner submits it (`submit`, `expectedVersion`), then accepts it with the revision shown (`accept`). One transaction writes the decision, the new state and one `award` entry per contributor. A replay of the request returns the same body.
4. `GET /api/xp` and `GET /api/roster/{bindingId}/xp` show the total, the level from `levels-1` and the entry with its decision. The roster detail shows accepted work, XP and level; the Progression panel shows the history.
5. The owner reopens the item: a `correction` entry takes the credit back. Accepting it again writes a `reinstatement` of the same amount. Rejecting, cancelling or blocking never writes XP.
6. A rename, a Specter reroll or a portrait change leaves every ledger row untouched.

## Boundaries that stay as they are

No workflow, lockfile, `requirements.txt`, `backend/pyproject.toml`, `app.json` or `agents/` edit. `scripts/check-spec-ids.mjs`, `scripts/check-schema.mjs`, `scripts/check-provenance.mjs` and `scripts/check-fixtures.mjs` are not edited. The FROZEN contracts and migrations 0001 to 0005 are not edited. The monitoring scope in `docs/compatibility/monitoring-scope.md` keeps its decisions; one section is added.
