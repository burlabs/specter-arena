# Demo script (target 2:38, hard limit 3:00)

Draft for Eric's review. Eric records and uploads; the agent does not. Record the real installed app in Kiro Crew on the Mac it runs on (Crew 0.12.2). Use harmless bots and work only; no credentials or personal data on screen. No music, or only music you made or licensed.

Last verified commit: `5e1e16380dd448b323b9e8fa6268c875be732ae8` (`main` after FP-16 PR-C #150; re-read for release candidate RC-2)

Labels: anything from the FIXTURE preview or any prerecorded clip carries an on-screen label for its whole duration: "FIXTURE (sample data)" or "PRERECORDED". The default plan uses neither.

| Shot | Time | Budget | What is on screen | Voice-over (about) | Evidence it can be done |
|---|---|---|---|---|---|
| 0 Title | 0:00-0:08 | 8 s | App name, "Kiro Crew app, running live", Crew version | "Specter Arena turns the work your Kiro Crew bots do into a game, and only work you accept counts." | `app.json` `displayName` |
| 1 Bots arrive with their heroes | 0:08-0:36 | 28 s | Specters tab with several bots, each already named by its hero with epithet and personality; change one avatar; no class, role or tier anywhere | "Every bot arrives with a hero. The names are fixed. The avatar is yours." | `.kiro/specs/fp-16-heroes-parity` ACs; needs OA-5 to pass |
| 2 Real bot turn on the roster | 0:36-0:58 | 22 s | Roster shows the bot "Working" with the reason; then "No turn running"; coverage shown as time, "Not collected" instead of zero | "The roster shows what Crew actually reports. No turn running is not unhealthy." | FP-04 spec; `docs/compatibility/monitoring-scope.md` |
| 3 A work item accepted | 0:58-1:26 | 28 s | Create a work item, link the bot's attempt, review the evidence, click Accept (labelled in-app acceptance, not a Crew tool approval) | "Finishing a session proves nothing. A person accepts the work." | `.kiro/specs/fp-08-09-work-encounters-xp`; `xp-policy-1` |
| 4 XP and an arena defeat | 1:26-1:54 | 28 s | Switch to Arena: the enemy is defeated, XP and level are shown, "N of M" milestones, no health bar | "Accepted work becomes XP. The arena only shows it." | `.kiro/specs/fp-10-11-live-arena` event-to-effect map |
| 5 Inspector evidence and a blocker | 1:54-2:18 | 24 s | Open the inspector on an item to show its evidence list and XP history entry. Then, on another open item in the Work tab, press "Mark blocked", return to the Arena and open the inspector to show the Blocked marker | "Every number traces to a recorded fact. A blocker is something you say, and it stays visible." | See "Blocker shot" below |
| 6 Open Bots in Crew | 2:18-2:30 | 12 s | Click "Open Bots in Crew"; Crew's Bots page opens | "For the bot's chat and approvals, hand off to Crew." | `docs/compatibility/handoff-routes.md`; lands on the Bots page, not the selected bot. Not live-clicked yet (issue #124) |
| 7 End card | 2:30-2:38 | 8 s | Repo URL, "MIT licensed", "Install: docs/release/install.md" | | `rules-checklist.md` R-4, R-5 |

Total: 8 + 28 + 22 + 28 + 28 + 24 + 12 + 8 = 158 s. That leaves 22 s of margin under 180 s. Cut shot 2 first if a take runs long.

## Blocker shot

The UI can set a blocked state. In `ui/src/work/model.ts` the action table `ACTIONS_BY_STATE` offers `block` on `open`, `reopened` and `awaiting-review` items. `ui/src/work/copy.ts` labels it "Mark blocked", and `ui/src/work/ReviewPanel.tsx` sends it directly with no confirmation panel. The Work tab then shows the state "Blocked" with the reason "You marked this blocked." The arena shows a blocked marker, and the inspector line comes from `blockerLine` in `ui/src/arena/WorkInspector.tsx`: the note of the latest block decision, or a no-reason text. The unit tests under `ui/src/work/` and `ui/src/arena/` cover those paths. Nothing here is a Crew bot state; the roster never shows "Blocked". Say "you marked it blocked" in the voice-over, not "the bot is blocked". This was read from code, not recorded; confirm it on the recording day.

## Rules the footage must follow

- Real supported behavior only. Do not show Waiting on you, a numeric health value, a classification, or XP from tokens.
- State plainly in the voice-over that the arena is read-only.
- If the blocker shot cannot be recorded on the day, drop it and say in the checklist that the blocker is covered by tests, not by footage.
