# Demo script (target 2:28, hard limit 3:00)

Draft for Eric's review. Eric records and uploads; the agent does not. Record the real installed app in Kiro Crew on the Mac it runs on (Crew 0.13.1). Use harmless bots and work only; no credentials or personal data on screen. No music, or only music you made or licensed. FP-15 Stage B finalizes this script after the RC-4 sitting passes.

Last verified commit: `ea0d579547febf03c6dd6f9bcaafcf5e2f49fc70` (`main` after FP-26 PR-B #216; re-read for release candidate RC-7)

Labels: anything from the FIXTURE preview or any prerecorded clip carries an on-screen label for its whole duration: "FIXTURE (sample data)" or "PRERECORDED". The default plan uses neither.

| Shot | Time | Budget | What is on screen | Voice-over (about) | Evidence it can be done |
|---|---|---|---|---|---|
| 0 Title | 0:00-0:08 | 8 s | App name, "Kiro Crew app, running live", Crew version | "Specters of the Abyss turns the work your Kiro Crew bots do into a game. The app watches, and the XP follows what it saw." | `app.json` `displayName` |
| 1 Assign your Specters | 0:08-0:36 | 28 s | A new bot appears. The walkthrough opens over the Arena: pick a hero for one bot by hand, then press "Randomize all unassigned" for the rest; the summary reads "N assigned" | "A new bot has no Specter. You pick one, or let the app pick. The names are fixed. Once assigned, it is final." | `docs/release/oa-5-runbook.md` step 7; FP-23 handoff; needs OA-5 to pass |
| 2 The Specter showcase | 0:36-0:56 | 20 s | Specters tab: the big idle hero with its epithet and personality, press Attack and Cast, open "Bots with this Specter" and jump to the Roster | "Eleven heroes. Fixed names, fixed personalities. Your avatar is the only thing you change." | `docs/release/oa-5-runbook.md` step 8 |
| 3 A real worker run becomes a minion | 0:56-1:24 | 28 s | Arena: a bot starts a worker; a small minion appears next to its hero on a lane; the hero attacks it, the minion strikes back and the hero flinches; the minion grows past 2 minutes (speed the footage up, labelled as sped up, or cut between states) | "A worker session is a task. It shows up as a minion, sized by how long it runs. Size is only a look, and so is the fight." | `docs/release/oa-5-runbook.md` steps 10 and 11; attacks and strike-backs are presentation (KL-22, KL-31) |
| 4 Auto-credit | 1:24-1:52 | 28 s | The worker ends cleanly: the minion is defeated, the inspector reads "Credited" with the XP, "Auto-credited when the task ended cleanly" and "XP follows what the app observed. It is not a check that the outcome was right." | "When a task ends cleanly, the app credits the XP by itself. Nobody accepts anything, and the app says so." | `backend/tests/test_store_tasks.py`; `xp-policy-2`; step 11 |
| 5 A bot waiting on you | 1:52-2:06 | 14 s | A bot waiting on a tool approval shows "Waiting on you"; its hero does not attack | "A bot waiting on you does not attack." | Include only if the RC-4 sitting confirmed it (KL-21, KL-27) |
| 6 Open Bots in Crew | 2:06-2:18 | 12 s | Click "Open Bots in Crew"; Crew's Bots page opens | "For the bot's chat and approvals, hand off to Crew." | `docs/compatibility/handoff-routes.md`; lands on the Bots page, not the selected bot. Not live-clicked yet (issue #124) |
| 7 End card | 2:18-2:28 | 10 s | Repo URL, "MIT licensed", "Install: docs/release/install.md" | | `rules-checklist.md` R-4, R-5 |

Total: 8 + 28 + 20 + 28 + 28 + 14 + 12 + 10 = 148 s. That leaves 32 s of margin under 180 s. Cut shot 5 first, then shot 2, if a take runs long.

## Rules the footage must follow

- Real supported behavior only. Do not show Blocked as a bot state (it is not observable), a numeric health value, a classification, or XP from tokens. Do not say that XP means the work was good or accepted: it means the app watched the task end cleanly. Do not say anyone reviewed it.
- "Waiting on you" is read from Crew's source, not live-tested (KL-21): show it only if the RC-4 sitting confirmed it, and say so. Arena attacks show live activity, not progress or damage (KL-22). Minion size is run time only, and hero places on the map are random (KL-31).
- State plainly in the voice-over that the arena is read-only.
- The worker run in shot 3 takes minutes. Record it live in one take, or record separate takes of the same run and label the cut.
- If a shot cannot be recorded on the day, drop it and say in the checklist which behaviour is covered by tests, not by footage.
