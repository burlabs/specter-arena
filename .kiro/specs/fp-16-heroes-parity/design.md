# FP-16 design: fixed hero roster, auto-assignment and Figma parity

The full design lives with the planning session and is summarised here. Summoning is removed (PA-2). The hero text lives in `backend/specter_arena/specters/heroes.json`; the database stores only who got which hero and which avatar was chosen (migration 0007); a new `specter.v2` contract carries the composed view; the UI moves to v2.

## Shape of the work

| Component | PR-A | PR-B | PR-C |
|---|---|---|---|
| work-ledger | migration 0007, `hero_assignment`, `avatar_revision`, store API | none | store numbers |
| specter-identity | `heroes.json`, loader, v2 contracts, avatar-only service, 7 routes | 22 scene rasters | none |
| crew-integration | manifest narrowing, guard, boot, v2 fixtures | fixture art | docs facts |
| experience | v2 types, hero card, avatar picker | sprites, thumbnails, map fix | remaining parity |
| delivery | RETIRED tooling, spec folder, docs | provenance rows | screenshots, performance |

## Decisions

- Assignment is a store concern computed from a gapless sequence, so a purge never reshuffles heroes. Supersedes the derive-at-read-time option.
- `specter.v2` is a new major; the four v1 identity contracts are RETIRED, not deleted, so captured bodies still validate.
- The grant set shrinks; an installed RC-1 narrows on update and the OA-5 runbook records what the host did.
- PR-A stays one PR: the backend routes, UI types, fixtures and guards must change together for CI to stay green.

## Supersedes

| Earlier requirement | Status |
|---|---|
| FP0607-REQ-01, FP0607-REQ-05, FP0607-REQ-06, FP0607-REQ-13 | obsolete: generation, prompt, budget and prompt version no longer exist |
| FP0607-CI-01, FP0607-CI-02, FP0607-CI-04 | rewritten: the manifest has no generation grant and no agent; the lazy-import rule stays |
| FP0607-DEL-04, FP0607-DEL-12 | rewritten: release grants and the specters e2e journeys |
| FP-09-AC06, FP0809-WL-09 | still binding: hero assignment never earns XP |
