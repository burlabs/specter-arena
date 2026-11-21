# FP-20 owner sitting runbook (Crew 0.13.0, probe phase v3)

Total time: at most 30 minutes. Eric performs every owner step. Agents never install, enable, disable or uninstall the app, never restart the gateway, and never read tokens.

Preconditions:

- `kirocrew --version` prints 0.13.0.
- One probe bot whose agent mounts the `kirocrew-core` server, so it has a `spawn_run` tool. Which bot templates include it is not established from source; check the bot's tool list first.
- The crew log is switched on (restart attribution and subagent replay need it). Say so in the notes.
- No other bot is used during the sitting.

## Steps

1. (2 min) In the clone run `npm run build`, `npm run build:diagnostic`, then `npm run probe:stage -- --phase v3 --host-version 0.13.0 --capture-seconds 600 --reconnect-after-start 90 --extra-steps usage-turns`. Run `kirocrew app install .probe-app` yourself. On `/apps/detail/specter-arena` approve the six api entries and two events. The grants expose metadata of every user-origin chat to the probe app.
2. (2 min) Open `/apps/specter-arena`, enter the probe bot slug, save the config, click "Run probe steps". The quick steps run first, then the 10-minute capture starts.
3. (4 min) Approval: ask the probe bot to run a shell command that needs approval. Leave the card open 20 seconds, click Allow. Ask again, click Deny. Proves `user-signal-approval`, `user-signal-approval-resolved`, `user-signal-blocked-distinct`.
4. (3 min) Question card: ask the bot to offer two options and wait for your answer. Answer it.
5. (4 min) Subagent: ask the bot to call `spawn_run` with the task "reply with the word ready". Then ask for a second `spawn_run` whose task takes about two minutes. If the bot has no `spawn_run`, write that down and skip to step 6; the subagent cells stay UNTESTED with that reason.
6. (5 min) Restart: while the two-minute subagent runs, restart the gateway yourself (FD-21: your decision at run time). Wait for the probe page to show the reconnect. Ask the bot one more question.
7. (3 min) Press Export on the probe page. Copy the app's `.probe-out/` folder to `docs/compatibility/evidence/FP20-v3/` in the clone before any reinstall. Paste no token and no file contents into chat.
8. (3 min, optional) Member-record render: bind a bot-dashboard page to `custom.latest.specter_arena__probe_ping.data.source` and confirm it shows `specter-probe`. Report yes or no.
9. (2 min) Uninstall the probe app from the App Store detail page.

## Stop rules

- Stop if the install screen lists a grant that is not in the overlay.
- Stop if the host version is not 0.13.0.

## After the sitting

Import the export under `docs/compatibility/evidence/FP20-v3/`, add `docs/compatibility/crew-0.13.0.md`, update the matrix, then send Eric one batched message listing each candidate grant with evidence and a recommendation.
