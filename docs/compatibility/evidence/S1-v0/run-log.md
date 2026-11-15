# S1-v0: slice-1 phase v0 on Crew 0.12.2 (main 062f3b6)

Run `20261115T205118Z-a923f2`, exported 2026-11-15T21:02:48Z, window 30 s. Staged app `0.0.0-probe.2`, phase v0: the app's own api entry only, no events. Cells are APP-TOKEN. Frames seen: 23 (18 `dashboard`, 5 `slots`).

Owner steps (OWNER-SESSION, Eric): staged with `npm run probe:stage -- --phase v0 --host-version 0.12.2 --capture-seconds 30`, installed with `kirocrew app install .probe-app`, enabled the app on its detail page, saved the probe slug and clicked "Run probe steps" once. The bot was not prompted.

Decided here and used in the matrix where S1-v1 did not decide them: `user-slots-no-grant-denied` (DENIED: the first `slots` frame held 0 user rows without the grant), `other-app-api-denied`, `bot-key-results-read`, `bot-notes-memory-private` (DENIED: 403 scope refusal). Under the broad grant in S1-v1 those three routes answered 404 or 405, which is not a decisive refusal.
