# Provenance

## Original work

All code and docs in this repository were written for Specter Arena starting from an empty repository (the initial commit holds only `LICENSE`), with two exceptions: the files listed under "Generated code: Figma Make export" below began as Figma Make output and were adapted here, and the three portraits listed under "Bundled art: A01 approved roster" are user-supplied art.

## Reference only: Dragonboat

`burlabs/dragonboat-cms` at `8c63c62a6b109602d9618649fb66df4b896b08b0` is a separate Kiro Crew app by the same organization. It was read as a pattern reference while planning this repository. Nothing was copied from it: no source, configuration, assets, or docs.

`npm run check:provenance` (CI job `provenance`) fails on identifiers that only appear in Dragonboat: its package scope, its internal module and service names, its build scripts, and Apache-2.0 SPDX headers (Dragonboat is Apache-2.0; this repository is MIT). The denylist lives in `scripts/check-provenance.mjs`; extend it when a new Dragonboat-only identifier is found. The same check fails on any AWS CLI `--profile` other than `specter-preview` and on anything shaped like an AWS access key ID, so preview tooling can never point at another account's credentials.

## Reference only: Crew prior art

`iamwhatever/xiaoya-crew-app` is a third-party Kiro Crew app that shows a per-crew companion in the Crew webview. It was read once, on 2026-11-09, as a read-only reference for how an app can reach a bot-scoped surface today. Nothing was copied from it: no source, templates, assets or configuration. It must not be copied. Any future reader records the date and purpose here. The Kiro Crew source (`kirodotdev/KiroCrew` at tag v0.12.0) and the installed app were read for host behavior only, also without copying.

## Generated code: Figma Make export

The user interface design for Specter Arena was produced with Figma Make as a separate project (a local export of it, taken on 2026-11-16, is the reference). The export is not vendored in this repository. A session ports only the files for its own screens, adapts them to this repository's contracts, toolchain and scoped CSS, and lists them here. Where the export's fixture models and a contract in `contracts/` differ, the contract wins.

Figma's terms for generated code have not been checked yet. That check is scheduled before the MIT release.

| Session | Export file | Adapted into | What changed |
|---|---|---|---|
| FP-04 | `components/ObservatoryPage.tsx` | `ui/src/observatory/ObservatoryPage.tsx`, `RosterList.tsx`, `BotSummary.tsx` | wired to the roster and attempts routes; bots instead of agents; fixtures removed |
| FP-04 | `components/OperationalLegend.tsx` | `ui/src/observatory/OperationalLegend.tsx` | legend text follows the approved condition vocabulary |
| FP-04 | `components/OperationalMarker.tsx` | `ui/src/observatory/ConditionBadge.tsx` | markers follow the approved condition vocabulary; artwork replaced by CSS shapes |
| FP-04 | `components/ui.tsx` | `ui/src/observatory/ui.tsx` | primitives only, with scoped classes |
| FP-04 | `observatory/model.ts` | `ui/src/observatory/model.ts` | rewritten from the contracts; only the export's vocabulary was a reference |
| FP-06+07 | `components/SpecterArtwork.tsx` | `ui/src/specters/SpecterPortrait.tsx` | image with a failure state and a labelled fallback token; fixture lookup, anchors and the ghost drawing removed; scoped classes |
| FP-06+07 | `components/MotionPolicyContext.tsx` | `ui/src/specters/useMotionAllowed.ts` | idea only: reduced motion turns effects off; context and user pause removed |
| FP-06+07 | `components/SpectersPage.tsx` | `ui/src/specters/SpectersView.tsx`, `SpecterDetail.tsx` | layout and interaction spec; rewritten against the `specter` and `specters` contracts; fixtures, XP and progression removed |
| FP-06+07 | `components/SummoningPage.tsx` | `ui/src/specters/SummonPanel.tsx` | interaction spec; rewritten against the summoning route; mock generator removed |

Ported CSS has no Tailwind and every selector is scoped under the app root. No images or fonts from the export are used in FP-04 or FP-06+07. Each later session that ports files adds its rows here. `DEPENDENCIES.md` lists packages, and Figma Make is a generator rather than a dependency, so it has no entry there.

## Bundled art: A01 approved roster

Three portraits ship in `backend/specter_arena/specters/art/` as selectable gallery images. They are original art supplied by Eric from the A01 pack (`A01-approved-roster-assets`, `data/a01.assets.json`, derived non-generatively from the user-supplied `approved-roster.png`, source sha256 `f8c9f81e132f00d4e712c336fb4853d1ee88d2e7e892f06f41aff98b6dc3905f`). They are not tied to any bot or character category. The pack's own note says no licensing determination is implied by inclusion. Rights confirmation for the MIT release and the human art review (FP-07 human decision) are both open and belong to Eric.

| File in this repository | A01 file | Size | sha256 |
|---|---|---|---|
| `art/vell.png` | `characters/vell/portrait.png` | 256 x 256 RGBA | `268d5b2f0e068017002941afafe15d5c30375f2cf80ff144eec1c07b9c18dcf0` |
| `art/stitch.png` | `characters/stitch/portrait.png` | 256 x 256 RGBA | `4aaf7e40efe11d627ffbfdf4eb3ca83b331026b99ab023088c803196c519d561` |
| `art/reeve.png` | `characters/reeve/portrait.png` | 256 x 256 RGBA | `b6c7934853cf7c0a5e15653ce6fc7992d2b838b3724e95505b4d7a55c5c35cc7` |

The 96 px thumbnails and 512 px sprites of the pack are not shipped. Uploaded PNGs are re-encoded by the app and stored by content hash; they are the uploader's own work and are not listed here.

## External development tooling

The following are used to plan and build this repository but are not part of it and are not vendored here:

- the `fullstack-implementer` agent and its SOPs
- the quality-gate agents `gate-requirements` and `gate-fit`
- the feature-planning SOP and the multi-agent orchestration kit

## Third-party dependencies

See `DEPENDENCIES.md`.
