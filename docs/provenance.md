# Provenance

## Original work

All code and docs in this repository were written for Specter Arena starting from an empty repository (the initial commit holds only `LICENSE`).

## Reference only: Dragonboat

`burlabs/dragonboat-cms` at `8c63c62a6b109602d9618649fb66df4b896b08b0` is a separate Kiro Crew app by the same organization. It was read as a pattern reference while planning this repository. Nothing was copied from it: no source, configuration, assets, or docs.

`npm run check:provenance` (CI job `provenance`) fails on identifiers that only appear in Dragonboat: its package scope, its internal module and service names, its build scripts, and Apache-2.0 SPDX headers (Dragonboat is Apache-2.0; this repository is MIT). The denylist lives in `scripts/check-provenance.mjs`; extend it when a new Dragonboat-only identifier is found. The same check fails on any AWS CLI `--profile` other than `specter-preview` and on anything shaped like an AWS access key ID, so preview tooling can never point at another account's credentials.

## Reference only: Crew prior art

`iamwhatever/xiaoya-crew-app` is a third-party Kiro Crew app that shows a per-crew companion in the Crew webview. It was read once, on 2026-11-09, as a read-only reference for how an app can reach a bot-scoped surface today. Nothing was copied from it: no source, templates, assets or configuration. It must not be copied. Any future reader records the date and purpose here. The Kiro Crew source (`kirodotdev/KiroCrew` at tag v0.12.0) and the installed app were read for host behavior only, also without copying.

## External development tooling

The following are used to plan and build this repository but are not part of it and are not vendored here:

- the `fullstack-implementer` agent and its SOPs
- the quality-gate agents `gate-requirements` and `gate-fit`
- the feature-planning SOP and the multi-agent orchestration kit

## Third-party dependencies

See `DEPENDENCIES.md`.
