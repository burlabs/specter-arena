# FP-17 design: Specters collection

The full design lives with the planning session and is summarised here. The Specters tab gains local view state (query, filter, sort), polls `GET /api/heroes` through `useHeroes()` while the tab is open, and builds its cards with the pure function `buildCollection()` in `ui/src/specters/collection.ts`. Bot cards keep their markup. Heroes with `assignedCount` 0 that no listed Specter carries become `HeroCard` list items. The detail panel follows the selected bot in the full roster, so it stays open when a filter hides that bot's card.

## Shape of the work

| Component | PR-A | PR-B |
|---|---|---|
| specter-identity | `heroes.v1`, `SpecterService.list_heroes`, `GET /api/heroes` | none |
| crew-integration | fixture body for `/heroes` | none |
| experience | `HeroesV1` types | toolbar, hero card, `useHeroes`, `buildCollection`, shared XP bar |
| delivery | spec ids, OWNERS row (DRAFT) | spec folder, gap list G15 CLOSED, OWNERS row FROZEN |

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Where `useHeroes()` runs | Inside `SpectersView` | Polls only while the tab is open; `ObservatoryPage.tsx` is unchanged |
| Filtering and sorting | Pure `buildCollection(input, view)` | Table-driven tests, no React |
| Roster index of a hero | `HERO_IDS.findIndex` | Works when the hero list failed |
| A hero is assigned | `assignedCount > 0` or a listed Specter carries its `heroId` | Covers the window before the next heroes poll |
| List label | "Specter collection" | The list holds hero cards too |
| Compact XP bar | `<span aria-hidden>` inside a button | A `div` or progressbar inside a button is invalid |
| Result count | `<p aria-live="polite">`, not `role="status"` | Existing tests use `getByRole('status')` |
| View state | Not persisted | Out of scope |
