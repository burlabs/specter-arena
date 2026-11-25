# arena-perf-1 record (FP-16 PR-C)

Profile: 20 bot bindings, 100 on-field WorkItems (10 containers), 30 working attempts, 12 recently accepted; FIXTURE mode; Playwright Chromium against `ui/preview-dist`. Every one of the 20 bots now carries a hero, so the scene draws 20 hero sprites with idle motion and 80 enemies (100 sprite nodes). The scene art is real after PR-B (FP-10+11's 6.8 ms first render was against flat tiles).

Machine (read by the test with `sysctl -n machdep.cpu.brand_string`, `sysctl -n hw.memsize`, `sysctl -n hw.model`, `sw_vers`): Apple M5 Pro, 18 logical CPUs, 51,539,607,552 bytes RAM, model Mac17,8, macOS 26.6 (build 25G72), kernel 25.6.0.

Versions: Node v26.13.0, Playwright 1.65.0, Chromium 158.0.8127.18, measured code at commit `3660443e1e3cfa86af9a2253a9eb034eda8560c1`.

Method: `npm run build:preview`, then `npx playwright test tests/e2e/arena.spec.ts -g "A-13"`, executed twice in a row (the first execution after a build is cold). Each execution does five fresh browser contexts and page loads of `?scenario=arena-perf-1`, no fake clock. First render is the `arena:data-ready` to `arena:first-render` measure. Poll update is the `arena:update-start` to `arena:update-end` measure after a synthetic `visibilitychange`; "refresh script" is the DevTools Protocol `ScriptDuration` delta across that refresh. Longest task is the longest `longtask` entry (0 means none over 50 ms). The reduced-motion columns come from five further fresh loads after 3 s.

Second execution (warm):

| Run | First render (ms) | Poll update (ms) | Refresh script (ms) | Longest task (ms) | Sprite nodes | rAF callbacks (reduced motion) | Running animations (reduced motion) | Animated elements (reduced motion) |
|---|---|---|---|---|---|---|---|---|
| 1 | 24.1 | 2.9 | 9.9 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 2 | 8.5 | 2.8 | 9.4 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 3 | 8.6 | 2.7 | 9.7 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 4 | 8.8 | 2.9 | 10.1 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |
| 5 | 23.9 | 2.7 | 10.0 | 0.0 | 100 (20 Specters, 80 enemies) | 0 | 0 | 0 |

Summary, second execution: first render median 8.8, max 24.1 ms; poll update median 2.8, max 2.9 ms; refresh script median 9.9, max 10.1 ms; longest task 0.0 ms; sprite nodes 100.

First (cold) execution: first render 24.1, 23.8, 8.6, 44.0, 23.9 ms (median 23.9, max 44.0); poll update median 2.8, max 4.0 ms; refresh script median 10.0, max 11.2 ms; longest task 0; sprite nodes 100; reduced-motion columns all 0.

Against FP-14's record on the same machine class (first render 7.0 ms, poll update 2.6 ms, refresh script 8.4 ms, longest task 0 ms, 100 nodes): first render is higher (8.5 ms in the quiet runs, about 24 ms in the others) because 22 more images decode and the 20 hero sprites now carry idle animation; poll update and refresh script are within 0.3 and 1.5 ms. The two first-render clusters (about 8.6 and about 24 ms) appear in both executions.

Budgets: first render <= 500 ms, poll update <= 50 ms of scripting, sprite nodes <= 160, zero rAF callbacks, zero running animations and zero `.sa-is-animated` elements with reduced motion. Result: all pass.

These figures are for the FIXTURE preview on a fast machine. They say nothing about the installed Crew app, whose response times, proxy and host content-security policy are not part of this run.
