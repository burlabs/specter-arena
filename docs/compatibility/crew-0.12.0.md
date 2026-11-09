# Kiro Crew 0.12.0 compatibility record

Specter Arena is probed against Kiro Crew 0.12.0 only. The manifest floor `minKiroCrewVersion: "0.12.0"` is added with the signed round-trip slice; no other host version is probed.

## Install method

Not yet recorded. The live probe run records how the app was installed, with timestamps and credential labels (`docs/ops/crew-probe-runbook.md`).

## Host facts (not permissions)

Host facts describe how the host behaves. They may rest on OWNER-SESSION evidence. They never grant the app anything; permissions live in `capability-matrix.md`.

| Id | Status |
|---|---|
| `host-backend-spawn` | UNTESTED |
| `host-consent-screen` | UNTESTED |
| `host-dev-diagnostic-only` | UNTESTED |
| `host-disable-reenable` | UNTESTED |
| `host-import-map-sdk` | UNTESTED |
| `host-install-validates` | UNTESTED |
| `host-proxy-path` | UNTESTED |
| `host-react-version` | UNTESTED |
| `host-roundtrip-signed` | UNTESTED |
| `host-ui-default-export-renders` | UNTESTED |
| `host-ui-stub-failure` | UNTESTED |

Every fact is UNTESTED until the live probe run.
