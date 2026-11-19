# OA-5 owner sitting runbook

Draft for Eric's review. The agent does not submit.

Last verified commit: `9d215422d1d9ff64aeea1d2b23286c35e6284742` (`main` after FP-14 PR-A #141 and PR-B #142). The artifact the sitting runs on is built from RC-1, the head of commit C1 of FP-14 PR-C; its SHA is in the build record the agent hands you (step 0).

OA-5 is one consolidated owner sitting. It replaces the separate owner checks OA-2 (issue #101), OA-3 (issue #109) and OA-4 (issue #124). It is the evidence for FP-14-AC01 and AC06 and closes BLK-01 in `docs/release/blockers.md`.

Who does what: steps 1 to 13 are yours, in your own terminal and browser. Crew refuses install, update and uninstall from an agent shell (`docs/compatibility/crew-0.12.2.md`, "Install method"). The agent runs step 0, writes down what you report and does not run your steps.

This is an update of an existing install, not a first install. When the research pass read your Crew on 2026-11-19 it was Kiro Crew 0.12.2 with `specter-arena` 0.0.0 enabled, installed from `.../workspace/specter-arena-release`, schema `user_version` 4, 5 bot bindings, 32 observations, no `backups/` folder, installed grants without `/api/chat`, and no `agents/` folder. Read-only. The version string stays `0.0.0` before and after, so the update is proven by other signs (step 3).

## Time

Steps 1 to 12 are budgeted at 20 minutes (1+1+2+1+1+2+3+2+3+1+1+2). These are estimates from the research pass. They were not timed, and they leave no slack. If step 7 needs a retry the sitting runs over. The optional Parts A and B add about 5 minutes, so the sitting is up to about 25 minutes with both. The result file records the actual time. If a dry run suggests the core is clearly over 20 minutes, move the reduced-motion toggle in step 10 to the optional list and record that, without renumbering.

## Rollback (read before step 2)

Disable the app. Replace `~/.kiro/crew/apps/specter-arena/data` with `~/specter-data-backup-OA5` (the copy made in step 2). Enable the app.

## Steps

| # | Min | Step | Expect and record |
|---|---|---|---|
| 0 | prep | Agent: `npm ci && npm run package -- --commit <RC-1 SHA> --out <dir>`. Records the tarball name, size, sha256 and file count. Runs the five-run `arena-perf-1` procedure on RC-1 | `package: sha256 ...`. Pasted into `docs/release/oa-5-result.md` |
| 1 | 1 | Run `shasum -a 256 -c` on the checksum file. Extract. Run the manifest check from `docs/release/install.md` section 3 | `OK`. No non-OK line in the manifest check |
| 2 | 1 | Snapshot. Record the name and version from `kirocrew app list`. Disable the app. Copy the whole `data` folder to `~/specter-data-backup-OA5`. With `sqlite3 -readonly`, read `PRAGMA user_version` and the row counts of `bot_binding` and `observation`, and write them down | The folder exists. The "before" numbers are noted (4 expected from the 2026-11-19 read; the counts may differ) |
| 3 | 2 | `kirocrew app update specter-arena --source <extracted folder>`, then enable | The command succeeds. `installed.json` shows a changed `updatedAt`. `agents/specter-summoner.json` exists. The permission view lists `/api/chat` and the agent `specter-arena-summoner`. `RELEASE-MANIFEST.txt` `commit:` equals RC-1 |
| 4 | 1 | Press **Approve new permissions** (the staged `/api/chat` grant). Wait for the first start (PyPI download on first provision) | `approved-grants.json` lists `/api/chat`. The page opens at `/apps/specter-arena`. Note whether Crew restarted the backend by itself |
| 5 | 1 | Migration check: `sqlite3 -readonly <db> "PRAGMA user_version"` and `ls data/store/backups` | `6`. One `pre-migrate-v4-to-v6-*.db`. The `bot_binding` count equals the "before" count. The `observation` count is at least the "before" count (the collector runs again) |
| 6 | 2 | **Keyboard only from here to step 11** (the manual accessibility journey, `docs/release/a11y-checklist.md`). Roster, then the Arena tab. Open the browser's network panel and note the `scene-assets/arena-map` status and size | 200 and about 2.8 MB, or the documented fallback. Record which (KL-05) |
| 7 | 3 | Specters tab: **Summon** for one bot (this is the old OA-3). If it says summoning is not possible although the grant is approved, disable and enable the app once (the grant is read at start) and try again. Record whether that was needed. Afterwards look in Crew's chat list for a leftover `specter-summon-*` slot. Check whether Crew's history kept the one-off chat. Search the app's `data` folder (not the database) and the text of "Copy diagnostic summary" for the string `specter-summon-` | A Specter with name, epithet, personality, appearance and signature action, no class. Leftover slot: none expected. History kept: yes or no (if no, reword the privacy sentence in the UI and in `docs/release/install.md` before merge). Slot rows or other bots' keys found in the data folder or the summary: BLK-05 becomes `open`, stop and escalate. If Summon still fails: record the exact text, take a screenshot, stop and send the scope decision to Eric (manual Specter entry as the demo fallback, already in `docs/submission/demo-script.md`), then continue with a manually written Specter |
| 8 | 2 | Send the bot a real turn in its Crew DM. Watch the Roster | "Working" with a reason, then "No turn running". An attempt row appears |
| 9 | 3 | Work tab: create a work item, link that attempt, review, **Accept** | Exactly one acceptance. XP +100. The level is shown. The decision is recorded as `app-owner` |
| 10 | 1 | Arena tab: the enemy is defeated. Open the inspector. Turn on the OS "reduce motion" setting once and reload the Arena | The defeat shows. With reduced motion nothing animates (a static label) |
| 11 | 1 | **Open Bots in Crew** (this is the old OA-4) | It lands on Crew's Bots page (`/members`), not a specific bot |
| 12 | 2 | Restart: disable then enable the app. Reload. Inspect history (Specter, work item, XP, arena, roster coverage gap) | Everything survives. The coverage gap reads "Not collected", not zero |
| 13 | 4 | Optional Part B, see below | Data survives an uninstall without `--purge-data` and a reinstall |

### Optional Part A (about 1 minute, between steps 3 and 4, grant still pending)

Press Summon once. Expect "Summoning is not possible right now" and the bot's budget unchanged at 5 of 5. This is the live check of the BLK-04 fix.

### Optional Part B (step 13, about 4 minutes)

Closes the "fresh installation" half of AC01. Run `kirocrew app uninstall specter-arena` (no `--purge-data`), then `kirocrew app install <extracted folder>`. The trust prompt appears again. Enable. Data survives (`docs/release/install.md` section 10). Skip it only if Eric accepts OA-6 (#133) as the fresh-install evidence.

## What you hand back

For each step: pass or fail, the exact text of anything that failed, a screenshot path where one helps, the Crew version and the time. The agent writes it into `docs/release/oa-5-result.md` and writes nothing you did not report. If step 7 fails the issues #101, #109 and #124 stay open and the scope decision goes to Eric first.
