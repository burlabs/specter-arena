# FP-18 design: Work and XP read correctness

The full design lives with the planning session and is summarised here. The work list gains a second shape, selected by a query parameter on the existing route, so no new path, grant or route ordering is involved. The store reads the list in one item query that carries the milestone, child and `everAccepted` counts as scalar subqueries, then one query for the page's attempts and one for the page's XP net. It never reads `work_decision` rows or the evidence. XP summaries gain a keyset page over the same grouping.

## Shape of the work

| Component | PR-A | PR-B |
|---|---|---|
| work-ledger | `list_work_view`, `xp_summaries_page`, migration 0008, three DRAFT schemas | none |
| crew-integration | `view` and `order` on `GET /api/work`, `view` on `GET /api/xp`, wire builders | fixture bodies for both views |
| experience | TypeScript types only | arena and Work tab read the list view, XP page walk, `everAccepted` |
| delivery | spec ids, schema and migration counts, OWNERS rows (DRAFT), this folder | `performance.md` numbers, OWNERS rows FROZEN |

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Route shape | `?view=list` on `GET /api/work`; `?view=paged` on `GET /api/xp` | The v1 body stays byte for byte; no new proxy path; the signature already covers the query |
| Projection fields | List fields plus `everAccepted`; shared fields are `$ref`s into `work-item.v1` | Cannot drift from the frozen item; nothing a detail view needs is sent |
| Cursor | Three values `[order tag, key ms, workId]`, tag `c` or `u` | A cursor for one order cannot be used for the other; a v1 cursor has two values, so it is refused by arity |
| Keyset | Row-value `(key, workId) < (:ms, :id)`, first page bound `2**53` | SQLite turns it into an index range seek; an OR chain does a full scan and a sort |
| Filters | One fixed SQL string per (order, has state, has binding), built at import | `state = ?` is plain equality, so the state index applies; no request text enters SQL |
| `everAccepted` | `EXISTS` over `work_decision` with action `accept` | The decision log is the only record that an accept happened; state alone cannot tell an accepted-then-reopened item from a never-accepted one |
| Indexes | `(updated_ms, work_id)` and `(state, updated_ms, work_id)` in migration 0008 | At 20,000 items `state=open` falls from 9.0 ms to 0.09 ms; both are index-only, no row changes |
| Error codes | `invalid_view`, `invalid_order` | Existing codes are one per parameter (`invalid_state`, `invalid_limit`, `invalid_cursor`) |
| `order` without `view=list` | 400 `invalid_order` | A client that sends it must not believe it got an order it did not get |
| XP page size | 200, the `paging.MAX_LIMIT` | The store's shared page ceiling |
