# Accessibility checklist

Draft for Eric's review. The agent does not submit.

Last verified commit: `d53b16ea6373094cb0835352adf68c255a9e1398` (`main` after the logo PR #181; re-read for release candidate RC-3)

This is the written half of FP-14-AC05 (keyboard and reduced-motion operation). Part 1 lists what runs in CI. Part 2 lists what a person must check on the installed app. The manual items run inside the OA-5 sitting for RC-3 (`docs/release/oa-5-runbook.md`, Part 1 steps 6 to 10), so there is no separate sitting.

## 1. Automated, in CI

Every row runs against the FIXTURE preview build, not the installed app (KL-17). The axe scan covers WCAG 2.0 and 2.1 level A and AA rules inside the app root only (`tests/e2e/a11y.spec.ts`).

| Check | Test |
|---|---|
| No axe violation on each of the five tabs (Roster, Specters, Work, Arena, Data) | `tests/e2e/a11y.spec.ts` AX-1 |
| No axe violation in selected states: bot, Specter, Work item and every Arena token | AX-2 |
| No axe violation on the avatar picker | AX-3 |
| With forced colors on, a keyboard-focused tab, button, link and search box each show an outline | AX-4 |
| With reduced motion requested, Roster, Specters and Arena run no animation | AX-5 |
| One keyboard-only pass reaches all five tabs and moves focus into each panel | AX-6 |
| No axe violation on the Specter collection controls (search, Filter, Sort, the "No bot yet" hero cards) and their states | AX-7 |
| Specters tab: the controls come before the cards in tab order, and arrow keys move over the visible bot cards only; with reduced motion, using every control starts no animation | `tests/e2e/specters.spec.ts`: FP17-E4, FP17-E6 |
| "Waiting on you" and "Context in use": no axe violation at 1440 and 390 px with the legend open; no sideways scroll at 390 px; no animation with reduced motion | `tests/e2e/signals.spec.ts`: SG-5, SG-6, SG-7 |
| Data tab: keyboard-only pause, resume and purge; no axe violation in each state; no animation with reduced motion; no sideways scroll at 390 px | `tests/e2e/data.spec.ts`: DT-2, DT-3, DT-9, DT-10, DT-11 |
| Keyboard-only roster journey | `tests/e2e/roster.spec.ts`: `a keyboard-only user can find a bot, select it, watch it and switch views` |
| Keyboard-only journey to the detail tabs; reduced motion | `tests/e2e/monitoring.spec.ts`: `a keyboard-only journey reaches the detail tabs`, `with reduced motion requested, nothing animates` |
| Keyboard-only change of avatar and land on the hero heading; reduced motion | `tests/e2e/specters.spec.ts`: `a keyboard-only journey changes the avatar and lands on the hero heading`, `with reduced motion requested, nothing animates, even for a working bot with a Specter` |
| Keyboard-only Work journey; reduced motion; 320 px width | `tests/e2e/work.spec.ts`: E-1, E-10, E-11 |
| Arena is reached by keyboard; keyboard-only inspect and handoff; reduced motion; a defeat is a static label | `tests/e2e/arena.spec.ts`: A-1, A-8, A-6, A-5, A-10b |
| Arena attacks and casts (FP-21): with reduced motion no attack, cast or effect layer is drawn; a paused collector shows the plate and plays nothing; a waiting bot shows the marker and does not attack | `tests/e2e/arena.spec.ts`: A-20 to A-24 (A-21 is the reduced-motion test) |

## 2. Manual, on the installed app

Fill in the last four columns during OA-5. Leave a cell blank if the check was not run.

| # | Check | Who | Environment (OS, browser, screen reader) | Result | Date |
|---|---|---|---|---|---|
| 1 | Keyboard only, in the installed app: Tab to the section tabs, Arrow, Home and End across Roster, Specters, Work, Arena and Data. Tab into each panel. Enter or Space on a row, a Work item, a scene token and "Open Bots in Crew" | | | | |
| 2 | A focus ring is visible on every control, including with Windows High Contrast or macOS Increase Contrast. Note the OS and browser | | | | |
| 3 | With the OS "reduce motion" setting on, nothing moves in all five tabs, no attack or cast is drawn in the Arena, and the arena defeat is a static label | | | | |
| 4 | Screen reader (name it): tab names, a bot row, a Work item state change announcement (`role="status"`), an Arena token and the hero note on the Specter card. An Arena token's name reads title, state, progress, then kind, with the kind last. Confirm by ear | | | | |
| 5 | At 200 percent zoom and in a 320 px wide window there is no horizontal scroll beyond the roster (matches `tests/e2e/work.spec.ts` E-11) | | | | |
| 6 | Colour contrast on the real host theme for the link, the tabs and the token labels | | | | |
| 7 | The `arena-perf-1` numbers are copied from the performance record, naming profile, machine, Node, Playwright, Chromium and commit | | | | |

Items 1 to 3 are checked in the RC-3 sitting. Item 7 depends on the performance record, which is written after the OA-5 build (`docs/release/performance.md`, added in the commit that records the result). Until it exists, item 7 stays blank.
