# Accessibility checklist

Draft for Eric's review. The agent does not submit.

Last verified commit: `9d215422d1d9ff64aeea1d2b23286c35e6284742` (`main` after FP-14 PR-A #141 and PR-B #142)

This is the written half of FP-14-AC05 (keyboard and reduced-motion operation). Part 1 lists what runs in CI. Part 2 lists what a person must check on the installed app. The manual items run inside OA-5 steps 6 to 11 (`docs/release/oa-5-runbook.md`), so there is no separate sitting.

## 1. Automated, in CI

Every row runs against the FIXTURE preview build, not the installed app (KL-17). The axe scan covers WCAG 2.0 and 2.1 level A and AA rules inside the app root only (`tests/e2e/a11y.spec.ts`).

| Check | Test |
|---|---|
| No axe violation on each of the four tabs | `tests/e2e/a11y.spec.ts` AX-1 |
| No axe violation in selected states: bot, Specter, Work item and every Arena token | AX-2 |
| No axe violation on the avatar picker | AX-3 |
| With forced colors on, a keyboard-focused tab, button, link and search box each show an outline | AX-4 |
| With reduced motion requested, Roster, Specters and Arena run no animation | AX-5 |
| One keyboard-only pass reaches all four tabs and moves focus into each panel | AX-6 |
| Keyboard-only roster journey | `tests/e2e/roster.spec.ts`: `a keyboard-only user can find a bot, select it, watch it and switch views` |
| Keyboard-only journey to the detail tabs; reduced motion | `tests/e2e/monitoring.spec.ts`: `a keyboard-only journey reaches the detail tabs`, `with reduced motion requested, nothing animates` |
| Keyboard-only change of avatar and land on the hero heading; reduced motion | `tests/e2e/specters.spec.ts`: `a keyboard-only journey changes the avatar and lands on the hero heading`, `with reduced motion requested, nothing animates, even for a working bot with a Specter` |
| Keyboard-only Work journey; reduced motion; 320 px width | `tests/e2e/work.spec.ts`: E-1, E-10, E-11 |
| Arena is reached by keyboard; keyboard-only inspect and handoff; reduced motion; a defeat is a static label | `tests/e2e/arena.spec.ts`: A-1, A-8, A-6, A-5, A-10b |

## 2. Manual, on the installed app

Fill in the last four columns during OA-5. Leave a cell blank if the check was not run.

| # | Check | Who | Environment (OS, browser, screen reader) | Result | Date |
|---|---|---|---|---|---|
| 1 | Keyboard only, in the installed app: Tab to the section tabs, Arrow, Home and End across Roster, Specters, Work and Arena. Tab into each panel. Enter or Space on a row, a Work item, a scene token and "Open Bots in Crew" | | | | |
| 2 | A focus ring is visible on every control, including with Windows High Contrast or macOS Increase Contrast. Note the OS and browser | | | | |
| 3 | With the OS "reduce motion" setting on, nothing moves in all four tabs, and the arena defeat is a static label | | | | |
| 4 | Screen reader (name it): tab names, a bot row, a Work item state change announcement (`role="status"`), an Arena token and the hero note on the Specter card. An Arena token's name reads title, state, progress, then kind, with the kind last. Confirm by ear | | | | |
| 5 | At 200 percent zoom and in a 320 px wide window there is no horizontal scroll beyond the roster (matches `tests/e2e/work.spec.ts` E-11) | | | | |
| 6 | Colour contrast on the real host theme for the link, the tabs and the token labels | | | | |
| 7 | The `arena-perf-1` numbers are copied from the performance record, naming profile, machine, Node, Playwright, Chromium and commit | | | | |

Item 7 depends on the performance record, which is written after the OA-5 build (`docs/release/performance.md`, added in the commit that records the result). Until it exists, item 7 stays blank.
