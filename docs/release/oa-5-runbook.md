# OA-5 and OA-6 owner sitting runbook

Draft for Eric's review. The agent does not submit.

Last verified commit: `5e1e16380dd448b323b9e8fa6268c875be732ae8` (`main` after FP-16 PR-C #150; re-read for release candidate RC-2). The artifact the sitting runs on is built from RC-2, the merge commit on `main` of the RC-2 docs PR (#151, for FP-14 issue #136). Its SHA, file name and sha256 are in `docs/release/evidence-checklist.md` section 4 and in the build record the agent hands you (step 0).

This is one sitting with two parts. Part 1 is OA-5 (issue #140): the update of your existing install to RC-2 and the integrated journey. It replaces the separate owner checks OA-2 (issue #101) and OA-4 (issue #124); OA-3 (issue #109, live summoning) is closed because summoning was removed (FP-16). It is the evidence for FP-14-AC01 and AC06 and closes BLK-01 in `docs/release/blockers.md`. Part 2 is OA-6 (issue #133): uninstall, reinstall and a clean install from the tarball. It is the evidence for FP-15-AC01 and confirms the "to be confirmed in OA-6" facts in `docs/release/install.md`. Part 2 ends by putting your own data back.

Who does what: steps 1 to 17 are yours, in your own terminal and browser. Crew refuses install, update and uninstall from an agent shell (`docs/compatibility/crew-0.12.2.md`, "Install method"). The agent runs step 0, writes down what you report and does not run your steps.

Starting state. Your installed app is RC-1 (`de533eb`, version `0.0.0`) with the `/api/chat` grant approved, the summoner agent registered and schema `user_version` 6 (you reported 5 bindings and 32 observations after the RC-1 migration on 2026-11-19, recorded in the FP-14 handoff). RC-2 is version `0.1.0`, so `kirocrew app list` shows the change. If the store reads 4 instead of 6, the same steps hold.

Crew version. The install facts in `docs/release/install.md` were read from the Kiro Crew 0.12.2 source. The Crew on this machine read `kirocrew 0.13.0` on 2026-11-20. Record `kirocrew --version` in step 2; the result file and the release record name the version the sitting actually ran on.

## Time

The sitting is budgeted at 25 minutes: Part 1 (steps 1 to 12) 18 minutes, Part 2 (steps 13 to 17) 7 minutes. These are estimates, not timings, and they leave no slack. If the sitting runs over, stop after step 12 and run Part 2 later on the same artifact; record that. The reduced-motion toggle in step 10 is the first thing to drop if time is short, and is recorded as skipped. The result file records the actual time.

## Rollback (read before step 2)

Disable the app. Replace `~/.kiro/crew/apps/specter-arena/data` with `~/specter-data-backup-OA5` (the copy made in step 2). Enable the app. If the app is no longer installed, install the RC-2 folder first, then do the same. If Part 2 fails after step 13, use `~/specter-data-after-OA5` instead, so the step 9 work and XP are kept.

## Part 1: OA-5, update and integrated journey

| # | Min | Step | Expect and record |
|---|---|---|---|
| 0 | prep | Agent: `npm ci && npm run package -- --commit <RC-2 SHA> --out <dir>` from a clean clone. Records the tarball name, size, sha256 and file count. The `arena-perf-1` record for RC-2's code is in `.kiro/specs/fp-10-11-live-arena/performance.md` ("Re-run for RC-2") | `package: sha256 ...`. Pasted into `docs/release/oa-5-result.md` |
| 1 | 1 | Run `shasum -a 256 -c` on the checksum file. Extract to a folder you keep. Run the manifest check from `docs/release/install.md` section 3 | `OK`. No non-OK line in the manifest check |
| 2 | 1 | Snapshot. Record `kirocrew --version` and the name and version from `kirocrew app list`. Disable the app. Copy the whole `data` folder to `~/specter-data-backup-OA5`. With `sqlite3 'file:<db>?immutable=1'`, read `PRAGMA user_version` and the row counts of `bot_binding` and `observation`, and write them down | The folder exists. The "before" numbers are noted (6 expected; the counts may have grown) |
| 3 | 2 | `kirocrew app update specter-arena --source <extracted folder>`, then enable | The command succeeds. `kirocrew app list` shows `0.1.0`. The extracted folder has no `agents/` directory. The permission view lists exactly `/apps/specter-arena/api/*`, `/api/agents` and the event `slots:user`, and no agent. Record whether `~/.kiro/agents/specter-arena--specter-arena-summoner.json` is gone; if not, note it and delete it by hand. `RELEASE-MANIFEST.txt` `commit:` equals the RC-2 SHA |
| 4 | 1 | The update removed a grant, so no "Approve new permissions" button should appear; if one does, stop and record what it lists. Wait for the first start | `approved-grants.json` no longer lists `/api/chat` (record what the host did with the old approval: removed, or kept but unused). The page opens at `/apps/specter-arena`. Note whether Crew restarted the backend by itself |
| 5 | 1 | Migration check with `sqlite3 'file:<db>?immutable=1' "PRAGMA user_version"` (plain `-readonly` fails on the WAL file while the app is disabled), then `.tables`, `SELECT count(*) FROM hero_assignment`, and `ls data/store/backups` | `7`. One backup named `pre-migrate-v<before>-to-v7-*.db`, where `<before>` is the number written in step 2. `.tables` lists `hero_assignment`, `avatar_revision` and `asset` and none of `specter`, `specter_revision`, `generation_request`. `hero_assignment` count equals the `bot_binding` count. The `observation` count is at least the "before" count |
| 6 | 2 | **Keyboard only from here to step 11** (the manual accessibility journey, `docs/release/a11y-checklist.md`). Roster, then the Arena tab. Open the browser's network panel and note the `scene-assets/arena-map` request | The map image draws (FP-16 serves it as a blob URL, never checked on an installed host). Record the status, the size (about 2.8 MB) and whether the map shows, or the documented fallback (a labelled map plate). KL-05 |
| 7 | 2 | Specters tab. For each bot note its hero, epithet and personality. Change one bot's avatar from the gallery, reload, then reset it to the hero portrait. Look in Crew's chat list for leftover `specter-summon-*` chats from RC-1 | Every bot has a hero; heroes follow first-seen order (Vell, Stitch, Reeve, Rattle, Ember for five bindings whose first-seen order matches creation order; a mismatch is recorded, not a failure). Hero text is identical before and after the avatar change, XP and level are unchanged, the reset restores the hero face. Leftover RC-1 chats may exist; delete them in Crew, no app data depends on them |
| 8 | 2 | Send the bot a real turn in its Crew DM. Watch the Roster | "Working" with a reason, then "No turn running". An attempt row appears |
| 9 | 2 | Work tab: create a work item, link that attempt, review, **Accept** | Exactly one acceptance. XP +100. The level is shown. The decision is recorded as `app-owner` |
| 10 | 1 | Arena tab: the enemy is defeated with the XP committed. Check the sprites and the minimap (top left). Open the inspector. Turn on the OS "reduce motion" setting once and reload the Arena | The defeat shows. With reduced motion nothing animates (a static label) |
| 11 | 1 | **Open Bots in Crew** (this is the old OA-4) | It lands on Crew's Bots page (`/members`), not a specific bot |
| 12 | 2 | Restart Crew with `kirocrew restart`. Reload the app page. Inspect history (heroes, avatar, work item, XP, arena, roster coverage gap) | Everything survives. The coverage gap reads "Not collected", not zero |

## Part 2: OA-6, reinstall and clean install

| # | Min | Step | Expect and record |
|---|---|---|---|
| 13 | 1 | Disable the app. Copy the whole `data` folder to `~/specter-data-after-OA5` (your data with the step 9 XP, schema 7) | The folder exists |
| 14 | 2 | `kirocrew app uninstall specter-arena` (no `--purge-data`). Check `~/.kiro/crew/apps/specter-arena/` holds only `data/`. Then `kirocrew app install <extracted folder>` and open Apps, Library, Specter Arena | The uninstall keeps `data/`. The app reinstalls disabled and untrusted. The Trust modal appears again: screenshot it (title text, and whether the declared permissions are listed). Choose "Trust this app and enable". Your heroes, work item and XP are back |
| 15 | 1 | Disable it from the Library toggle and reload the page, then enable it | While disabled the page reads "Enable this app from Apps to use it." Re-enable asks for no second trust; the page and backend return |
| 16 | 2 | Clean install: `kirocrew app uninstall specter-arena --purge-data`. Check that `~/.kiro/crew/apps/specter-arena/` is gone. Then `kirocrew app install <extracted folder>`, open Library, screenshot the Trust modal and the permissions view, and choose "Trust this app and enable" | No "Approve new permissions" step: the grants are approved at install. If Crew does ask for a grant approval, screenshot what it lists, approve only those three entries, and record it as a difference from `install.md` section 5. The permissions view lists exactly `/apps/specter-arena/api/*`, `/api/agents` and `slots:user`. The page renders; the roster fills with your bots, each with a hero, and no work or XP yet |
| 17 | 1 | Put your data back: disable the app, replace `~/.kiro/crew/apps/specter-arena/data` with a copy of `~/specter-data-after-OA5`, enable | Your heroes, avatar choice, work item and XP from step 9 are back. This is also the first live run of a whole-folder restore (KL-08) |

## What you hand back

For each step: pass or fail, the exact text of anything that failed, a screenshot path where one helps (steps 6, 14 and 16 at least), the Crew version and the time. The agent writes it into `docs/release/oa-5-result.md` and writes nothing you did not report. A failed step is fixed with a regression test, a new candidate RC-3 is cut, and only the failed steps are repeated. If step 7 (heroes and avatars, OA-2) fails, issue #101 stays open; if step 11 (Open Bots in Crew, OA-4) fails, issue #124 stays open. Either way the scope decision goes to Eric first.
