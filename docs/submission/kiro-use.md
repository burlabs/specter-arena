# How Kiro was used

Draft for Eric's review. The agent does not submit.

Last verified commit: `d53b16ea6373094cb0835352adf68c255a9e1398` (`main` after the logo PR #181; re-read for release candidate RC-3)

This page lists only what the repository shows. Anything Eric did outside the repository (for example in the Kiro IDE) must be added by Eric as his own statement, with his own evidence.

## What exists

| Evidence | Where | Notes |
|---|---|---|
| The app is a Kiro Crew app | `app.json`, `ui/src/mount.tsx`, `backend/app.py` | It runs inside the user's Kiro Crew. Live behavior was probed on Crew 0.12.0 and 0.12.2 by Eric, with committed evidence in `docs/compatibility/evidence/` |
| Seven spec folders in Kiro's spec layout (`requirements.md`, `design.md`, `tasks.md`) | `.kiro/specs/fp-01-crew-integration-probe/`, `fp-02-03-contracts-and-observation/`, `fp-04-bot-roster/`, `fp-06-07-summoning-visuals/`, `fp-08-09-work-encounters-xp/`, `fp-10-11-live-arena/`, `fp-16-heroes-parity/`; index in `.kiro/specs/README.md` and `spec/index.md` | Written in Kiro's spec file layout by the planning workflow running in Kiro Crew. They were not produced by the Kiro IDE spec screens, as far as the repository shows |
| Three steering files | `.kiro/steering/product.md` (always included), `structure.md`, `tech.md` | Product, structure and technology context for agents working in the repository |
| Agent-assisted development workflow | `docs/provenance.md` "External development tooling"; `docs/development/adapters.md` | A planning workflow, an implementer agent and two review gates (`gate-requirements`, `gate-fit`) ran in Kiro Crew. They are installed outside this repository and are disclosed, not vendored |
| Seeded randomized property tests | `backend/tests/test_store_xp_properties.py`, `backend/tests/work_fakes.py` | Randomness comes only from `random.Random(seed)` and every failure message carries the seed. No property-testing package is used |
| Contract and spec-id checks | `spec/ids.md`, `scripts/check-spec-ids.mjs`, `scripts/check-schema.mjs`, `contracts/OWNERS.md` | Spec-driven structure enforced by scripts; these are repository tooling, not a Kiro feature |

## What this project does not claim

| Feature | Status | Evidence |
|---|---|---|
| Kiro hooks | Not claimed. None exist | `git ls-files .kiro` lists only `specs/` and `steering/`; there is no `.kiro/hooks/` |
| MCP servers or MCP configuration | Not claimed | No MCP config file is tracked and the app declares no agent |
| Powers | Not claimed | None in the repository |
| Kiro IDE or Kiro CLI features (vibe sessions, autopilot, `.kiro/settings`) | Not claimed | Not evidenced in the repository |
| A property-testing library | Not claimed | Neither `hypothesis` nor `fast-check` appears in `package.json`, `backend/pyproject.toml` or `DEPENDENCIES.md`; the tests above are seeded randomized tests |
| Review verdicts as repository evidence | Not claimed | Gate verdicts are kept in planning folders outside the repository |
