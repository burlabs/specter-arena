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
