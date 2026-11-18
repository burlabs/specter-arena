# Provenance

## Original work

All code and docs in this repository were written for Specter Arena starting from an empty repository (the initial commit holds only `LICENSE`), with three exceptions: the files listed under "Generated code: Figma Make export" below began as Figma Make output and were adapted here; the raster images listed under "Art: created by Eric Jeffers using ChatGPT (OpenAI) image generation" were supplied by Eric Jeffers; and the vector scene art described under "Scene vector art" was authored in the Figma Make project and is ported as code.

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
| FP-08+09 | `components/WorkReviewPanel.tsx` | `ui/src/work/ReviewPanel.tsx`, `reviewMachine.ts`, `WorkDetail.tsx` | review and accept interaction spec only; rewritten against the `work-item` contract; three states became seven; the campaign, attribution, evidence URL and session XP fields are cut; the `<dialog>` became an inline confirm form; fixtures removed; scoped classes |
| FP-08+09 | `components/SpecterProgression.tsx` | `ui/src/work/XpMeter.tsx`, `XpCards.tsx`, `ProgressionPanel.tsx` | level and XP display idea; the fixed 100 XP constant and the session scope are replaced by the `levels-1` fields of `xp-summary`; the bar width is computed from XP fields only; scoped classes |
| FP-08+09 | `workflow/model.ts` (acceptance parts only) | none | vocabulary reference only; nothing ported; the contracts win |

Ported CSS has no Tailwind and every selector is scoped under the app root. No images or fonts from the export are used in FP-04, FP-06+07 or FP-08+09. Each later session that ports files adds its rows here. `DEPENDENCIES.md` lists packages, and Figma Make is a generator rather than a dependency, so it has no entry there.

## Art: created by Eric Jeffers using ChatGPT (OpenAI) image generation

Every raster image this repository ships was created by Eric Jeffers using ChatGPT (OpenAI) image generation. That is Eric's statement of 2026-11-18 (the program decisions log, "Art release") and it is recorded here as given. The files are not tied to any bot, role or character category: the portraits are a gallery any Specter can use, and the arena map, the two minion sprites and the two minion portraits are scene art.

How the files in each group were made, as recorded in the metadata of the Figma Make export (`public/assets/*.json`, read 2026-11-18):

- A01, A02 and A03 portraits (vell, stitch, reeve, ember, rattle, shard, lume, moss, tide). The export's own metadata states that the pixels were cut out of one generated ten-character roster sheet (1536 x 1024, sha256 `f8c9f81e132f00d4e712c336fb4853d1ee88d2e7e892f06f41aff98b6dc3905f`), with an estimated alpha matte and a resize, and that no further image generation or redesign was used. The sheet is not shipped.
- bur, Patchling and Patchbrute. The export's metadata calls them newly generated isolated artwork. Only the 256 px portraits (bur and the two minions) and the 512 px minion sprites listed below ship; the full-size masters do not.
- poly. The export carries no metadata file for poly. The same roster sheet is named "Poly Spotlight", so poly most likely comes from it, but this is not stated anywhere in the export. Eric's statement above covers the file; the processing detail is unconfirmed.
- Arena map. Supplied as one painted image and used unchanged by the export (`src/map/layout.ts`, mode `static-art`).

This replaces the earlier wording for the three A01 portraits, which described them as derived from a supplied sheet and disclaimed any rights finding (blocker B13). Eric's statement is now the recorded origin. It is not a legal opinion: OpenAI's output terms have not been rechecked yet, and that recheck is scheduled before the MIT release (FP-15), together with the Figma terms check above.

Not shipped, by design: the light/dark check JPGs (`a02-light-dark-anchor-check.jpg`, `minion-patchwork-light-dark-check.jpg`), `reference-crops/`, `roster-reference.png`, every `*-master.png`, every 96 px thumbnail, and the 512 px character sprites. `npm run check:provenance` fails if any of them is tracked.

Each shipped raster has one row below with its repo path and sha256. The check fails when a tracked image has no row with its exact path and hash, so a file cannot change without this table changing. Portraits are stored byte for byte; the app serves them through the portrait gallery (`GET /api/portraits`, `GET /api/assets/{assetId}`). Scene rasters are served by `GET /api/scene-assets/{key}` from a hash-pinned list and are never inlined into `ui/dist`.

| File in this repository | File in the export (`public/assets/`) | Pixels | Bytes | sha256 | Use |
|---|---|---|---|---|---|
| `backend/specter_arena/specters/art/vell.png` | `a01-vell-portrait.png` | 256 x 256 RGBA | 58471 | `268d5b2f0e068017002941afafe15d5c30375f2cf80ff144eec1c07b9c18dcf0` | gallery portrait (A01) |
| `backend/specter_arena/specters/art/stitch.png` | `a01-stitch-portrait.png` | 256 x 256 RGBA | 64520 | `4aaf7e40efe11d627ffbfdf4eb3ca83b331026b99ab023088c803196c519d561` | gallery portrait (A01) |
| `backend/specter_arena/specters/art/reeve.png` | `a01-reeve-portrait.png` | 256 x 256 RGBA | 80063 | `b6c7934853cf7c0a5e15653ce6fc7992d2b838b3724e95505b4d7a55c5c35cc7` | gallery portrait (A01) |
| `backend/specter_arena/specters/art/ember.png` | `a02-ember-portrait.png` | 256 x 256 RGBA | 51734 | `8c6f9437ff40e1b1ae2ab55b861e90c8c09e9f26875270bc606a980f0f267d3f` | gallery portrait (A02) |
| `backend/specter_arena/specters/art/rattle.png` | `a02-rattle-portrait.png` | 256 x 256 RGBA | 69631 | `86751f4a614d65e76750cdeadfd5c867b964fedc7508a52bf48749b56ce8f927` | gallery portrait (A02) |
| `backend/specter_arena/specters/art/shard.png` | `a02-shard-portrait.png` | 256 x 256 RGBA | 55635 | `2576bd49227ead05907c2accd1b3713c44f96417b998fca67377a0d7fe0ad214` | gallery portrait (A02) |
| `backend/specter_arena/specters/art/lume.png` | `a03-lume-portrait.png` | 256 x 256 RGBA | 68248 | `f9c206f6b911e62d087dbf786995ec9b9e928c56e002d5f2f19a8d1b7ba85cff` | gallery portrait (A03) |
| `backend/specter_arena/specters/art/moss.png` | `a03-moss-portrait.png` | 256 x 256 RGBA | 60824 | `0c4524e864e9a12ecefc134e1181bfe47da5b926ab251c588fb73dec8af14abd` | gallery portrait (A03) |
| `backend/specter_arena/specters/art/tide.png` | `a03-tide-portrait.png` | 256 x 256 RGBA | 64764 | `59fcffd06949711f7df0f821f602548420abc7d3d7875a69076e51bbc91977ea` | gallery portrait (A03) |
| `backend/specter_arena/specters/art/bur.png` | `bur-portrait.png` | 256 x 256 RGBA | 73785 | `f5c5c7bec8d2a890905c3b6a9531e1ceb84126cfb88efff78ccd512490b608a4` | gallery portrait (bur) |
| `backend/specter_arena/specters/art/poly.png` | `poly-portrait.png` | 256 x 256 RGBA | 69472 | `5e932feb493e778ea81a97e8abcbbe4fac17b34c61bbcd21a01083a804d28c51` | gallery portrait (poly) |
| `backend/specter_arena/specters/scene/arena-map.png` | `arena-map.png` | 1672 x 941 RGB | 2096047 | `58cac8daa5aa13448f075e203648f43c677cec5ef69e55b2638d7c7340565f7d` | arena map |
| `backend/specter_arena/specters/scene/minion-patchling-sprite.png` | `minion-patchling-sprite.png` | 512 x 512 RGBA | 166244 | `e64f5a3de03b5df6f608871fded48f9ae8b91f719271fbdac4c6e3eae3826d6a` | Patchling minion sprite |
| `backend/specter_arena/specters/scene/minion-patchbrute-sprite.png` | `minion-patchbrute-sprite.png` | 512 x 512 RGBA | 237354 | `e3dd138466d66a4fb3dddda64987366fd0b91a83e41f882619b0aa5abde254c9` | Patchbrute minion sprite |
| `backend/specter_arena/specters/scene/minion-patchling-portrait.png` | `minion-patchling-portrait.png` | 256 x 256 RGBA | 72210 | `f540745966dc68bbea76e4168cc3cc50880f82c5384c3838d42dae8fe07d6be6` | Patchling minion portrait |
| `backend/specter_arena/specters/scene/minion-patchbrute-portrait.png` | `minion-patchbrute-portrait.png` | 256 x 256 RGBA | 87269 | `08f4a47e140262cb2cfc5a5630618fea51c6021187a44bc10436463df8543e88` | Patchbrute minion portrait |

## Scene vector art: authored in the Figma Make project, ported as code

This is not ChatGPT image output, and the statement above does not cover it. The small SVG files in the export's `public/assets/scene/` (structures and markers) were authored as vector markup inside the Figma Make project. The export's own catalog labels them "Original vector prototype authored for Specters of the Abyss" (`src/data/sceneAssets.ts`, field `source`). They fall under "Generated code: Figma Make export" above and ship only as TSX components in the UI bundle, never as image files, so the image check does not list them. The PR that ports a file adds its row to the Figma Make table above.

## External development tooling

The following are used to plan and build this repository but are not part of it and are not vendored here:

- the `fullstack-implementer` agent and its SOPs
- the quality-gate agents `gate-requirements` and `gate-fit`
- the feature-planning SOP and the multi-agent orchestration kit

## Third-party dependencies

See `DEPENDENCIES.md`.
