# arena-perf-1 record

Profile: 20 bot bindings, 100 on-field WorkItems (10 containers), 30 working attempts, 12 recently accepted; FIXTURE mode; Playwright Chromium against `ui/preview-dist`.

Machine (read by the test with `sysctl -n machdep.cpu.brand_string`, `sysctl -n hw.memsize`, `sysctl -n hw.model`, `sw_vers`): Apple M5 Pro, 18 logical CPUs, 51,539,607,552 bytes RAM, model Mac17,8, ProductName:  macOS; ProductVersion:  26.6; BuildVersion:  25G72, kernel 25.6.0.

Versions: Node v26.13.0, Playwright 1.65.0, Chromium 158.0.8127.18, measured code at commit `dd87cda1a9b7b2ab8724aa5b84ce6624016cbe30` (the commit before this record).

Method: `npm run build:preview`, then `npx playwright test tests/e2e/arena.spec.ts -g "A-13"`. Every run is a fresh browser context and a fresh page load of `?scenario=arena-perf-1`, five runs in all, no fake clock. First render is the `arena:data-ready` to `arena:first-render` measure (the first commit that carries the whole scene). Poll update is the `arena:update-start` to `arena:update-end` measure after a synthetic `visibilitychange` that makes all four pollers read once, so it is the combined update; "refresh script" is the Chrome DevTools Protocol `ScriptDuration` delta across that whole refresh, which also includes the fixture client building and parsing the response bodies. Longest task is the longest `longtask` entry in that window (0 means none over 50 ms). The last three columns come from five further fresh loads with reduced motion on, after 3 s: `requestAnimationFrame` callbacks counted by an init script, running animations from `document.getAnimations()`, and elements with the `sa-is-animated` class.

| Run | First render (ms) | Poll update (ms) | Refresh script (ms) | Longest task (ms) | Sprite nodes | rAF callbacks (reduced motion) | Running animations (reduced motion) | Animated elements (reduced motion) |
|---|---|---|---|---|---|---|---|---|
| 1 | 7.2 | 2.8 | 10.0 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2 | 6.8 | 2.3 | 8.4 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 3 | 6.8 | 2.4 | 8.9 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 4 | 6.8 | 2.8 | 9.5 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 5 | 6.7 | 2.8 | 9.6 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |

Summary over the five runs: first render median 6.8, max 7.2 ms; poll update median 2.8, max 2.8 ms; refresh script median 9.5, max 10.0 ms; longest task median 0.0, max 0.0 ms; sprite nodes median 100.0, max 100.0.

Budgets: first render <= 500 ms, poll update <= 50 ms of scripting, sprite nodes <= 160, zero rAF callbacks and zero running animations with reduced motion. Result on this machine: all pass. The refresh script column (about 10 ms for the whole refresh, fixture included) is also under 50 ms. CI runners assert the counts and the rAF and animation figures exactly and the two timings at three times the budget (`CI` set); only this machine's numbers are the record.

These figures are for the FIXTURE preview on a fast machine. They say nothing about the installed Crew app, whose response times and proxy are not part of this run.

## Re-run for RC-2 (2026-11-20)

Measured code: commit `5e1e16380dd448b323b9e8fa6268c875be732ae8` (`main` after FP-16 PR-C #150), which is the code of release candidate RC-2. The RC-2 commit itself changes only documentation, version strings and the version literal in `backend/tests/test_manifest.py`. Same machine and versions as above: Apple M5 Pro, 18 logical CPUs, 51,539,607,552 bytes RAM, model Mac17,8, macOS 26.6 (25G72), kernel 25.6.0, Node v26.13.0, Playwright 1.65.0, Chromium 158.0.8127.18. Same method (`npm run build:preview`, then `npx playwright test tests/e2e/arena.spec.ts -g "A-13"`), run twice back to back, so ten fresh loads in all. Medians are computed from the unrounded measurements.

| Run | First render (ms) | Poll update (ms) | Refresh script (ms) | Longest task (ms) | Sprite nodes | rAF callbacks (reduced motion) | Running animations (reduced motion) | Animated elements (reduced motion) |
|---|---|---|---|---|---|---|---|---|
| 1.1 | 34.2 | 2.1 | 7.1 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.2 | 9.4 | 2.6 | 8.3 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.3 | 26.0 | 2.1 | 6.7 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.4 | 49.7 | 2.6 | 8.2 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.5 | 9.6 | 2.3 | 7.9 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.1 | 47.1 | 2.2 | 6.9 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.2 | 47.1 | 2.5 | 8.2 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.3 | 9.4 | 2.8 | 8.7 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.4 | 46.4 | 2.2 | 7.0 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.5 | 9.5 | 2.7 | 8.5 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |

Summary over the ten loads: first render median 30.1, max 49.7 ms; poll update median 2.4, max 2.8 ms; refresh script median 8.0, max 8.7 ms; longest task 0.0 ms in every load; 100 sprite nodes in every load. First render falls into two groups, about 9.5 ms and 26 to 50 ms, with no pattern by run order; the cause was not investigated. FP-16's record (`.kiro/specs/fp-16-heroes-parity/performance.md`) saw the same split as warm and cold. All budgets pass with a wide margin. The same caveat holds: these are FIXTURE preview figures on one fast machine, not the installed app.

## Re-run for FP-18 (2026-11-20): work list projection in update order

Change under test: the arena reads `GET /api/work?view=list&order=updated` (`work-items.v2` of `work-list-item.v1`) instead of the full `work-items.v1` pages. The fixture stand-in builds the list projection from the same stored items, so the two runs differ only in what the UI parses and renders. The backend's store timings are in the backend worker's record, not here. Same machine and versions as above: Apple M5 Pro, 18 logical CPUs, 51,539,607,552 bytes RAM, model Mac17,8, macOS 26.6 (25G72), kernel 25.6.0, Node v26.13.0, Playwright 1.65.0, Chromium 158.0.8127.18. Same method (`npm run build:preview`, then `npx playwright test tests/e2e/arena.spec.ts -g "A-13"`), run twice back to back for each side, so ten fresh loads each. Medians are computed from the unrounded measurements.

Before: `main` at `16cc99ba84aeb98b99b47c2b8920b22e12c7172d` (FP-17 PR-B), no change applied.

| Run | First render (ms) | Poll update (ms) | Refresh script (ms) | Longest task (ms) | Sprite nodes | rAF callbacks (reduced motion) | Running animations (reduced motion) | Animated elements (reduced motion) |
|---|---|---|---|---|---|---|---|---|
| 1.1 | 61.0 | 2.5 | 7.7 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.2 | 51.8 | 2.8 | 8.8 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.3 | 46.8 | 2.4 | 7.8 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.4 | 9.0 | 2.7 | 8.2 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.5 | 9.3 | 2.4 | 7.6 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.1 | 9.4 | 2.4 | 7.4 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.2 | 47.5 | 2.8 | 8.2 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.3 | 46.3 | 2.2 | 6.4 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.4 | 9.2 | 2.6 | 8.4 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.5 | 9.2 | 2.8 | 8.4 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |

Summary: first render median 27.9, max 61.0 ms; poll update median 2.6, max 2.8 ms; refresh script median 8.0, max 8.8 ms; longest task max 0.0 ms; sprite nodes 100

After: the FP-18 PR-B prototype on branch `fp18/pr-b` (parent `16cc99ba84aeb98b99b47c2b8920b22e12c7172d`; the measured `ui/src` is the committed `ui/src`).

| Run | First render (ms) | Poll update (ms) | Refresh script (ms) | Longest task (ms) | Sprite nodes | rAF callbacks (reduced motion) | Running animations (reduced motion) | Animated elements (reduced motion) |
|---|---|---|---|---|---|---|---|---|
| 1.1 | 53.8 | 2.2 | 6.7 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.2 | 9.1 | 2.4 | 8.0 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.3 | 9.3 | 2.3 | 7.9 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.4 | 8.8 | 2.5 | 8.1 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 1.5 | 25.3 | 2.8 | 8.8 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.1 | 9.3 | 2.0 | 6.3 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.2 | 9.1 | 2.3 | 7.2 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.3 | 9.1 | 2.1 | 6.6 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.4 | 9.2 | 3.6 | 9.8 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2.5 | 8.9 | 2.7 | 8.3 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |

Summary: first render median 9.2, max 53.8 ms; poll update median 2.4, max 3.6 ms; refresh script median 7.9, max 9.8 ms; longest task max 0.0 ms; sprite nodes 100

Arena poll bytes, one poll on arena-perf-1 (7 requests, 112 items: 4 on-field streams over 8-page-capped reads, open takes 3 pages, plus 1 accepted page), response bodies as the fixture client returns them, measured by `ui/src/arena/pollBytes.test.tsx` (the test asserts the budget, the figures below were also read with an uncommitted counter that adds gzip):

| Poll | Requests | Items | Bytes | Gzip bytes |
|---|---|---|---|---|
| Before, v1 full items (decisions in the seeded history, at most 3 per item) | 7 | 112 | 109,406 | 9,645 |
| After, `view=list&order=updated` | 7 | 112 | 66,232 | 5,419 |
| Before, 10 open items each carrying 50 decisions of 280-character notes | 7 | 112 | 342,816 | 15,980 |
| After, the same 10 items | 7 | 112 | 66,242 | 5,434 |

The seeded fixture items carry few decisions, so the first pair understates a long-lived install: a work item at the 50-decision cap adds about 23 KB of JSON, which the list projection never carries (the after figure moves by 10 bytes, the version numbers). Reading the numbers: the first pair is a 39% byte cut on the fixture profile; the second pair shows the poll no longer grows with decision history. Neither pair says anything about the installed app, whose proxy and database are not part of this run.

All budgets pass with a wide margin on both sides (first render <= 500 ms, poll update <= 50 ms, sprite nodes <= 160, zero rAF callbacks and animations with reduced motion). The poll update and refresh script medians are within run noise of each other (2.6 vs 2.4 ms, 8.0 vs 7.9 ms): in the FIXTURE the parse and render cost was never the bottleneck, so the win FP-18 claims is bytes on the wire and the per-item queries the backend no longer runs, not browser milliseconds. First render shows the same warm/cold split as before (about 9 ms and 25 to 60 ms) and the medians (27.9 vs 9.2) differ only by how many loads fell into the cold group, so no first-render claim is made.

## Re-run for FP-21 (2026-11-21): hero attacks, travelling strikes, casts and recoils running

Change under test: the FP-21 PR-B prototype on branch `fp21/pr-b` (parent `fp21/pr-a`, which sits on `main` 5b57ca46889685803512399c859bcf1dee890b79). A-13 now also watches ten seconds with the attacks running (12 working bots, 30 working attempts), polling the page every 40 ms for the most hero effect layers and travelling strikes on screen at once and for long tasks. Same machine and versions as above (Apple M5 Pro, macOS 26.6, Node v26.13.0, Playwright 1.65.0, Chromium 158.0.8127.18). Same method (`npm run build:preview`, then `npx playwright test tests/e2e/arena.spec.ts -g "A-13"`), five fresh loads.

| Run | First render (ms) | Poll update (ms) | Refresh script (ms) | Longest task (ms) | Peak concurrent exchanges | Peak strikes | Longest task with attacks (ms) |
|---|---|---|---|---|---|---|---|
| 1 | 47.0 | 1.9 | 5.8 | 0.0 | 4 | 4 | 0.0 |
| 2 | 9.2 | 2.9 | 10.7 | 0.0 | 4 | 4 | 0.0 |
| 3 | 25.0 | 3.1 | 10.7 | 0.0 | 4 | 4 | 0.0 |
| 4 | 44.6 | 2.8 | 10.5 | 0.0 | 4 | 4 | 0.0 |
| 5 | 8.8 | 2.8 | 10.2 | 0.0 | 4 | 4 | 0.0 |

Summary: first render median 25.0 ms (the same cold and warm split as the earlier records: warm about 9 ms, cold 45 to 47 ms), poll update median 2.8 ms, longest task 0.0 ms in every window, peak concurrent exchanges 4 of the cap of 8 and one strike per exchange (each hero plays one animation at a time, and the 30 attempts belong to 12 heroes). Reduced motion: 0 rAF callbacks, 0 running animations, 0 animated elements in all five loads. UI bundle: 341,258 characters against the cap of 419,000.
