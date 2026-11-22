-- 0010 automatic tasks and task XP (FP-22, PA-3): a task is one observed attempt of one bot (a
-- worker it started, or its own turn that ran 60 s or longer), closed out by the backend with no
-- human click, and `task_xp_entry` is the append-only ledger of the single award a cleanly
-- ended task earns under `xp-policy-2`. 0006 (`work_item`, `xp_entry`, `xp-policy-1`) is not
-- changed: its rows stay as history and both ledgers are summed at read time.
--
-- There is deliberately no foreign key to `attempt`: `rebuild_projection` empties and refills it
-- and a purge deletes ended attempts. The task id is a hash of the attempt id, so a rebuild keeps
-- every task, and the row keeps its own snapshot of the evidence (times, end signal, the
-- close-out findings), so a purge of observations never changes a closed task or its XP.
--
-- A task is inserted `open`. Afterwards only these columns move: `running`, `ended_ms`,
-- `end_signal`, `state`, `close_reason`, `closed_ms`, the two findings and `updated_ms`.
-- `credited` is final: its state, reason and close time never change again. A `not-credited`
-- task whose worker runs again reopens and is judged again at its next end. An award exists
-- only for an `open`, ended task, goes to the task's own bot, is capped at 30 and equals
-- min(30, 10 + run_ms / 120000); a task becomes `credited` only when its award exists.
CREATE TABLE task (
  task_id        TEXT NOT NULL PRIMARY KEY CHECK (
    length(task_id) = 28 AND task_id GLOB 'tsk_*' AND substr(task_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  attempt_id     TEXT NOT NULL UNIQUE CHECK (
    length(attempt_id) = 28 AND attempt_id GLOB 'att_*' AND substr(attempt_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  binding_id     TEXT NOT NULL REFERENCES bot_binding (binding_id),
  kind           TEXT NOT NULL CHECK (kind IN ('bot-turn', 'worker')),
  started_ms     INTEGER NOT NULL CHECK (started_ms >= 0),
  ended_ms       INTEGER CHECK (ended_ms IS NULL OR ended_ms >= started_ms),
  running        INTEGER NOT NULL CHECK (running IN (0, 1)),
  end_signal     TEXT CHECK (end_signal IS NULL OR length(end_signal) <= 24),
  state          TEXT NOT NULL CHECK (state IN ('open', 'credited', 'not-credited')),
  close_reason   TEXT CHECK (
    close_reason IS NULL
    OR close_reason IN ('clean-end', 'unknown-terminal', 'coverage-gap', 'waiting-at-end')
  ),
  closed_ms      INTEGER CHECK (closed_ms IS NULL OR closed_ms >= 0),
  waiting_at_end INTEGER CHECK (waiting_at_end IS NULL OR waiting_at_end IN (0, 1)),
  gap_overlap    INTEGER CHECK (gap_overlap IS NULL OR gap_overlap IN (0, 1)),
  created_ms     INTEGER NOT NULL CHECK (created_ms >= 0),
  updated_ms     INTEGER NOT NULL CHECK (updated_ms >= created_ms),
  CHECK ((running = 1) = (ended_ms IS NULL)),
  CHECK (
    (state = 'open' AND close_reason IS NULL AND closed_ms IS NULL)
    OR (state = 'credited' AND close_reason = 'clean-end' AND closed_ms IS NOT NULL)
    OR (
      state = 'not-credited'
      AND close_reason IN ('unknown-terminal', 'coverage-gap', 'waiting-at-end')
      AND closed_ms IS NOT NULL
    )
  )
) STRICT;

CREATE INDEX task_by_updated ON task (updated_ms, task_id);

CREATE INDEX task_by_state ON task (state, updated_ms, task_id);

CREATE INDEX task_by_binding ON task (binding_id, updated_ms, task_id);

CREATE TABLE task_xp_entry (
  entry_id       TEXT NOT NULL PRIMARY KEY CHECK (
    length(entry_id) = 28 AND entry_id GLOB 'txe_*' AND substr(entry_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  task_id        TEXT NOT NULL UNIQUE REFERENCES task (task_id),
  binding_id     TEXT NOT NULL REFERENCES bot_binding (binding_id),
  amount         INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 30),
  policy_version TEXT NOT NULL CHECK (policy_version = 'xp-policy-2'),
  created_ms     INTEGER NOT NULL CHECK (created_ms >= 0)
) STRICT;

CREATE INDEX task_xp_entry_by_binding ON task_xp_entry (binding_id, created_ms, entry_id);

-- task: created open, immutable identity, `credited` is final, legal state moves only.
CREATE TRIGGER task_new BEFORE INSERT ON task
WHEN NEW.state <> 'open' OR NEW.updated_ms <> NEW.created_ms
BEGIN SELECT RAISE(ABORT, 'task must start open'); END;

CREATE TRIGGER task_guard BEFORE UPDATE ON task
WHEN NEW.task_id <> OLD.task_id OR NEW.attempt_id <> OLD.attempt_id
  OR NEW.binding_id <> OLD.binding_id OR NEW.kind <> OLD.kind
  OR NEW.started_ms <> OLD.started_ms OR NEW.created_ms <> OLD.created_ms
  OR NEW.updated_ms < OLD.updated_ms
BEGIN SELECT RAISE(ABORT, 'illegal task update'); END;

CREATE TRIGGER task_credited_final BEFORE UPDATE ON task
WHEN OLD.state = 'credited'
  AND (NEW.state <> 'credited' OR NEW.close_reason IS NOT OLD.close_reason
    OR NEW.closed_ms IS NOT OLD.closed_ms OR NEW.waiting_at_end IS NOT OLD.waiting_at_end
    OR NEW.gap_overlap IS NOT OLD.gap_overlap)
BEGIN SELECT RAISE(ABORT, 'a credited task is final'); END;

CREATE TRIGGER task_state BEFORE UPDATE ON task
WHEN NEW.state <> OLD.state AND NOT (
  (OLD.state = 'open' AND NEW.state IN ('credited', 'not-credited'))
  OR (OLD.state = 'not-credited' AND NEW.state = 'open')
)
BEGIN SELECT RAISE(ABORT, 'illegal task state change'); END;

CREATE TRIGGER task_credit BEFORE UPDATE ON task
WHEN NEW.state = 'credited' AND OLD.state <> 'credited' AND NOT EXISTS (
  SELECT 1 FROM task_xp_entry WHERE task_id = NEW.task_id AND binding_id = NEW.binding_id
)
BEGIN SELECT RAISE(ABORT, 'a task is credited only with its award'); END;

CREATE TRIGGER task_keep BEFORE DELETE ON task
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

-- task_xp_entry: one award per task, to the task's own bot, for an ended open task, at the
-- policy amount; never changed or removed.
CREATE TRIGGER task_xp_entry_task BEFORE INSERT ON task_xp_entry
WHEN NOT EXISTS (
  SELECT 1 FROM task
  WHERE task_id = NEW.task_id AND binding_id = NEW.binding_id
    AND state = 'open' AND running = 0 AND ended_ms IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'award needs an ended open task of the same bot'); END;

CREATE TRIGGER task_xp_entry_amount BEFORE INSERT ON task_xp_entry
WHEN NEW.amount <> COALESCE((
  SELECT min(30, 10 + (ended_ms - started_ms) / 120000) FROM task WHERE task_id = NEW.task_id
), -1)
BEGIN SELECT RAISE(ABORT, 'award is not the policy amount'); END;

CREATE TRIGGER task_xp_entry_immutable BEFORE UPDATE ON task_xp_entry
BEGIN SELECT RAISE(ABORT, 'append-only'); END;

CREATE TRIGGER task_xp_entry_keep BEFORE DELETE ON task_xp_entry
BEGIN SELECT RAISE(ABORT, 'append-only'); END;
