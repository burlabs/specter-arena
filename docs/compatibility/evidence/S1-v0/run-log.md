# S1-v0: slice-1 phase v0 on Crew 0.12.2 (main 062f3b6)

Run `20261115T205118Z-a923f2`, exported 2026-11-15T21:02:48Z, window 30 s. Staged app `0.0.0-probe.2`, phase v0: the app's own api entry only, no events. Cells are APP-TOKEN. Frames seen: 23 (18 `dashboard`, 5 `slots`).

Owner steps (OWNER-SESSION, Eric): staged with `npm run probe:stage -- --phase v0 --host-version 0.12.2 --capture-seconds 30`, installed with `kirocrew app install .probe-app`, enabled the app on its detail page, saved the probe slug and clicked "Run probe steps" once. The bot was not prompted.

The matrix cites this run for eight DENIED cells:
- `user-slots-no-grant-denied`: the first `slots` frame held 0 user rows without the grant.
- `other-app-api-denied`, `bot-list-members-denied`, `bot-activity-read`, `bot-goals-read`, `bot-ledger-read`, `bot-key-results-read` and `bot-notes-memory-private`: 403 `code="forbidden"`, "app token not permitted for this endpoint" (the token scope refusal).

Under the broad grant in S1-v1 the same routes answered 404 or 405. Those answers come from past the scope gate, so they do not show that an app is refused.
