# FP-19 design: Data lifecycle and collection control

The full design lives with the planning session. The store guards stay in SQL: migration 0009 lets a DELETE through only while a `lifecycle_run` of the matching kind is `running` and the row is older than its cutoff. Code decides what is purgeable; SQL decides what can never be.

| Decision | Choice | Reason |
|---|---|---|
| Retention route | `POST /api/data/retention` | No route in this app uses PUT; PUT through the live proxy is unverified (orchestrator Q17) |
| Purge horizon | largest cutoff of a purge run that deleted a row | A purge that deleted nothing leaves history intact |
| Observation keep rule | DM-slot newest row, event, turn, turn generation, `chat_done`; opening row of running attempts; full range of linked attempts | What dedup, the collector start and `rebuild_projection` read |
| Reads | `with_purged_gap` replaces coverage before the horizon with one gap | No FROZEN shape changes |
| Backups | newest `pre-purge` and `pre-cleanup` kept; failure aborts | Purge is never the only copy-reducing step |
| Concurrency | one in-process lock plus one open run; batches of 500 | Collector writes wait for one batch |
| No VACUUM | the file does not shrink | Disclosed; VACUUM needs exclusive access |
