# FP-17 requirements: Specters collection

One session, one design, two PRs. PR-A (#156) adds `heroes.v1` and `GET /api/heroes`. PR-B (this folder) adds search, filter and sort to the Specters tab and shows the heroes no bot holds as non-interactive cards. View state is local to the tab. Nothing in this feature writes.

## Requirements

| Id | Requirement | Acceptance check |
|---|---|---|
| FP17-REQ-01 | Search is a trimmed, case-insensitive substring match over bot name, hero name, display name and epithet; hero personality is never searched | `ui/src/specters/collection.test.ts`; `tests/e2e/specters.spec.ts` FP17-E1 |
| FP17-REQ-02 | Filter offers All, Assigned, Unassigned and Avatar changed; Unassigned shows only hero cards, Assigned and Avatar changed show only bot cards | `ui/src/specters/collection.test.ts`; FP17-E2 |
| FP17-REQ-03 | Sort offers Roster order, Name, Level and XP; Level and XP rank high to low with hero cards last, a bot with no XP entry counts as level 1, and roster order holds while XP loads | `ui/src/specters/collection.test.ts`; FP17-E3 |
| FP17-REQ-04 | A hero that no bot holds renders as a non-interactive card reading "No bot yet", at its roster index; hero text from the backend is rendered as text | `ui/src/specters/SpectersCollection.test.tsx`; `ui/src/specters/useHeroes.test.tsx` |
| FP17-REQ-05 | Search, filter and sort change view state only: no write request, no change to a binding, hero or XP | FP17-E1, FP17-E2 (no non-GET `/api/` request) |
| FP17-REQ-06 | Controls are native, labelled and placed before the cards; the result count is a polite live region; Clear restores the list and focuses the search box; arrow keys, Home and End move over the visible bot cards only | `ui/src/specters/SpectersCollection.test.tsx`; FP17-E4; `AX-7` in `tests/e2e/a11y.spec.ts` |
| FP17-REQ-07 | The controls add no animation or transition; with reduced motion requested, using every control starts no animation | FP17-E6; `ui/src/specters/css.test.ts` |
| FP17-REQ-08 | New CSS is scoped to `.specter-arena-root`, uses no `!important`, no font below 12 px, and loads nothing from a remote URL; the page does not scroll sideways at 390 px | `ui/src/specters/css.test.ts`; FP17-E7 |
| FP17-REQ-09 | The XP bar is computed once (`xpBarOf`); the compact bar inside a button is decorative, has no `role="progressbar"` and holds no block element | `ui/src/specters/xpBar.test.ts`; `ui/src/specters/SpecterProgression.test.tsx`; `ui/src/arena/railMinimapList.test.tsx` |
| FP17-REQ-10 | A heroes failure never hides bot cards: loading, failure and 404 show one line (Retry except for 404) only under All or Unassigned | `ui/src/specters/SpectersCollection.test.tsx` |
| FP17-DEL-01 | Six FIXTURE screenshots (search, Unassigned, Sort XP at 1440x900 and 390x844) are captured on the PR head and each opened as a crop under 2,000 px | `implementation/pr-b-report.md` in the planning session |
| FP17-DEL-02 | Gap-list G15 is CLOSED with the PR and test names | `.kiro/specs/fp-16-heroes-parity/gap-list.md` |
| FP17-DEL-03 | `heroes` v1 is FROZEN in `contracts/OWNERS.md` | `npm run check:schema` |
| FP17-DEL-04 | The UI bundle is re-measured against the 305,000 character cap | `ui/src/build-output.test.ts` |
