# Provenance summary

Draft for Eric's review. The agent does not submit.

Last verified commit: `fab5b910740d98d3683231705734b8f8a1db7a6f`

The full record is `docs/provenance.md`. This page is the short version for the submission form. AI rewriting or new commit dates do not change where code came from.

| Item | Origin | Where recorded | Status |
|---|---|---|---|
| App code and docs | Written for Specter Arena in this repository, from an empty first commit that holds only `LICENSE` (`156385b`) | `docs/provenance.md` "Original work" | New work, with the three exceptions below |
| Adapted UI code | Began as Figma Make output and was adapted to this repository's contracts, toolchain and scoped CSS | `docs/provenance.md` "Generated code: Figma Make export" (file-by-file table) | Disclosed. Terms checked 2026-11-18 |
| Raster art (16 files: portraits, minion sprites, arena map) | Created by Eric Jeffers using ChatGPT (OpenAI) image generation | `docs/provenance.md` "Art: created by Eric Jeffers using ChatGPT (OpenAI) image generation" (one row per file with sha256) | Disclosed. `npm run check:provenance` fails if a shipped image has no row. Terms checked 2026-11-18 |
| Nine vector drawings | Authored in the Figma Make project and shipped as TSX code, not as images | `docs/provenance.md` "Figma Make-authored vector code, ported as TSX" | Disclosed. Terms checked 2026-11-18 |
| Dragonboat (`burlabs/dragonboat-cms`) | Read once as an architectural pattern reference. Nothing copied | `docs/provenance.md` "Reference only: Dragonboat" | `npm run check:provenance` fails on Dragonboat-only identifiers |
| Crew prior art (`iamwhatever/xiaoya-crew-app`) | Read once on 2026-11-09 as a reference for what an app can reach. Nothing copied | `docs/provenance.md` "Reference only: Crew prior art" | Disclosed |
| Development tooling (implementer agent, review gates, planning SOP, orchestration kit) | Used to plan and build the repository; installed outside it and not vendored | `docs/provenance.md` "External development tooling" | Disclosed |
| Third-party dependencies | Declared in the lockfiles | `DEPENDENCIES.md` | Open-source licenses listed there |

## Terms

OpenAI's Terms of Use (effective 2026-01-01, read from an Internet Archive snapshot because the live page refused automated fetches) and Figma's AI Terms (effective 2026-10-30) were checked on 2026-11-18. Both leave ownership of output with the user. No conflict with the MIT license was found. This is a disclosure record, not legal advice. See `docs/provenance.md` "Terms checked".

## Kiro use and provenance are separate

`kiro-use.md` says how Kiro was used. This page says where the code and art came from. Neither page claims more than the repository shows.
