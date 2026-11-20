# FP-18 performance record (FP18-DEL-02)

PR-A records the store and wire numbers. PR-B adds the arena poll (`arena-perf-1`) before and after in the section at the end.

## How these numbers were taken

In process, no HTTP, on an Apple M-series Mac, SQLite from the backend's Python 3.12, the median of 15 runs, on the code at the head of PR-A. The profile is the FP-14 one: 20 bots, 100 work items, half accepted, plus 10 items carrying the 50-decision cap (block and unblock pairs). A second ledger of 2,000 items and a third of 20,000 items (400 with one attempt each, every seventh item given a real decision so update order differs from creation order) show growth, because the ledger has no purge (KL-07). Times are store time for the first page of 25 unless a row says otherwise; they are not request latency.

## Statements and bytes, 20 bots / 100 items

| | v1 `GET /api/work` | v2 `GET /api/work?view=list` |
|---|---|---|
| SQL statements for one page of 25 | 151 (6 per item and the list query) | 3 (items, the page's attempts, the page's XP net) |
| Store time, page 1 | 0.50 ms | 0.14 ms created, 0.22 ms updated |
| JSON bytes, page 1 | 24,788 | 17,138 created, 17,223 updated |
| JSON bytes, all 4 pages | 225,392 | 68,747 |

The ledger's accepted items carry 2 decisions and the 10 capped items 50, so most of the byte saving is decisions, review and the evidence revision. The v2 body still carries each item's attempts.

## Query plans and page time, update order

`EXPLAIN QUERY PLAN` for the update-ordered list, in every shape (no filter, `state`, `bindingId`, both, with a mid-ledger cursor):

- Before migration 0008: `SCAN w` and `USE TEMP B-TREE FOR ORDER BY`.
- After: `SEARCH w USING INDEX work_item_by_updated ((updated_ms,work_id)<(?,?))` with no state, and `SEARCH w USING INDEX work_item_by_state_updated (state=? AND (updated_ms,work_id)<(?,?))` with a state. No temp B-tree.

| Page time, ms | no index | `work_item_by_updated` | both indexes |
|---|---|---|---|
| 2,000 items, no filter | 0.27 | 0.11 | 0.10 |
| 2,000 items, `state=open` | 0.84 | 0.12 | 0.09 |
| 2,000 items, mid-ledger page | 0.51 | 0.09 | 0.09 |
| 20,000 items, no filter | 1.20 | 0.10 | 0.10 |
| 20,000 items, `state=open` | 9.01 | 1.17 | 0.09 |
| 20,000 items, `state=blocked` | 1.12 | 0.09 | 0.09 |
| 20,000 items, mid-ledger page | 5.40 | 0.09 | 0.10 |
| 20,000 items, `bindingId` filter | 2.46 | 2.02 | 2.04 |

The `bindingId` filter probes `work_attempt` per row and is not changed by these indexes. The v1 list (creation order, 0.38 ms at 20,000 items) is unchanged by 0008.

## XP summaries

`GET /api/xp` (v1) stops at 500 bindings. `GET /api/xp?view=paged` returned all 521 seeded bindings in pages of 200, 200 and 121 with no duplicates (`backend/tests/test_store_xp_paged.py`).

## Arena poll (PR-B)

Filled in by PR-B.
