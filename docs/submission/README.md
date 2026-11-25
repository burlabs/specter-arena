# Submission drafts

Draft for Eric's review. The agent does not submit.

Last verified commit: `ea0d579547febf03c6dd6f9bcaafcf5e2f49fc70` (`main` after FP-26 PR-B #216; re-read for release candidate RC-7)

This folder holds the text and checklists for the Kiroween 2026 submission of Specters of the Abyss. Each claim names its source (a path, an acceptance criterion id or a command); unchecked items are marked as such.

## Contents

| File | Purpose | Status |
|---|---|---|
| `features.md` | Feature description for the Devpost form and the Best Kiro Crew App bonus | Draft |
| `kiro-use.md` | How Kiro was used, and what is not claimed | Draft |
| `architecture.md` | Technical write-up | Draft |
| `provenance-summary.md` | Who made what, with which tool | Draft |
| `known-limitations.md` | Limits a judge should know before running the app | Draft; classified list in `docs/release/blockers.md` |
| `rules-checklist.md` | One row per Kiroween requirement with status and evidence | Draft |
| `demo-script.md` | Shot list for the under-3-minute video | Draft |

Install and judge instructions live in `docs/release/install.md` and `docs/release/judge-access.md`. The terms check is recorded in `docs/provenance.md` under "Terms checked".

## Status

| Item | State |
|---|---|
| Text drafts in this folder | Written, not final |
| Release artifact and clean-install check | RC-4 was built and tested by the owner; RC-5 (after FP-24) was built after it; RC-6 (after FP-25) was built after that; RC-7 (after FP-26) is built by the release window after the RC-7 docs PR merges (`docs/release/evidence-checklist.md` sections 6 to 9). The owner's install check (OA-6, issue #133) is part of the RC-4 sitting, with a single RC-7 sitting that covers the re-check, the brand check and the registry install from the prebuilt `release` branch, which the owner publishes with `npm run release:branch` (`docs/release/oa-5-runbook.md`, `docs/release/install.md` section 11A) |

## Steps only Eric can do

1. Read the Kiroween Rules tab in a browser (row R-0 of `rules-checklist.md`).
2. Tag the release and upload the artifact and its checksum file.
3. Record the demo video and upload it to YouTube as public.
4. Fill in the Devpost form, including the private field for any judge login.
5. Submit before the deadline (target 2026-12-03; the deadline is 2026-12-04 2:00 PM Pacific).
