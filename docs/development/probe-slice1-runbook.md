# FP-02+03 slice-1 probe: owner runbook

This is Eric's hands-on sitting for the FP-02+03 Pass 1 probe (D-P4). It takes 30 to 45 minutes. Every step here is an owner step: agents cannot install apps or open the dashboard, so nobody else can run it.

Results the backend collects carry the APP-TOKEN label. What you do or see in the Crew UI is OWNER-SESSION evidence. Do not paste secrets anywhere; the probe never records token values.

You install from the C-1 stack's top branch, `fp0203/46-c1d-overlay-runbook`, before the stack merges. If the sitting finds a probe defect, the fix is pushed to the stack and you re-stage from the same branch.

Timebox: one working day from the moment you install (RS-6). Anything still unanswered then is committed as UNTESTED with a reason. That is an acceptable outcome.

Rules for the sitting:

- Do not restart the Crew gateway or the app backend between windows. Cells accumulate inside one running backend, and a restart loses them. The optional gateway restart (step 15) comes last, and only if you decide to do it.
- Prompt only the throwaway bot `specter-probe-bot`. Do not prompt any other bot.
- During the closed-tab interval (step 12), do not touch the arena tab.

## Before you start (about 10 minutes)

1. Remove what FP-01 left behind, if it is still installed:
   - Uninstall the FP-01 probe app. Use `kirocrew app uninstall specter-arena` if your install has that command; otherwise remove "Specter Diagnostic" in the App Store Library.
   - Delete the FP-01 bot `specter-probe-bot` if it still exists, so this sitting starts from a fresh bot.
2. Record the Crew version. In a terminal run:

   ```
   kirocrew --version
   ```

   The plan expects `0.12.2`. If it prints anything else, use the printed value everywhere `X.Y.Z` appears below and tell the planner, because the evidence will then be for a different host.
3. In your clone, switch to the stack's top branch and build both bundles:

   ```
   git fetch origin
   git switch fp0203/46-c1d-overlay-runbook
   git pull
   npm ci
   npm run build
   npm run build:diagnostic
   ```

4. Stage phase v0, which grants nothing beyond the app's own api entry. Replace `X.Y.Z` with the version from step 2:

   ```
   npm run probe:stage -- --phase v0 --host-version X.Y.Z --capture-seconds 30
   ```

   The script prints `install it yourself with: kirocrew app install .probe-app`.
5. Install it yourself:

   ```
   kirocrew app install .probe-app
   ```

   Open Crew's App Store Library, find "Specter Diagnostic" and grant per-app trust when asked. Third-party apps need it, and the CLI cannot enable it.
6. Create the throwaway bot in Crew with the name `specter-probe-bot`. Its slug must be `specter-probe-bot`. Open its chat once so its DM slot exists.
7. Open the arena page at `/apps/specter-arena` (sidebar label "Specter Diagnostic"). Type `specter-probe-bot` in "Probe bot slug" and click "Save probe config".

## Phase v0 (about 3 minutes): decides `user-slots-no-grant-denied`

8. Click "Run probe steps" once. Wait 60 seconds, then click "Refresh snapshot". Check that the page shows a snapshot and no load error. That is all for v0; do not prompt the bot.

## Phase v1, the D-P1 grants (about 5 minutes of setup)

9. Stage phase v1 with the long window and the deliberate reconnect, then reinstall. The page's Run button sends an empty request, so these options come from the staged `.probe-run.json`:

   ```
   npm run probe:stage -- --phase v1 --host-version X.Y.Z --capture-seconds 900 --reconnect-after-start 5
   kirocrew app install .probe-app
   ```

   The updated app asks for new permissions: events `slots:user` and `subagent:user`; api `/api/agents`, `/api/usage` and `/api/sessions/usage`. They stay denied until you approve them in Crew. In your log, note whether Crew showed a consent screen and whether the page worked before you approved. Then approve them.
10. Reopen `/apps/specter-arena`, type `specter-probe-bot` and click "Save probe config". Check in the bot's chat that no turn is running.

## Window 1 (about 15 minutes): lifecycle, approval, rename, reconnect, usage

11. Click "Run probe steps". The quick steps (token, agents, usage endpoints) finish in under a minute, then the 15-minute capture starts. Wait 60 seconds. Then send these messages to the probe bot one at a time, waiting for each reply to finish:
    - **A (lifecycle, tool call, longer than 30 s):** `Probe test A. Run the shell command "sleep 45 && echo done" and then reply with the single word finished.`
      About 5 seconds after the turn starts, the backend drops and reopens its WebSocket (D-P3). You do nothing for this.
    - **D (approval):** `Probe test D. Create a file named probe-d.txt in your workspace containing the word ok.`
      If Crew asks you to approve a tool, leave it pending for at least 10 seconds, then approve. If it never asks, write "no approval prompt shown" in your log.
    - **E (rename):** in Crew, change the bot's display name (not the slug) to `Probe Bot Renamed`. Wait 40 seconds, then change it back.

    After E, wait until about 15 minutes have passed since you clicked Run, click "Refresh snapshot" and leave the page open.

## Window 2 (about 15 minutes): workers and the closed tab

12. Click "Run probe steps" again. This starts a new 15-minute window, and the results from window 1 are kept. Wait 60 seconds, then send:
    - **B (session-create worker):** `Probe test B. Use your work ledger to create one item titled probe-b and dispatch a worker session to handle it. The worker should only run "echo b" and report back.`
    - **C (spawn_run subagent):** `Probe test C. Use spawn_run to start one subagent whose task is to run "echo c". Wait for it, then reply done.`
    - **F (closed tab):** `Probe test F. Run the shell command "sleep 120 && echo f" and then reply with the single word finished.`
      Immediately after sending F, **close the arena tab** (only that tab; keep Crew open) and note the clock time. Touch nothing in the arena for 4 minutes. Then reopen `/apps/specter-arena`, click "Refresh snapshot" and note the reopen time.

    If B or C shows no worker at all, re-prompt once with a more explicit instruction before you conclude; a bot that never dispatched is "not exercised", not a failure.

## After both windows (about 5 minutes)

13. Collect the files the backend wrote. Crew chooses the install location, so search for it:

    ```
    find ~/.kiro/crew -maxdepth 5 -name ".probe-out" -type d 2>/dev/null
    ```

    Each `.probe-out/<runId>/` folder holds `export.json`, `event-capture.json` and `frames.jsonl`. Copy the newest run's folder into your clone at `docs/compatibility/evidence/<runId>/` and **do not commit it**; an agent assembles the evidence PR (C-3). Before anything is committed, open the files and check for real names or titles of other bots and users. They should hold digests only.
14. Fill in the log below and give it to the planner.
15. Optional, only if you decide now: restart the gateway (FD-21). Skip it unless you want `bot-attribution-survives-restart` and `gateway-restart-reconnect` decided. If you do it, restart the gateway yourself, wait for the page to reload, click "Run probe steps" again, and note the time.
16. Clean up. Uninstall the probe app (`kirocrew app uninstall specter-arena` if the command exists; otherwise in the App Store Library), and delete `specter-probe-bot`. Say in your log what you removed.

## Owner log (OWNER-SESSION)

```
Crew version (kirocrew --version):
FP-01 probe app and bot removed before the sitting (yes/no, which):
Consent screen on the v1 update (yes/no); page worked before approval (yes/no):
A completed (yes/no):
D completed (yes/no); approval prompt shown (yes/no):
E rename done and reverted (yes/no):
B completed (yes/no); worker visible in Crew (yes/no):
C completed (yes/no); subagent visible in Crew (yes/no):
F completed (yes/no); tab closed at (time):           reopened at (time):
Gateway restart done (yes/no, time):
Anything that looked wrong on screen:
Probe app uninstalled (yes/no); specter-probe-bot deleted (yes/no):
```

## Reading the result: the stop triggers

The planner reads `export.json` and evaluates each row. The planner reports what fired; scope decisions stay with Eric.

| Check | Evidence | Passes when |
|---|---|---|
| S1 lifecycle | `user-signal-start`, `user-signal-progress`, `user-signal-terminal` ALLOWED (APP-TOKEN) for the bot DM slot after A | at least one lifecycle signal of any kind was observed for the bot-rooted slot across a completed bot turn |
| Mechanism 1: session-create worker (B) | `bot-worker-session-attribution` ALLOWED | a worker slot row whose `created_by` chain reaches `member-specter-probe-bot` was observed |
| Mechanism 2: `spawn_run` subagent (C) | `bot-worker-session-attribution-subagent` and `subagent-events-visible` ALLOWED | a `subagent_*` frame whose `slot` is the probe bot's DM key was observed |

- **S1 fires** when no lifecycle signal of any kind was seen. Pass 2 stops, and the scope decision goes to Eric. There is no fixture, private-store or broad-token fallback.
- **S2 fires** only when neither mechanism is observed and attributable (FD2-G3). If exactly one passes, the failing one goes to Eric at once as a coverage limit, and Pass 2 may continue on the passing mechanism.
