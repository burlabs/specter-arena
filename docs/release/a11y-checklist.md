# Accessibility checklist

Draft for Eric's review. The agent does not submit.

Last verified commit: `ea0d579547febf03c6dd6f9bcaafcf5e2f49fc70` (`main` after FP-26 PR-B #216; re-read for release candidate RC-7)

This is the written half of FP-14-AC05 (keyboard and reduced-motion operation). Part 1 lists what runs in CI. Part 2 lists what a person must check on the installed app. The manual items run inside the OA-5 sitting for RC-4 (`docs/release/oa-5-runbook.md`, Part 1 steps 6 to 11), so there is no separate sitting.

## 1. Automated, in CI

Every row runs against the FIXTURE preview build, not the installed app (KL-17). The axe scan covers WCAG 2.0 and 2.1 level A and AA rules inside the app root only (`tests/e2e/a11y.spec.ts`).

| Check | Test |
|---|---|
| No axe violation on each of the four tabs (Arena, Roster, Specters, Data) | `tests/e2e/a11y.spec.ts` AX-1 |
| No axe violation in selected states: bot, Specter and every Arena token | AX-2 |
| No axe violation on the avatar picker | AX-3 |
| With forced colors on, a keyboard-focused tab, button, link and search box each show an outline | AX-4 |
| With reduced motion requested, Roster, Specters and Arena run no animation | AX-5 |
| One keyboard-only pass reaches all four tabs and moves focus into each panel | AX-6 |
| No axe violation on the Specter showcase and its states | AX-7 |
| Assignment walkthrough: opens by itself, keeps focus out of the page behind it, closes on Escape and does not reopen on reload; no axe violation on a step or the summary; focus outline with forced colors; fits at 390 px | `tests/e2e/specters.spec.ts`: the walkthrough tests (`keeps focus out of the page behind it, and Escape closes it and remembers the bots, so a reload does not reopen it`, `has no axe violation on a step or on the summary, and the focused hero and buttons show an outline with forced colors`, `at 390 px the dialog fits and the page does not scroll sideways`) |
| Specter showcase: Attack and Cast are off with a note under reduced motion and nothing animates; at 390 px it stacks with no sideways scroll | `tests/e2e/specters.spec.ts`: `with reduced motion Attack and Cast are off with a note, and nothing animates`, `at 390 px the showcase stacks, the page does not scroll sideways and the sprite fits` |
| "Waiting on you" and "Context in use": no axe violation at 1440 and 390 px with the legend open; no sideways scroll at 390 px; no animation with reduced motion | `tests/e2e/signals.spec.ts`: SG-5, SG-6, SG-7 |
| Data tab: keyboard-only pause, resume and purge; no axe violation in each state; no animation with reduced motion; no sideways scroll at 390 px | `tests/e2e/data.spec.ts`: DT-2, DT-3, DT-9, DT-10, DT-11 |
| Keyboard-only roster journey | `tests/e2e/roster.spec.ts`: `a keyboard-only user can find a bot, select it, watch it and switch views` |
| Keyboard-only journey to the detail tabs; reduced motion | `tests/e2e/monitoring.spec.ts`: `a keyboard-only journey reaches the detail tabs`, `with reduced motion requested, nothing animates` |
| Keyboard-only change of avatar from the bot detail and land on the hero heading; reduced motion | `tests/e2e/specters.spec.ts`: `a keyboard-only journey changes the avatar from the bot detail and lands on the hero heading`, `with reduced motion requested, nothing animates, even for a working bot with a Specter` |
| Arena is reached by keyboard; keyboard-only inspect and handoff; reduced motion; a defeat is a static label | `tests/e2e/arena.spec.ts`: A-1, A-8, A-6, A-5, A-10b |
| Arena attacks and casts (FP-21): with reduced motion no attack, cast or effect layer is drawn; a paused collector shows the plate and plays nothing; a bot waiting on you shows the marker. Its "does not attack" half is a unit test, because the e2e scenario draws no hero for that bot | `tests/e2e/arena.spec.ts`: the tests titled `A-20 FP-21` to `A-24 FP-21` (`A-21 FP-21` is the reduced-motion test) |
| Arena layout (FP-23): both side panels collapse and reopen by keyboard and the map grows; at 390 px the panes start collapsed and selecting a token opens the inspector; no tab scrolls sideways at 390 px | `tests/e2e/arena.spec.ts`: `A-20 at 1440 the rail and the inspector each collapse and reopen, and the map grows when they do`, `A-21 at 390 px the panes start collapsed and stack below the map, and selecting a token opens the inspector`, `A-18 at 390 px no tab scrolls sideways` |

## 2. Manual, on the installed app

Fill in the last four columns during OA-5. Leave a cell blank if the check was not run.

| # | Check | Who | Environment (OS, browser, screen reader) | Result | Date |
|---|---|---|---|---|---|
| 1 | Keyboard only, in the installed app: Tab to the section tabs, Arrow, Home and End across Arena, Roster, Specters and Data. Tab into each panel. Enter or Space on a row, a scene token, the two panel toggles and "Open Bots in Crew". Open the assignment walkthrough and close it with Escape | | | | |
| 2 | A focus ring is visible on every control, including with Windows High Contrast or macOS Increase Contrast. Note the OS and browser | | | | |
| 3 | With the OS "reduce motion" setting on, nothing moves in all four tabs, no attack or cast is drawn in the Arena or on the Specters tab, and the arena defeat is a static label | | | | |
| 4 | Screen reader (name it): tab names, a bot row, the assignment dialog (its step and the summary), a task state in the inspector, an Arena token and the hero note on the bot's Specter tab. An Arena token's name reads title, state, progress, then kind, with the kind last. Confirm by ear | | | | |
| 5 | At 200 percent zoom and in a 320 px wide window there is no horizontal scroll beyond the roster (the 390 px checks in `tests/e2e/specters.spec.ts` and `tests/e2e/arena.spec.ts` cover the FIXTURE preview only, not 320 px or 200 percent zoom) | | | | |
| 6 | Colour contrast on the real host theme for the link, the tabs and the token labels | | | | |
| 7 | The `arena-perf-1` numbers are copied from the performance record, naming profile, machine, Node, Playwright, Chromium and commit | | | | |

Items 1 to 3 are checked in the RC-4 sitting. Item 7 depends on the performance record, which is written after the OA-5 build (`docs/release/performance.md`, added in the commit that records the result). Until it exists, item 7 stays blank.
