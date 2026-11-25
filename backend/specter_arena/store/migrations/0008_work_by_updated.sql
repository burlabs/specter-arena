-- 0008 work list by last update (FP-18): the update-ordered work list (`GET /api/work?view=list
-- &order=updated`) reads the newest-updated items first. Without these indexes SQLite scans the
-- whole `work_item` table and sorts it (a temp B-tree) on every page, and the arena reads five
-- state-filtered streams on every poll. Both indexes are plain B-trees over columns that already
-- exist: nothing is added, changed or dropped, no row is rewritten, and a work item still changes
-- only through the guarded update that bumps `updated_ms`.
--   work_item_by_updated        (updated_ms, work_id)         no state filter
--   work_item_by_state_updated  (state, updated_ms, work_id)  one state, the arena's streams
CREATE INDEX work_item_by_updated ON work_item (updated_ms, work_id);

CREATE INDEX work_item_by_state_updated ON work_item (state, updated_ms, work_id);
