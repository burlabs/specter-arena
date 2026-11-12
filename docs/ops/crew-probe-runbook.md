# Crew probe runbook

How FP-01 produces committed, reproducible evidence about what an installed Specter Arena app can see in Kiro Crew 0.12.0. The FP-01 run is finished and its evidence is committed under `docs/compatibility/evidence/`; this runbook is the procedure for a re-probe.

## Purpose and limits

Green CI is not live proof. CI proves the dev-only exclusion, the offline validators and the pure probe logic. It cannot start Crew and it never holds the app secret. The evidence for FP-01-AC01 to AC04 is the committed output of a manual live run.

The FIXTURE, RECORDED and INVALID-EVIDENCE view states are proven by jsdom tests only, not on the live host (FD-20). The Webview drawer hook is not probed (FD-6); its cell is committed UNTESTED with the reason.

## Roles and credential labels

- `OWNER-SESSION`: Eric's own terminal and dashboard session. It can establish host facts and denials. Eric performs every owner step himself, in his terminal and browser: in Crew 0.12.0 the agent browser tool refuses the gateway's own dashboard port, and `kirocrew app install` from an agent shell is refused because the process cannot be verified as the local owner (`host-agent-owner-steps-refused`). Agents never install, enable, disable or uninstall the app and never open the dashboard.
- Agents write code, stage the probe app (`probe:stage`, which only prints the install command), read pasted output and assemble evidence. Eric reports what he saw (pasted text or images), and the agent records it in the run log with the credential label.
- `APP-TOKEN`: requests made by the installed backend with the credentials Crew gives it. Only APP-TOKEN results may mark a matrix cell ALLOWED.

Every evidence item carries one label and an ISO 8601 UTC timestamp.

## Rules

- Eric presses every `permissions.api` grant approval and every tool-approval card.
- The agent never reads Crew's private stores or tokens under `~/.kiro/crew/`.
- No literal secret, app-secret value, proxy header value, dashboard token link or key block is ever written in this repository. Describe formats in prose.
- Agents make no gateway call. The only APP-TOKEN requests come from the installed backend, which Eric starts by enabling the app.
- Screenshots Eric pastes into chat are not files. Save one into the evidence directory only if Eric hands over the file; otherwise state in the run log that none was saved.
- A gateway restart is probed only with Eric's explicit go-ahead at run time (FD-21). Without it, the restart cells are recorded UNTESTED with that reason.

## Timebox

Two working days from plan approval (A7). Record the start time in the run log and write the day-2 stop time next to it. At the stop time, every cell or fact not yet answered is committed UNTESTED with the reason, and the monitoring-scope decision proceeds with what exists. The timebox does not extend.

## Run table

Each row records the step, who ran it, the credential label, an ISO 8601 UTC timestamp, the result, and the evidence file.

Closed on 2026-11-12 under the A7 timebox. Steps without a result were not run, and the cells they would decide are UNTESTED.

| Step | Who | Credential | Timestamp | Result | Evidence |
|---|---|---|---|---|---|
| Install the FP-00 stub unchanged and record the failure card | Eric | OWNER-SESSION | 2026-11-09 | Done: "App crashed", React error #306 | `evidence/L1/run-log.md` |
| Install the release build, enable from Library, round trip, disable and re-enable | Eric | OWNER-SESSION | 2026-11-10 | Done after PR #30 | `evidence/L2/run-log.md` |
| Install the probe app with no grants (`v0`) | Eric | APP-TOKEN | 2026-11-10 | Done; export not saved | `evidence/L3-v0/run-log.md` |
| Install the probe app with grants (`v1`), approve each grant | Eric | APP-TOKEN | 2026-11-10 | Done; superseded by the rerun | `evidence/L3-v1/` |
| Create the throwaway probe bot | Eric | OWNER-SESSION | 2026-11-10 | Done (bot named `specter-probe-bot`) | `evidence/L3-v1b/run-log.md` |
| Rerun `v1` after PR #34 and export | Eric | APP-TOKEN | 2026-11-11 | Done: 7 ALLOWED, 9 DENIED, 30 UNTESTED | `evidence/L3-v1b/export.json` |
| Staged-approval check (`v2`) | Eric | OWNER-SESSION | | Not run | none |
| Run one attempt with one worker and one approval | Eric | OWNER-SESSION | | Not run as designed; one bot turn captured, no worker seen | `evidence/L3-v1b/run-log.md` |
| Close the tab, run a second attempt, reopen | Eric | APP-TOKEN | | Not run | none |
| Drop and reconnect the socket | app | APP-TOKEN | | Not run | none |
| External CLI check in a detached tmux session | Eric | APP-TOKEN and OWNER-SESSION | | Not run | none |
| Bot dashboard member-record probe | app | APP-TOKEN | 2026-11-11 | Not decisive: 400 `bad_record_type` | `evidence/L3-v1b/export.json` |
| Delete the probe bot, optionally re-import and fresh start | Eric | APP-TOKEN | | Not run | none |

## Probe app

The probe app is assembled from the release app plus `probe/manifest-overlay.json` by a staging command. Staging never installs; Eric installs the staged app himself and uninstalls it after the run, because the user-slots grant exposes every user-origin chat to the app. Tell Eric before installing the grant phase. Installing, enabling and opening the app are owner steps: agents cannot install apps or open the dashboard.

```sh
npm ci
npm run build
npm run build:diagnostic
npm run probe:stage -- --phase v0
```

`probe:stage` writes the git-ignored `.probe-app/` (with a `.probe-enabled` switch file that exists nowhere else) and prints the install command as text. It refuses to stage a diagnostic bundle that lacks `SPECTER-DIAGNOSTIC-ONLY`. Phases: `v0` declares only the app's own-namespace entry `/apps/specter-arena/api/*` (the browser SDK rejects the app's own proxy path otherwise; every phase keeps it), `v1` adds the probe grants, `v2` adds one more API entry to exercise the staged-approval path. The overlay never contains `backend.hooks`.

### One page, one route

The Crew 0.12.0 dashboard router gives a third-party app exactly one route, `/apps/:name`; there is no `/apps/:name/*`. A second page such as `/apps/specter-arena/diagnostic` redirects to the Crew home. Every staged phase therefore sets `ui.entry` to `diagnostic-dist/index.mjs` and declares a single page, `/apps/specter-arena`, labelled "Specter Diagnostic". The staged app replaces the release page; the release `app.json` and `ui/dist` are unchanged. The probe page is `/apps/specter-arena`.

### Enable the staged app (owner steps)

1. Eric runs the printed install command for `.probe-app`.
2. In the dashboard, open Apps, then Library (the app is not under Discover), and enable "Specter Arena". Crew shows a per-app trust prompt for third-party apps; Eric approves it.
3. Open `/apps/specter-arena`. The page title is "Specter Diagnostic". If the page reads "Enable this app from Apps to use it.", the app is not enabled yet.
4. For `v1` and `v2`, Eric approves each `permissions.api` grant the dashboard shows.
5. To move to the next phase, uninstall the app, stage the next phase, install it again and enable it from the Library.

### Phase detection

The backend works out whether grants are declared from its own installed `app.json`, read once per run: grants are declared when `permissions.api` holds any entry other than `/apps/specter-arena/api/*`, or `permissions.events` is not empty. A `v0` install therefore records the deny-by-default cells (`user-slots-no-grant-denied`, `bot-dashboard-record-ungranted`) instead of leaving them UNTESTED. An explicit `grantsDeclared` in `POST /api/probe/config` overrides the detection. If the file cannot be read, grants are treated as declared and the reason is recorded: `GET /api/probe/state` reports `grantsBasis` as `manifest`, `request`, `default` or `manifest-unreadable: <error>`.

## Export step

The export is a download that Eric makes in his signed-in browser at `/apps/specter-arena/api/probe/export` (the gateway proxies it to the app backend and signs the request). It returns one sanitised JSON document with the snapshot, the matrix and the host facts. Eric saves it, and the agent copies it to `docs/compatibility/evidence/<run step>/export.json` next to a run log written from Eric's report. Agents cannot fetch this URL themselves.

Before committing, read the diff for non-probe names, titles and ids, and for anything shaped like a credential. Then run `npm run probe:check`, which runs `node scripts/check-matrix.mjs` and `node scripts/check-recorded.mjs`. A payload goes under `tests/recorded/crew-0.12.0/` only if it is in the `_meta` plus `rows` shape and passes `check-recorded`; otherwise it stays in the evidence directory and the PR says so.

## When Eric cannot run a step

Eric follows a timestamped file that he fills in: `docs/compatibility/evidence/<run step>/runbook-fallback.md`. A step with no reported result keeps its cells UNTESTED with the reason.

## Monitoring-scope gate

After the live run, Eric decides monitoring scope and collection mechanism, PA1-D2 and PA1-D5. The result is written to `docs/compatibility/monitoring-scope.md`. FP-03 monitoring stays blocked until that file reads `Status: APPROVED`.

## Cleanup

Delete the probe bot, uninstall the probe app, and record both in the run log. The dev-mode toggle is Eric's.
