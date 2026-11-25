# L2 run log — release tree (main 0bd0707) on Crew 0.12.0

Credential: OWNER-SESSION (Eric's dashboard). Reported by Eric in chat, 2026-11-09.

| Step | Result |
|---|---|
| Install `_fp01_main_live` release tree, enable from Library | Page renders: "Specter Arena / Repository foundation stub. No product features yet." with the "Check backend connection" button. Default-export entry works (host fact `host-ui-default-export-renders`: OBSERVED). |
| Press "Check backend connection" | "Backend check failed: [app-sdk] App "specter-arena" not permitted to access /api/ping. Declared: []" — refused in the browser by the host SDK; no request reached the gateway or backend. |

Cause (read from the installed host bundle `static/dist/assets/App-BzFfIqEb.js`, read-only):
1. `HG` passes `manifest.permissions.api` (raw, here `[]`) as `allowedApiPaths`; the SDK client (`VU`) throws `AppApiPermissionError` for any path not matching that list, and adds no implicit allowance for the app's own namespace. The gateway's server-side scope check does own `/apps/<name>/...` implicitly, but the browser SDK does not.
2. The page called `/api/ping`, which from the dashboard origin is the gateway's path, not the app backend. The backend is reached through the proxy path `/apps/specter-arena/api/ping` (gateway strips `/apps/specter-arena`). Bug in `ui/src/StubShell.tsx:12` (PR #22) and the same pattern in `ui/src/diagnostic/entry.tsx`.

New host fact (proposed id `host-sdk-own-namespace-not-implicit`): OBSERVED — the browser SDK requires the app's own backend path to be declared in `permissions.api`.

Remaining L2 steps (round trip, disable/re-enable) blocked until the fix merges.

## Re-run after PR #30 (main ec3aeb7), 2026-11-10

| Step | Result |
|---|---|
| Install `_fp01_main_live` (release tree, `permissions.api: ["/apps/specter-arena/api/*"]`), enable from Library | Page renders: "Specter Arena / Repository foundation stub. No product features yet." |
| Press "Check backend connection" | "Backend reachable at 2026-11-10T00:59:29.672569+00:00." — signed `GET /api/ping` reached through `/apps/specter-arena/api/ping` and returned the backend's timestamp. |

Host facts:
- `host-roundtrip-signed`: OBSERVED (page → gateway proxy → backend; the backend only answers 200 with a valid v2 signature, so the gateway signed it).
- `host-proxy-path`: OBSERVED — `/apps/specter-arena/api/<path>` reaches backend `/api/<path>`; `backend.routes` played no part.
- `host-backend-spawn`: OBSERVED — backend started under Crew from root `requirements.txt` (incl. `websockets==17.4`) and served requests. Provisioning duration not reported.
- `host-install-validates`: OBSERVED for the release manifest with `minKiroCrewVersion: "0.12.0"` and the own-namespace permission.
- `host-disable-reenable`: pending (steps 5-6 not yet reported).

| Disable from Library, reload, press | Host shows "Enable this app from Apps to use it." — the disabled app's page does not mount at all, so no call is made. (The gateway's 403 `app_not_enabled` path is therefore not reachable from the page; it remains an app-token/proxy-level fact for the probe.) |
| Re-enable, press | "Backend reachable at 2026-11-10T01:01:21.446177+00:00." — recovers with a new timestamp. |

- `host-disable-reenable`: OBSERVED — disable removes the page (host notice), re-enable restores the page and the backend round trip.
L2 complete.

## L3 start finding (2026-11-10)
- Opening `/apps/specter-arena/diagnostic` (probe app v0 installed and enabled) redirects to the Crew home.
- Cause (host router in `static/dist/assets/App-BzFfIqEb.js`): third-party apps get exactly one route, `/apps/:name`; there is no `/apps/:name/*` route, so a second `ui.pages[]` route falls through to `*`. A per-page `entryPoint` at another route is not routable for a third-party app in 0.12.0.
- New host fact (proposed id `host-single-page-route`): OBSERVED.
- Unblock: `.probe-app/app.json` hand-edited so `ui.entry` = `diagnostic-dist/index.mjs` and the single page is `/apps/specter-arena` (probe app only; release unaffected). Permanent fix: `scripts/stage-probe-app.mjs` must do the same.
