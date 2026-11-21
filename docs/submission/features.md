# Features

Draft for Eric's review. The agent does not submit.

Last verified commit: `d53b16ea6373094cb0835352adf68c255a9e1398` (`main` after the logo PR #181; re-read for release candidate RC-3)

## What it is

Specter Arena is a Kiro Crew app. It watches the Kiro Crew bots you choose, gives each one a named Specter, turns the work items you accept into XP, and shows the result in a small read-only arena with an evidence inspector. It runs inside your own Kiro Crew; there is no hosted version (`docs/release/judge-access.md`).

Category line for the form: Costume Contest, with the Best Kiro Crew App bonus (Eric's choice in the form).

## Features by tab

The app has five tabs: Roster, Specters, Work, Arena and Data (`ui/src/observatory/ObservatoryPage.tsx`). In Crew's sidebar it shows the Specter Arena logo, selected and unselected, instead of the default box. That icon behaviour is read from the Crew 0.13.0 source and is checked in the RC-3 sitting (`docs/compatibility/crew-0.13.0.md`).

| Tab | What it does | Source |
|---|---|---|
| Roster | Lists your Crew bots with a plain condition: "Working", "Waiting on you", "No turn running" or "Unknown". "Waiting on you" shows when Crew flags a pending tool approval or an open question on the bot, with the reason. It is read from Crew 0.13.0 source, not live-tested (KL-21). On the Activity tab of a bot's detail, a "Context in use" card shows the context window in use on the bot's latest turn, or "Not collected". It is not tokens spent, and it is also source-read. A legend names "Blocked" as not observable yet. Shows attempts, activity over 24 h and 7 d, and collection coverage as time, with "Not collected" instead of zeros. "No turn running" is not a health reading. Bots can be marked Watched; that is a view setting stored in the browser. A summary above the list counts tracked bots, bots working now and bots with a collection gap. While collection is paused the roster says "Collection paused" | `.kiro/specs/fp-04-bot-roster/requirements.md` (FP-04-AC01, AC02); decisions in `docs/compatibility/monitoring-scope.md` |
| Specters | One hero per bot, from a fixed roster of 11: name, epithet, personality and look are fixed; the owner chooses only the avatar (a bundled portrait, a PNG upload, or the hero's own portrait). No classes, roles or tiers. No model is called. Each bot appears as a card with its hero thumbnail, name, epithet, and level and XP from accepted work. A search box finds a hero, epithet or bot. Filter (All, Assigned, Unassigned, Avatar changed) and Sort (Roster order, Name, Level, XP) change the view, which resets on reload. Heroes that no bot holds yet appear as non-interactive "No bot yet" cards | `.kiro/specs/fp-16-heroes-parity/requirements.md` (FP-16-AC01, AC02); `.kiro/specs/fp-17-specters-collection/` |
| Work | You create a work item, link a bot's observed attempts as evidence, optionally add up to 8 milestones, and decide: submit for review, accept, reject, mark blocked, unblock, cancel or reopen. Accepting is a human click recorded as `app-owner`. Ending a session proves nothing | `.kiro/specs/fp-08-09-work-encounters-xp/requirements.md` (FP-08-AC01 to AC06) |
| XP and levels | Each accepted work item that is rewardable pays a fixed 100 XP (`xp-policy-1`), split among the bots whose attempts were linked. Reopening writes a compensating negative entry, and re-accepting reinstates it. Level is derived from net XP with the floors 0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200 (`levels-1`) | FP-09-AC01 to AC03 in the same spec; `backend/tests/test_store_xp_properties.py` |
| Arena | A read-only scene: each bot's Specter, each open work item as an enemy, blocked items marked, accepted items defeated with their committed XP. Three counts sit above the scene (bots observed, coverage unknown, committed XP) and a collapsed "Bots on the field" list names every bot, its hero and its condition without placing anyone. The overview map overlays the scene frame; hero sprites idle, and stop under reduced motion. A working hero attacks its enemy every few seconds, a milestone plays a cast, strikes travel along the line between them and the enemy recoils (a minion hit). These show live activity only. They are not progress or damage, a bot that is waiting on you does not attack and shows a marker instead (KL-22), and no health bar exists. A paused collector shows a "Collection paused" plate and plays nothing. With reduced motion on, no attack or cast is drawn. A list view shows every Specter and enemy. Mode label LIVE or FIXTURE | `.kiro/specs/fp-10-11-live-arena/requirements.md` (FP-10-AC01 to AC06); `.kiro/specs/fp-21-battle-animations/` |
| Data | Your retention window (keep everything by default, or 30, 90, 180 or 365 days), a preview of what an explicit purge would delete and a confirmed purge of old observations, quarantine rows and ended attempts that no work item uses. An export of the whole database to `data/exports/` (newest 20 listed with size and hash). A button that removes unused uploaded portraits, and a count of uploads against the cap of 100. A pause and resume switch for collection. The purge never touches identity, heroes, work items, decisions or XP, and the file does not shrink (KL-23). An export cannot be downloaded or restored through the app (KL-24) | `.kiro/specs/fp-19-data-lifecycle/`; `docs/release/data-and-recovery.md` |
| Evidence inspector | Select a Specter or enemy to see its attempts, evidence, XP history and blocker reason. "In-app acceptance" is labelled as not a Crew tool approval. "Open Bots in Crew" opens Crew's Bots page; "Copy diagnostic summary" copies a redacted summary | FP-11-AC01 to AC06; `docs/compatibility/handoff-routes.md` |

## What it does not do

- No tokens or session length become XP. Only an accepted work item does.
- No "Blocked" bot state. Crew sends no lasting blocked signal, so the roster legend says "Not observable yet". "Waiting on you" is shown from Crew's flags, which were read from source and not live-tested (KL-21). (A work item you mark blocked is a different thing and is shown.)
- The arena cannot decide or write anything. Its only write is the Work tab's decision route, triggered by an explicit click.
- No numeric health, percentage or rating anywhere.
- It cannot open one bot's chat or approve a tool action. Crew 0.12.2 had no route an app can use for that (`docs/compatibility/handoff-routes.md`).
- No replay.

## Not yet verified live

The "Open Bots in Crew" click has been read statically, not clicked live (issue #124). See `known-limitations.md`.
