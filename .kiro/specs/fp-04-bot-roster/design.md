# FP-04 design

Status: PR-1 in progress. The four wire contracts `roster`, `roster-item`, `attempts` and `attempt-item` are `DRAFT` in `contracts/OWNERS.md` until their first UI consumer merges.

## Shape of the work

| Component | PR-1 | PR-2 | PR-3 |
|---|---|---|---|
| crew-integration | `attempt-item.v1`, `attempts.v1`, `roster-item.v1.workers.unknown`, the attempts route, `attempts_view.py`, UI types | host seam, fixture bodies, mount swap | OWNERS freeze flips, monitoring-scope paragraph |
| work-ledger | `store/attempts.py`, shared `feed_coverage` and `staleness_cut`, `workers_unknown` on the roster read | none | none |
| experience | none | data layer, roster list, legend, banners | detail view, panels, browser suite |
| delivery | spec ids, this folder, producer meta-test, OWNERS DRAFT rows | bundle budget | provenance, doc upkeep |

specter-identity is not impacted.

## Decisions

| Id | Decision |
|---|---|
| FP4-D1 | Three bot states are shown: Working, No turn running and Unknown, each with a reason. Waiting and blocked are not observable on the installed Crew and are deferred. |
| FP4-D2 | A signed `GET /api/roster/{bindingId}/attempts` route returns `attempts.v1`. |
| FP4-D3 | Activity is two rolling windows (24 h and 7 d) with counts, `coveredMs` and `gapCount`. No rate, duration or score. |
| FP4-D4 | No write route, no pause or resume route, no new permission. |
| FP4-D5 | Selection is a view choice kept in `localStorage` as opaque binding ids. |
| FP4-D6 | The four contracts freeze in the PR that merges their first UI consumer. |
| FP4-D7 | `roster-item.v1.workers` gains required `unknown`, changed in place while DRAFT. |
| FP4-D8 | `observedFromMs = max(fromMs, first seen)`; `coveredMs` and `gapCount` count over `[observedFromMs, toMs]`. |
| FP4-D9 | The real-source backend test drives the real collector into a real store and reads both routes. The recorded capture holds no slot rows, so it cannot be replayed into attempts. |

Defaults taken under the standing delegation: no migration, no new dependency, CSS delivered with `?inline`, a measured bundle budget, `StubShell` removed, the spec-id scheme in `spec/ids.md`, and a provenance disclosure for ported Figma Make code.

## Contracts

| Schema | Owner | Frozen in |
|---|---|---|
| `roster-item` | crew-integration | PR-3 |
| `roster` | crew-integration | PR-3 |
| `attempt-item` | crew-integration | PR-3 |
| `attempts` | crew-integration | PR-3 |

## Metric vocabulary

- `sampleSize` is the number of attempts whose first observed start falls in the window. It equals `botTurnsStarted + workersStarted` and `ended + stillOpen + unknown`.
- `stillOpen` counts attempts whose condition is working.
- `coveredMs` is the collector feed's covered time inside `[observedFromMs, toMs]`. It is a feed-level fact. Zero means not collected, never zero activity.
- `observedFromMs` is the later of the window start and the time the collector first saw the bot.
- Nothing is a rate, an average, a rank or a score.

## Condition vocabulary

- Bot level: `working`, `settled`, `unknown`. Any other token shows as Unknown with its reason code.
- Attempt level: `working`, `ended`, `unknown`. Rule order and reason codes follow the shared staleness cut in `store/roster.py`:
  - `ended-row-idle`, `ended-chat-done`, `ended-other` for closed attempts.
  - The feed reason or `no-coverage` when the feed is not covered.
  - `no-slot-yet` when no slot row exists, `feed-absent` when the slot predates the covered interval, otherwise `running`.
- `ended` is not an outcome. Nothing is stored about success or failure.

## Delivery guards

- `npm run check:schema` covers schemas, cases, owners and spec ids.
- Every schema needs a producer test that names its `$id` beside `compile_schema`.
- The FROZEN policy has no script. PR-3 review checks that only status cells change in the freeze commit.

## Known limits

- Waiting and blocked are not observable yet.
- Cron turns are not observable.
- `startedMs` is the time the collector first received the attempt, not the time Crew started it.
- The live check on the installed app is an owner step.

## Host versions

Recorded captures are from Crew 0.12.2 under `tests/recorded/crew-0.12.2/`.
