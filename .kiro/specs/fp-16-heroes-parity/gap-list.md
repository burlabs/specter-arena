# FP-16 gap list: Figma Make export against the FIXTURE preview

Method: the export ran with `npm run dev` in a copy of `specters-of-the-abyss-figma`; the FIXTURE preview was built with `npm run build:preview` and opened at `?scenario=arena` in Chromium 158.0.8127.18 through Playwright at 1440 x 900 and 390 x 844, once per tab. Crops of each image were opened under 2,000 px per side. Screenshots are evidence files kept with the planning session, not tracked baselines (`research/screenshots/export-*.png`, `research/screenshots/after/app-*.png`).

CLOSED = ported with a test. PARTIAL = part ported, the rest named. OUT = not ported, with the reason. DEFERRED = wanted, needs a decision or a contract change.

| # | Gap | Status | PR and evidence |
|---|---|---|---|
| G1 | Map and minimap paint nothing above 2 MiB in a CSS variable | CLOSED | PR-B #149; `A-14` red on `f586a025`, green on the head |
| G2 | 512 px hero sprites with anchors in the arena | CLOSED | PR-B; `A-15`, `heroes.test.ts` |
| G3 | Specters at lane positions on the map | OUT | The app has no position data and heroes imply no lane |
| G4 | Minimap overlaid inside the map frame | CLOSED | PR-C; `A-17`. Placed top left, not bottom right as in the export: at bottom right it hid the Shard and Poly tokens in the default scenario (crop before and after in the PR-C report) |
| G5 | Frame letterboxes the map | CLOSED | PR-C; `aspect-ratio: 1672 / 941`, `max-height: 70vh`; `A-17` checks the ratio |
| G6 | Idle motion on tokens | CLOSED (idle) | PR-B; `A-16`. Attack and cast: OUT, they need combat events the app cannot observe |
| G7 | Structures | CLOSED | PR-B; three minimap markers, `svgAndBadge.test.tsx`. The export draws none on the Arena |
| G8 | Arena stat cards | CLOSED (three cards) | PR-C; `ArenaStats.test.tsx`, `ArenaView.test.tsx`. Replay button: OUT, replay is cut |
| G9 | Rail cards: thumbnail, level, XP bar | CLOSED | PR-B thumbnail, PR-C progression; `railMinimapList.test.tsx`. Position tag: OUT (G3) |
| G10 | Export inspector | OUT | The app inspector already carries evidence, handoff and copy summary against the real contracts |
| G11 | Pause motion in the top bar | OUT | Exists as the HUD button; the top bar is host chrome |
| G12 | Arena page overflows to 506 px at 390 px | CLOSED | PR-C; `A-18`: `scrollWidth` 390 on all four tabs (506 before). The cause was the two list tables, not the header actions: hiding `.sa-arena-list` took the page from 506 to 390. The header actions also wrap now |
| G13 | Encounter legend | OUT | "What the states mean" is already on the page |
| G14 | Battlefield team panel with five positions | PARTIAL | PR-C: read-only "Bots on the field" list (`BotsOnField.test.tsx` scans for position words). Position assignment: OUT |
| G15 | Specters collection cards | CLOSED | PR-A hero card and picker, PR-C card grid with thumbnail, epithet and progression; FP-17 PR-B (#155) search, filter, sort and unassigned heroes: `collection.test.ts`, `SpectersCollection.test.tsx`, `tests/e2e/specters.spec.ts` FP17-E1 to FP17-E7, `AX-7` |
| G16 | Customize Specter / summoning page | OUT | Summoning removed (PA-2) |
| G17 | Progression block on cards | CLOSED | PR-C; `SpecterProgression.test.tsx` equals `XpMeter` |
| G18 | Observatory dashboard | PARTIAL | PR-B thumbnails in rows, PR-C summary of three counts. Attention list and table: OUT, they are fixture-model views |
| G19 | Roster search and filter | OUT | Exists in another form |
| G20 | Campaigns | OUT | Campaign orchestration is cut (FP-13) |
| G21 | Campaign KPI row | OUT | Per-bot XP cards exist |
| G22 | Work review panel | OUT | Ported in FP-08+09 |
| G23 | Host chrome, settings, dev galleries | OUT | Provided by Crew |
| G24 | 96 px thumbnails in small icons | CLOSED | PR-B; `SpecterPortrait.test.tsx`. At 390 px the roster row hides its portrait (pre-existing rule at 520 px) |
| G25 | `marker-awaiting-approval` | OUT | The state is unobservable |
