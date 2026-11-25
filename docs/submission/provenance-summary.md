# Provenance summary

Draft for Eric's review. The agent does not submit.

Last verified commit: `3895df06d69cf14e9e78ea59bf3458cefb6894df` (`main` after FP-28 #220; re-read for release candidate RC-8)

The full record is `docs/provenance.md`. This page is the short version for the submission form. AI rewriting or new commit dates do not change where code came from.

| Item | Origin | Where recorded | Status |
|---|---|---|---|
| App code and docs | Written for Specters of the Abyss in this repository, from an empty first commit that holds only `LICENSE` (`156385b`) | `docs/provenance.md` "Original work" | New work, with the three exceptions below |
| Adapted UI code | Began as Figma Make output and was adapted to this repository's contracts, toolchain and scoped CSS | `docs/provenance.md` "Generated code: Figma Make export" (file-by-file table) | Disclosed. Terms checked 2026-11-18 |
| Raster art (38 files: 11 portraits, the arena map, 4 minion images, 11 hero sprites and 11 hero thumbnails) | Created by Eric Jeffers using ChatGPT (OpenAI) image generation | `docs/provenance.md` "Art: created by Eric Jeffers using ChatGPT (OpenAI) image generation" (one row per file with sha256) | Disclosed. `npm run check:provenance` fails if a shipped image has no row. Terms checked 2026-11-18 |
| Crew store listing art (`store/`: one hero image and four screenshots) | The hero is Eric Jeffers's banner, created using ChatGPT (OpenAI) image generation, byte for byte. The screenshots are FIXTURE-preview captures of this repository's own interface with its committed art and demo data. They ship in the artifact (about 4.35 MB) so Crew can serve them | `docs/provenance.md` "Crew app store listing" (one row per file with sha256) | Disclosed. `scripts/check-provenance.mjs` allows no other raster under `store/` |
| Eleven Kiro Crew avatar packs (`avatar-packs/`, optional, repository only) | Each embeds a hero's committed portrait byte for byte, so the art is Eric Jeffers's ChatGPT (OpenAI) image generation output. The SVG wrappers around it are vector code written for the packs. They are not part of the release artifact | `docs/provenance.md` "Kiro Crew avatar packs" (one row per pack with the source blob SHA) | Disclosed. `scripts/__tests__/avatar-packs.test.mjs` fails if an embedded image differs from its portrait |
| Twelve vector drawings (nine from FP-10+11, three structures from FP-16) | Authored in the Figma Make project and shipped as TSX code, not as images | `docs/provenance.md` "Figma Make-authored vector code, ported as TSX" | Disclosed. Terms checked 2026-11-18 |
| Dragonboat (`burlabs/dragonboat-cms`) | Read once as an architectural pattern reference. Nothing copied | `docs/provenance.md` "Reference only: Dragonboat" | `npm run check:provenance` fails on Dragonboat-only identifiers |
| Crew prior art (`iamwhatever/xiaoya-crew-app`) | Read once on 2026-11-09 as a reference for what an app can reach. Nothing copied | `docs/provenance.md` "Reference only: Crew prior art" | Disclosed |
| Development tooling (implementer agent, review gates, planning SOP, orchestration kit) | Used to plan and build the repository; installed outside it and not vendored | `docs/provenance.md` "External development tooling" | Disclosed |
| Third-party dependencies | Declared in the lockfiles | `DEPENDENCIES.md` | Open-source licenses listed there |

## Terms

OpenAI's Terms of Use (effective 2026-01-01, read from an Internet Archive snapshot because the live page refused automated fetches) and Figma's AI Terms (effective 2026-10-30) were checked on 2026-11-18. Both leave ownership of output with the user. No conflict with the MIT license was found. This is a disclosure record, not legal advice. See `docs/provenance.md` "Terms checked".

## Kiro use and provenance are separate

`kiro-use.md` says how Kiro was used. This page says where the code and art came from. Neither page claims more than the repository shows.
