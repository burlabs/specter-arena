# Crew probe runbook

How FP-01 produces committed, reproducible evidence about what an installed Specter Arena app can see in Kiro Crew 0.12.0. This is a skeleton: later slices fill in the run table and export commands as the code they use merges.

## Purpose and limits

Green CI is not live proof. CI proves the dev-only exclusion, the offline validators and the pure probe logic. It cannot start Crew and it never holds the app secret. The evidence for FP-01-AC01 to AC04 is the committed output of a manual live run.

The FIXTURE, RECORDED and INVALID-EVIDENCE view states are proven by jsdom tests only, not on the live host (FD-20). The Webview drawer hook is not probed (FD-6); its cell is committed UNTESTED with the reason.

## Roles and credential labels

- `OWNER-SESSION`: Eric's dashboard session, driven by the agent through the browser tool. It can establish host facts and denials.
- `APP-TOKEN`: requests made by the installed backend with the credentials Crew gives it. Only APP-TOKEN results may mark a matrix cell ALLOWED.

Every evidence item carries one label and an ISO 8601 UTC timestamp.

## Rules

- Eric presses every `permissions.api` grant approval and every tool-approval card.
- The agent never reads files under `~/.kiro/crew/`.
- No literal secret, app-secret value, proxy header value or key block is ever written in this repository. Describe formats in prose.
- No gateway call is made outside the browser-driven dashboard and the installed backend.
- A gateway restart is probed only with Eric's explicit go-ahead at run time (FD-21). Without it, the restart cells are recorded UNTESTED with that reason.

## Timebox

Two working days from plan approval (A7). Record the start time in the run log and write the day-2 stop time next to it. At the stop time, every cell or fact not yet answered is committed UNTESTED with the reason, and the monitoring-scope decision proceeds with what exists. The timebox does not extend.

## Run table

Each row records the step, who ran it, the credential label, an ISO 8601 UTC timestamp, the result, and the evidence file.

| Step | Who | Credential | Timestamp | Result | Evidence |
|---|---|---|---|---|---|
| Install the FP-00 stub unchanged and record the failure card | owner | OWNER-SESSION | | | |
| Install the fixed build, approve grants | owner | OWNER-SESSION | | | |
| Create the throwaway probe bot | owner | OWNER-SESSION | | | |
| Run one harmless attempt with one worker and one approval | owner | OWNER-SESSION | | | |
| Close the tab, run a second attempt, reopen | owner | APP-TOKEN | | | |
| Drop and reconnect the socket | app | APP-TOKEN | | | |
| External CLI check in a detached tmux session | owner | APP-TOKEN and OWNER-SESSION | | | |
| Bot dashboard member-record probe | app | APP-TOKEN | | | |
| Delete the probe bot, optionally re-import and fresh start | owner | APP-TOKEN | | | |

## Probe app

The probe app is assembled from the release app plus `probe/manifest-overlay.json` by a staging command. Staging never installs; Eric installs the staged app himself and uninstalls it after the run, because the user-slots grant exposes every user-origin chat to the app. Tell Eric before installing the grant phase.

```sh
npm ci
npm run build
npm run build:diagnostic
npm run probe:stage -- --phase v0
```

`probe:stage` writes the git-ignored `.probe-app/` (with a `.probe-enabled` switch file that exists nowhere else) and prints the install command as text. It refuses to stage a diagnostic bundle that lacks `SPECTER-DIAGNOSTIC-ONLY`. Phases: `v0` declares only the app's own-namespace entry `/apps/specter-arena/api/*` (the browser SDK rejects the app's own proxy path otherwise; every phase keeps it), `v1` adds the probe grants, `v2` adds one more API entry to exercise the staged-approval path. The overlay never contains `backend.hooks`.

## Export step

Planned: the backend writes the sanitised run output to a git-ignored `.probe-out/<runId>/` directory, with a download fallback (FD-18). The operator copies it to `docs/compatibility/evidence/<runId>/` and `tests/recorded/crew-0.12.0/`, reads the diff for non-probe names, then runs `node scripts/check-matrix.mjs` and `node scripts/check-recorded.mjs`.

## Browser fallback

If the browser tool fails, the fallback is a timestamped runbook file that Eric follows and fills in: `docs/compatibility/evidence/<runId>/runbook-fallback.md`.

## Monitoring-scope gate

After the live run, Eric decides monitoring scope and collection mechanism, PA1-D2 and PA1-D5. The result is written to `docs/compatibility/monitoring-scope.md`. FP-03 monitoring stays blocked until that file reads `Status: APPROVED`.

## Cleanup

Delete the probe bot, uninstall the probe app, and record both in the run log. The dev-mode toggle is Eric's.
