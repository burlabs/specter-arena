# FP-04 requirements: bot roster and operational monitoring baseline

One session, one design, one plan, at most three PRs (batching approved by Eric on 2026-11-15, limits in the program context §3). The first PR is the backend and contracts, the second the UI foundation, the third the UI detail and the finish. Requirement ids are registered in `spec/ids.md`. Decisions FP4-D1 to FP4-D9 were approved on 2026-11-17 and are recorded in `design.md`.

Under program amendment PA-1, read every "agent" below that anchors a roster entry, a binding or a condition as bot.

## Acceptance criteria (verbatim from the intake)

- **FP-04-AC01:** A user selects supported agents and sees actual tracked attempts with accurate collection scope.
- **FP-04-AC02:** Available, working, waiting, blocked, and unknown fixtures display distinct, inspectable reasons; idle does not imply degraded.
  - Deferral (FP4-D1, approved 2026-11-17): FP-04 shows Working, No turn running and Unknown, each with a reason. Waiting and blocked are not observable on the installed Crew, so their display is deferred until approval signals are proven live. The legend names both as not observable yet. The "No turn running" state is never shown as degraded. See FP04-REQ-2.
- **FP-04-AC03:** Recent-activity metrics use documented windows and denominators and cannot double-count reconnect duplicates.
- **FP-04-AC04:** One agent with two concurrent attempts exposes both conditions rather than replacing one with the other.
- **FP-04-AC05:** Keyboard navigation and a meaningful empty/offline state work without game animation.
- **FP-04-AC06:** No invented completion history, agent capability rating, or success percentage appears for unverified data.

## Requirements

Experience requirements and cross-cutting rules use `FP04-REQ`; the grammar has no experience infix.

| Id | Requirement | Acceptance criteria / source | Slice |
|---|---|---|---|
| FP04-REQ-1 | The roster lists every bound bot from `GET /api/roster`, following `nextCursor`. The user marks bots Watched and switches between Watched and All bots. Search matches display names. A bot's detail lists its tracked attempts and shows its collection coverage. Collection itself is unchanged: the install and its grants are the consent (FP4-D5). | FP-04-AC01 | PR-2, PR-3 |
| FP04-REQ-2 | The bot condition is one of Working, No turn running or Unknown, each with its reason in words. "No turn running" says "Crew reports no running turn. This is not a health reading." and is never called idle, available or healthy. The four Crew flags appear only in source details as unverified raw signals. The legend lists Waiting on you and Blocked as not observable yet, with the reason. `CONDITION_RULES_VERSION` stays 1 (FP4-D1). | FP-04-AC02 (waiting and blocked parts deferred) | PR-2, PR-3 |
| FP04-REQ-3 | Recent activity is computed on the server over two rolling windows, 24 hours and 7 days, each with `fromMs` and `toMs`. Each window gives `botTurnsStarted`, `workersStarted` and `sampleSize`, with `ended`, `stillOpen` and `unknown` summing to `sampleSize`, and shows collected time as `coveredMs` of `windowMs` with `gapCount`. A window with no collected time shows "Not collected", never zeros. A reconnect replay adds no attempt (FP4-D3, FP4-D8). | FP-04-AC03 | PR-1, PR-3 |
| FP04-REQ-4 | Each roster row shows the bot condition and one chip per open-attempt state with its count, so "2 workers working" and "1 worker unknown" appear together. Unknown is never folded into working. The detail view lists every open attempt with its own condition and reason. There is no single merged badge (FP4-D3, FP4-D7). | FP-04-AC04 | PR-1, PR-2, PR-3 |
| FP04-REQ-5 | Every control is reachable and operable by keyboard (list, tabs, detail, source panel) with readable status text. The empty roster, offline or error, collector-unavailable, collector-paused and store-not-ready cases each show a meaningful message. No animation is needed for any of it. | FP-04-AC05 | PR-2, PR-3 |
| FP04-REQ-6 | XP, level and accepted work show "Unavailable until accepted-work tracking ships". No success rate, duration average, ranking, capability rating, token figure or invented completion history appears anywhere. | FP-04-AC06 | PR-2, PR-3 |
| FP04-REQ-7 | The roster header shows the collector state (collection paused, collector unavailable, reconnecting). Roster `notes` appear as plain sentences: cron turns are not observable, and the count of bots with no store. The UI never says the roster is complete. | FP-04-AC01 | PR-2 |
| FP04-REQ-8 | Each bot gets a neutral placeholder built from its display-name initials. It is not derived from `bindingId` and is not a character. No Specter art appears. | Intake scope: temporary deterministic placeholders | PR-2 |
| FP04-REQ-9 | Times are epoch milliseconds on the wire. The UI shows them in the user's locale and time zone, with the absolute time in a tooltip and in the source panel. Copy says "first seen" for `startedMs`. | Intake scope: user's locale | PR-2, PR-3 |
| FP04-REQ-10 | The Watched set is stored as opaque `bindingId`s in `localStorage` key `specter-arena:watched:v1`. It is validated on read, drops ids no longer on the roster, and has an "Unwatch all" control. It holds no names or Crew ids (FP4-D5). | FP-04-AC01 | PR-2 |
| FP04-REQ-11 | The UI polls every 15 seconds while the document is visible, immediately when it becomes visible, and on Refresh. The roster is fetched with `limit=200` and up to 10 pages, with a visible "Roster truncated" note at the cap. The client sorts by display name with a `bindingId` tiebreak. | FP-04-AC01, FP-04-AC05 | PR-2 |
| FP04-REQ-12 | Only `ObservatoryPage`, the observatory model vocabulary, `OperationalLegend`, `OperationalMarker` and `ui.tsx` are adapted from the Figma Make export. The approved contracts win over the export's fixture models. All CSS is scoped under the app root with prefixed classes and no Tailwind. Fixtures stay in the FIXTURE harness and never reach `ui/dist`. | Program decisions 2026-11-17 | PR-2, PR-3 |
| FP04-REQ-13 | FP-04 adds no write route, no pause or resume route, no migration, no runtime dependency and no new permission. The release `app.json` grants stay `slots:user`, `/api/agents` and the app's own namespace (FP4-D4). | Program decisions D-P9, FD-28 | PR-1 to PR-3 |
| FP04-REQ-14 | No new wire shape carries a Crew id, slot key, prompt text or token count. | Program decision FD-29 | PR-1 |
| FP04-REQ-15 | `roster`, `roster-item`, `attempts` and `attempt-item` become `FROZEN` in `contracts/OWNERS.md` in the PR that merges their first UI consumer. A later need adds a `v2` file. `condition.state` stays an open token (FP4-D6). | FP-02-AC04 | PR-3 |
| FP04-REQ-16 | Tests: a backend test drives the real collector, fed frames whose shapes `test_collector_fixtures.py` pins to the recorded `tests/recorded/crew-0.12.2/` capture, into a real store and validates both routes against the schemas (the recorded capture holds no slot rows, so it cannot be replayed into attempts); Playwright covers the preview harness with fixtures. There is no browser test against a live backend. An optional owner check on the installed app is recorded as an owner step (FP4-D9). | FP-04-AC01 to FP-04-AC06 | PR-1, PR-3 |
| FP04-CI-1 | A signed `GET /api/roster/{bindingId}/attempts?cursor=&limit=` returns `attempts.v1`: at most 50 items, newest first, keyset paged. A malformed or unknown id returns 404 `unknown_binding`; bad paging returns `invalid_limit` or `invalid_cursor` (400); store trouble returns `store_not_ready` or `store_unavailable` (503) (FP4-D2). | FP-04-AC01 | PR-1 |
| FP04-CI-2 | `attempt-item.v1` and `attempts.v1` are closed draft-07 contracts with the properties, patterns and invariants in the shared contracts (SC4-1, SC4-5). `attempt-item.v1` inlines its bodies because `attempts.v1` references it whole. | FP-04-AC03, FP-04-AC04 | PR-1 |
| FP04-CI-3 | `roster-item.v1.workers` gains a required integer `unknown`, the count of open worker attempts whose condition is not working, changed in place while the contract is DRAFT. All roster and roster-item cases gain the field, and one case has a value above zero (FP4-D7). | FP-04-AC04 | PR-1 |
| FP04-CI-4 | No body from either route contains the substring `member-` or `.memory-`. Crafted ids (`..`, `%2f`, 65 characters) return 404, not 500. | FP-04-AC06 | PR-1 |
| FP04-CI-5 | The UI host seam reads and types the new bodies: `HostApiError` carries status and error code, `ROSTER_PATH` and `attemptsPath` build the paths, `types.ts` and the contract tests cover both new schemas, and the fixture SDK serves per-path bodies selected by scenario with the marker on line 1. | FP-02-AC04 | PR-1, PR-2 |
| FP04-CI-6 | `mount.tsx` renders the observatory page. `StubShell.tsx` is removed, `mount.test.tsx`, `mount.fixture.test.tsx` and `tests/e2e/smoke.spec.ts` are updated, and the `app.json` description text changes with no permission change. | FP-04-AC05 | PR-2 |
| FP04-WL-1 | `attempts_page` reads existence, feed coverage, the page, both windows and the roster revision in one read transaction. Order is `(started_ms DESC, attempt_id DESC)` with a keyset cursor, the limit is clamped to 50, and an unknown binding raises `UnknownBinding` (SC4-6). | FP-04-AC01 | PR-1 |
| FP04-WL-2 | The pure function `attempt_state(running, slot_last_seen_ms, feed)` returns `ended`, `unknown` or `working` with the reason codes in the shared contracts (SC4-2). Presence is not an input. | FP-04-AC02, FP-04-AC04 | PR-1 |
| FP04-WL-3 | The roster read and `attempts_page` share one `feed_coverage` and one `staleness_cut`. A parity test proves the roster worker counts equal the attempts item counts for fresh, stale, closed and feed-gap workers (SC4-3). | FP-04-AC04 | PR-1 |
| FP04-WL-4 | Window counts use attempts with `from <= started_ms <= to`, split by attempt state. `observedFromMs = max(fromMs, first_seen_ms)`, and `coveredMs` is the union of covered spans clipped to `[observedFromMs, toMs]`, with open intervals ending as the shared contracts specify. `gapCount` counts gap rows overlapping the window (FP4-D8, SC4-6). | FP-04-AC03 | PR-1 |
| FP04-WL-5 | Counts read `attempt` rows only, whose ids are deterministic, so a replayed reconnect leaves every count unchanged. A test replays a recorded reconnect and asserts that. | FP-04-AC03 | PR-1 |
| FP04-WL-6 | No migration is added, and no new SQL identifier contains a denied token. | FP-02-AC06 | PR-1 |
| FP04-DEL-1 | The prefixes `FP-04-AC`, `FP04-REQ`, `FP04-CI`, `FP04-WL` and `FP04-DEL` are registered in `spec/ids.md` before this file uses them. | FP-02-AC04 | PR-1 |
| FP04-DEL-2 | This folder holds `requirements.md`, `design.md` and `tasks.md`, and `npm run check:schema` passes the spec-id check on them. | FP-02-AC04 | PR-1 |
| FP04-DEL-3 | The producer meta-test counts ten schemas and both new `$id`s are named next to `compile_schema` in a producer test. | FP-02-AC04 | PR-1 |
| FP04-DEL-4 | The bundle cap in `ui/src/build-output.test.ts` is a measured budget (measured size plus 25%, rounded up to 1 kB), stated with its measurement in each PR that changes the bundle. `ui/dist` stays exactly `index.mjs`, with CSS inlined. | FP-04-AC05 | PR-2, PR-3 |
| FP04-DEL-5 | `contracts/OWNERS.md` has DRAFT rows for `attempts` and `attempt-item` in PR-1, and all four contracts FROZEN as the last commit of PR-3. | FP-02-AC04 | PR-1, PR-3 |
| FP04-DEL-6 | `docs/provenance.md` discloses Figma Make as a generation tool for ported files, lists them, and no longer claims every file was written from an empty repository. | Program decision 2026-11-17 | PR-3 |
| FP04-DEL-7 | `spec/index.md`, `.kiro/specs/README.md`, `docs/architecture/component-index.md` and the FP-02+03 `design.md` status line are current. | none | PR-3 |
| FP04-DEL-8 | No change to `.github/workflows/ci.yml`, root `package.json`, any lockfile, `requirements.txt`, `DEPENDENCIES.md` or any `scripts/check-*.mjs`. | FP-02-AC04 | PR-1 to PR-3 |

## Exclusions

No pause or resume route, no waiting or blocked states, no collection-side opt-in, no backend-stored selection, no Specter generation, XP, arena, replay, leaderboard, score, health number, token statistic or success rate, and no use of `/api/members/*`.
