# FP-21 Battle animations: requirements

Presentation only. Nothing here changes state, reads as damage or shows a health number. Tokens are never XP and `tokenReading` is never animated or scaled.

| ID | Requirement | Check |
|---|---|---|
| FP21-ATK-01 | A bot whose condition is `working` and that has an engaged, live enemy plays its own hero `attack` on that enemy every 2.5 to 4 s, jittered per (hero, enemy) pair from a fixed seed. A `waiting`, `settled` or `unknown` bot never attacks. | `exchangePlanner.test.ts`, `A-20`, `A-24` |
| FP21-CAST-01 | A milestone count that rose between two visible polls plays one `cast` by the first working hero engaged on that enemy, with a stronger recoil at the cast impact time. At most 3 per poll. With nobody engaged, or with every effect slot in use, the recoil plays alone. | `celebrations.test.ts`, `useArenaScene.test.tsx`, `exchangePlanner.test.ts` |
| FP21-DEF-01 | Acceptance seen live keeps the defeat animation and the committed XP, and ends any exchange on that enemy. | `useArenaExchanges.test.tsx`, `A-9` |
| FP21-TURN-01 | One exchange per enemy at a time; a second hero waits 300 ms after the first has ended. One animation per hero at a time. At most 8 hero effect layers at once. | `exchangePlanner.test.ts`, `A-13` |
| FP21-TIME-01 | One timer per mounted scene, pointing at the next change. It stops on unmount, reduced motion, a hidden tab, the user's pause and a paused collector, and a restart re-seeds from now with no catch-up. | `useArenaExchanges.test.tsx`, `A-21` to `A-23` |
| FP21-PAUSE-01 | A paused collector shows a "Collection paused" plate and plays nothing. | `A-22`, `ArenaView.test.tsx` |
| FP21-ART-01 | All 11 heroes' attack and cast layers are CSS and SVG, scoped under the app root, with `sa-fx-` classes and `sa-arena-` keyframes. No Tailwind, animation library or raster art. | `css.test.ts`, `HeroEffects.test.tsx`, `docs/provenance.md` |
| FP21-WAIT-01 | A `waiting` bot with the Crew flag `approval-pending` shows the awaiting-approval marker; the inspector gives the reason. "Blocked" is never drawn for a bot. | `BattlefieldScene.test.tsx`, `A-24` |
| FP21-XP-01 | While the XP ledger has not been read, the stat card, rail, list, inspector and token name say Loading or Unavailable, never "Level 1" or "0 XP". | `sceneModel.test.ts`, `ArenaStats.test.tsx`, `ArenaView.test.tsx` |
| FP21-PERF-01 | `arena-perf-1` with 30 working attempts: first render median at most 50 ms, poll update at most 5 ms, longest task under 50 ms; peak concurrent exchanges recorded. | `A-13`, `performance.md` |
