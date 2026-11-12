# Kiro Crew 0.12.0 compatibility record

Specter Arena is probed against Kiro Crew 0.12.0 only (A4). The manifest floor `minKiroCrewVersion: "0.12.0"` is declared; newer hosts are assumed to work until a re-probe finds a break, and no newer host was probed.

## Install method

Eric installed every build himself from a local checkout with `kirocrew app install <path>` (run L1 with `installedAt` 2026-11-09T12:41:19Z), then enabled it from the dashboard App Store Library, where Crew shows a per-app trust prompt. `kirocrew app enable` from the CLI is refused while third-party execution is off. Agents cannot install apps or open the dashboard in this version. A local-path install shows `origin: "registry"`. Credential label: OWNER-SESSION. Run steps and timestamps are in `evidence/L1/run-log.md` and `evidence/L2/run-log.md`.

## Runs

| Run | Build | What it settled | Evidence |
|---|---|---|---|
| L1 | FP-00 stub, main 5c47828 | Stub crash, React version, trust gate | `evidence/L1/run-log.md` |
| L2 | Release tree, then main ec3aeb7 | Default-export render, signed round trip, disable and re-enable | `evidence/L2/run-log.md` |
| L3-v0 | Probe app, main 320d883, no grants | Deny-by-default cells | `evidence/L3-v0/run-log.md` |
| L3-v1 | Probe app with grants, before PR #34 | Superseded: three probe defects hid bot attribution | `evidence/L3-v1/` |
| L3-v1b | Probe app with grants, main c997914 | Authoritative for the grant-phase cells; run `20261111T230641Z-4f743d` | `evidence/L3-v1b/` |

## Host facts (not permissions)

Host facts describe how the host behaves. They may rest on OWNER-SESSION evidence. They never grant the app anything; permissions live in `capability-matrix.md`. Evidence refs and notes are in `host-facts.json`.

| Id | Status |
|---|---|
| `host-agent-owner-steps-refused` | OBSERVED |
| `host-backend-spawn` | OBSERVED |
| `host-consent-screen` | UNTESTED |
| `host-dev-diagnostic-only` | OBSERVED |
| `host-disable-reenable` | OBSERVED |
| `host-import-map-sdk` | OBSERVED |
| `host-install-validates` | OBSERVED |
| `host-library-not-discover` | OBSERVED |
| `host-proxy-path` | OBSERVED |
| `host-react-version` | OBSERVED |
| `host-roundtrip-signed` | OBSERVED |
| `host-sdk-own-namespace-not-implicit` | OBSERVED |
| `host-single-page-route` | OBSERVED |
| `host-third-party-trust-gate` | OBSERVED |
| `host-ui-default-export-renders` | OBSERVED |
| `host-ui-stub-failure` | OBSERVED |

What was observed:

- `host-agent-owner-steps-refused`: Agent sessions: the browser tool refuses the dashboard port; kirocrew app install from an agent shell is refused as not verifiable as the local owner.
- `host-backend-spawn`: Backend started under Crew from requirements.txt (incl. websockets) and served /api/ping.
- `host-consent-screen`: UNTESTED. No consent-screen screenshot was provided. A7 two-day timebox reached; Eric closed the run on 2026-11-12.
- `host-dev-diagnostic-only`: Staged probe app renders the diagnostic page.
- `host-disable-reenable`: Disabled: host shows "Enable this app from Apps to use it." and the page does not mount; re-enabled: backend reachable again.
- `host-import-map-sdk`: @kirocrew/app-sdk resolves and its client issues the signed request.
- `host-install-validates`: Stub manifest accepted by live validation.
- `host-library-not-discover`: Locally installed app is enabled from App Store Library (/apps/library), not Discover (time approximate).
- `host-proxy-path`: /apps/specter-arena/api/ping reaches backend /api/ping; backend.routes played no part.
- `host-react-version`: window.__kirocrew_modules.react.version is 18.3.1 (time approximate).
- `host-roundtrip-signed`: Backend reachable at 2026-11-10T00:59:29Z; the backend answers 200 only to a valid signature.
- `host-sdk-own-namespace-not-implicit`: Browser SDK refused /api/ping with Declared: []; the own backend path must be listed in permissions.api (FD-27).
- `host-single-page-route`: /apps/specter-arena/diagnostic redirected to the Crew home; the router has one route, /apps/:name.
- `host-third-party-trust-gate`: CLI enable refused: third-party app execution is disabled; enabling needs the dashboard per-app trust prompt (time approximate).
- `host-ui-default-export-renders`: Release page renders from a default-export entry.
- `host-ui-stub-failure`: FP-00 stub (named mount only) shows "App crashed" with React error #306 (time approximate).

## Limits of this record

- Screenshots were reported as pasted text or images in chat, not saved as files. None is committed.
- Release-tree exclusion of the diagnostic page is proven by CI, not by a Crew install.
- Monitoring scope is not decided here; see `monitoring-scope.md` (Status: NOT APPROVED, issue #21).
