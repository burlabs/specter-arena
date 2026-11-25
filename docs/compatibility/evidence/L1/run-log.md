# L1 run log — unchanged FP-00 stub (main 5c47828) on Crew 0.12.0

Credential for every item below: OWNER-SESSION (Eric's terminal and dashboard). Reported by Eric in chat, 2026-11-09.

| Time (UTC) | Step | Result |
|---|---|---|
| 12:41:19 | `kirocrew app install <local checkout of the FP-00 stub>` | Installed (`installedAt` 2026-11-09T12:41:19Z). Manifest accepted by live validation. |
| ~12:41 | `kirocrew app enable specter-arena` (CLI) | Refused: "blocked by execution policy: third-party app execution is disabled; trust this app alone from the dashboard's App Store ... (agent.apps_trusted), or set agent.apps_allow_third_party=true". |
| ~12:49 | Open `/apps/specter-arena` (signed in to the dashboard by the owner) | Page shows "Enable this app from Apps to use it." The app is still disabled, so the stub's render result (FD-2) is NOT yet observed. |
| ~12:49 | Console `window.__kirocrew_modules?.react?.version` | `18.3.1` |
| 12:49:59 | `kirocrew app info specter-arena` | `enabled: false`; `origin: "registry"` (local-path install); `approvedGrantsStored: true`, `approvedGrants: {api: [], events: []}`; `sessionApprovalConsentPending: false`; `dev: false`. The echoed manifest's `backend` block shows `entryPoint`, `routes`, `type` but no `healthCheck`, although the stub's `app.json` declares `healthCheck: "/health"` (to check: serializer omission vs field dropped). |

| ~15:04 | Enabled from App Store Library (per-app trust), reloaded `/apps/specter-arena` | Header "specter-arena / App crashed"; error card "specter-arena encountered an error" with "Minified React error #306; ... args[]=undefined&args[]=". Screenshot: pasted image `pasted-image-20261109-080426210.png` (Eric, chat). React #306 = a lazy element type resolved to `undefined` (no default export): the host did `React.lazy(() => import(entry))` and rendered `module.default`. |

Host facts:
- `host-ui-stub-failure`: OBSERVED — the FP-00 stub (named `mount` export only) crashes in the host's error boundary with React #306 (lazy default undefined). Confirms FD-2 and the default-export entry merged in #22. The card is the host's "App crashed" boundary, not a separate "failed to load" card.
- `host-react-version`: OBSERVED — 18.3.1. Triggers FD-17: pin dev `react`, `react-dom`, `@types/react`, `@types/react-dom` to 18.3.1.
- `host-install-validates`: OBSERVED for the stub manifest (no `minKiroCrewVersion`); the release manifest with the floor is checked in L2.
- Execution trust gate: OBSERVED — CLI enable refused while third-party execution is off; enabling needs the dashboard's per-app trust prompt. New host fact to add (proposed id `host-third-party-trust-gate`).
- Enable path: OBSERVED — a locally installed third-party app appears under App Store **Library** (`/apps/library`), not Discover; enabling there triggers the per-app trust consent.
