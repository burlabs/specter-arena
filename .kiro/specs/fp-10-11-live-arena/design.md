# FP-10+11 design

Status: planned. The wire contract `scene-asset` is `DRAFT` in `contracts/OWNERS.md` until its first UI consumer merges (PR-C flips it to `FROZEN` in the last commit).

## Shape of the work

| Component | PR-A | PR-B | PR-C |
|---|---|---|---|
| specter-identity | eight gallery portraits, `scene-asset.v1` schema and cases, five hash-pinned scene rasters, `scene_art.py`, `reencode_png` limit parameters, OWNERS DRAFT row | none | OWNERS freeze flip |
| crew-integration | signed `GET /api/scene-assets/{key}`, `ApiError` to `HostApiError` mapping in `useHostApi`, `sceneAssetPath`, fixture SDK scene-asset route | FIXTURE mode signal, arena fixture scenarios, fixture call log | handoff route record, host navigation hook |
| experience | `SceneAssetV1` type and typed-contract drift row | the Arena tab in `ui/src/arena/` | inspector, handoffs, diagnostic summary, celebrations |
| delivery | B13 provenance rewrite, `check-provenance` art rows, spec ids, this folder, producer count of twenty-one | Figma Make rows, measured bundle budget with raster guard, `tests/e2e/arena.spec.ts` smoke part | inspector e2e, `arena-perf-1` record, FD-31 skip record, FROZEN flip |

## Decisions

| Id | Decision |
|---|---|
| FP1011-D1 | The arena is a read-only projection of the FROZEN reads of FP-04, FP-06+07 and FP-08+09. It adds no write route and no Crew grant. |
| FP1011-D2 | Scene rasters are served by `GET /api/scene-assets/{key}` from a hash-pinned allowlist in the backend package. They are never inlined into `ui/dist`, are not portraits and never appear in the gallery. |
| FP1011-D3 | An unknown, malformed or unverified scene key is 404 `unknown_scene_asset`. The bare `not_found` code already means the backend lacks the route, so the scene route names its subject like every other 404 (reconciliation R3). |
| FP1011-D4 | A scene file whose sha256 does not match its pin is never served, and the other keys still are. A gallery file that does not match keeps the existing all-or-nothing behavior. |
| FP1011-D5 | `reencode_png` takes optional keyword limits `max_bytes` and `max_side`. The defaults stay the portrait limits (1 MiB, 1024 px); scene rasters use 4 MiB and 4096 px. The upload route still calls it with the defaults. |
| FP1011-D6 | `BundledArt` pins `sha256` and a `pack`. The eight new gallery rows are stamped `base + index` so `BUNDLED` order is the gallery order, and vell, stitch and reeve keep their asset ids. |
| FP1011-D7 | The arena map is served as shipped (1672 x 941, 2,096,047 bytes, with its provenance chunk) and pinned by hash. A downscale fallback is used only if the installed proxy refuses the 2.8 MB body (reconciliation R16). |
| FP1011-D8 | B13: `docs/provenance.md` states that every raster was created by Eric Jeffers using ChatGPT (OpenAI) image generation, with one row per file. The scene SVGs are Figma Make-authored vector code and are not covered by that statement (reconciliation R2). |
| FP1011-D9 | `check-provenance` enforces B13: a tracked raster needs a row naming its exact path and sha256, QA art files and the retired wording are refused, and a Figma Make row may not name an untracked `ui/src/` path. No workflow edit is needed. |
| FP1011-D10 | The real host SDK throws `ApiError`. `useHostApi` maps a thrown error with an integer HTTP status and a JSON body to `HostApiError`, so every FP-11-AC03 fallback runs on the installed host (reconciliation R10). |
| FP1011-D11 | The new schema needs UI plumbing in PR-A: `SceneAssetV1`, `sceneAssetPath` and the producer count of twenty-one (reconciliation R14). |
| FP1011-D12 | The OpenAI output-terms recheck and the Figma terms check are scheduled before FP-15 and are recorded in `docs/provenance.md`. |

## End-to-end loop

1. A signed `GET /api/scene-assets/arena-map` returns a `scene-asset.v1` body with the pinned `sha256`, `width`, `height` and `byteLength`.
2. An unknown or malformed key returns 404 `unknown_scene_asset`, and no list, write or storage route exists.
3. `GET /api/portraits` lists eleven bundled gallery items in `BUNDLED` order; scene rasters never appear there.
4. `npm run check:provenance` passes only while every tracked raster has a row with its path and sha256.

PR-B draws the arena from these routes and PR-C inspects it.

## Boundaries that stay as they are

No workflow, lockfile, dependency, `app.json`, grant, migration or FROZEN-schema change. No new write route.
