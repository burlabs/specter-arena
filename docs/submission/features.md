# Features

Draft for Eric's review. The agent does not submit.

Last verified commit: `fab5b910740d98d3683231705734b8f8a1db7a6f`

## What it is

Specter Arena is a Kiro Crew app. It watches the Kiro Crew bots you choose, gives each one a named Specter, turns the work items you accept into XP, and shows the result in a small read-only arena with an evidence inspector. It runs inside your own Kiro Crew; there is no hosted version (`docs/release/judge-access.md`).

Category line for the form: Costume Contest, with the Best Kiro Crew App bonus (Eric's choice in the form).

## Features by tab

The app has four tabs: Roster, Specters, Work and Arena (`ui/src/observatory/ObservatoryPage.tsx`).

| Tab | What it does | Source |
|---|---|---|
| Roster | Lists your Crew bots with a plain condition: "Working", "No turn running" or "Unknown". Shows attempts, activity over 24 h and 7 d, and collection coverage as time, with "Not collected" instead of zeros. "No turn running" is not a health reading. Bots can be marked Watched; that is a view setting stored in the browser | `.kiro/specs/fp-04-bot-roster/requirements.md` (FP-04-AC01, AC02); decisions in `docs/compatibility/monitoring-scope.md` |
| Specters | One hero per bot, from a fixed roster of 11: name, epithet, personality and look are fixed; the owner chooses only the avatar (a bundled portrait, a PNG upload, or the hero's own portrait). No classes, roles or tiers. No model is called | `.kiro/specs/fp-16-heroes-parity/requirements.md` (FP-16-AC01, AC02) |
| Work | You create a work item, link a bot's observed attempts as evidence, optionally add up to 8 milestones, and decide: submit for review, accept, reject, mark blocked, unblock, cancel or reopen. Accepting is a human click recorded as `app-owner`. Ending a session proves nothing | `.kiro/specs/fp-08-09-work-encounters-xp/requirements.md` (FP-08-AC01 to AC06) |
| XP and levels | Each accepted work item that is rewardable pays a fixed 100 XP (`xp-policy-1`), split among the bots whose attempts were linked. Reopening writes a compensating negative entry, and re-accepting reinstates it. Level is derived from net XP with the floors 0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200 (`levels-1`) | FP-09-AC01 to AC03 in the same spec; `backend/tests/test_store_xp_properties.py` |
| Arena | A read-only scene: each bot's Specter, each open work item as an enemy, blocked items marked, accepted items defeated with their committed XP. A list view shows every Specter and enemy. Mode label LIVE or FIXTURE. Reduced motion is respected | `.kiro/specs/fp-10-11-live-arena/requirements.md` (FP-10-AC01 to AC06) |
| Evidence inspector | Select a Specter or enemy to see its attempts, evidence, XP history and blocker reason. "In-app acceptance" is labelled as not a Crew tool approval. "Open Bots in Crew" opens Crew's Bots page; "Copy diagnostic summary" copies a redacted summary | FP-11-AC01 to AC06; `docs/compatibility/handoff-routes.md` |

## What it does not do

- No tokens or session length become XP. Only an accepted work item does.
- No "Waiting on you" or "Blocked" bot states. Crew does not expose them to apps yet, so the roster does not show them. (A work item you mark blocked is a different thing and is shown.)
- The arena cannot decide or write anything. Its only write is the Work tab's decision route, triggered by an explicit click.
- No numeric health, percentage or rating anywhere.
- It cannot open one bot's chat or approve a tool action. Crew 0.12.2 has no route an app can use for that (`docs/compatibility/handoff-routes.md`).
- No replay.

## Not yet verified live

The "Open Bots in Crew" click has been read statically, not clicked live (issue #124). See `known-limitations.md`.
