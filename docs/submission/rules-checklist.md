# Kiroween 2026 rules checklist

Draft for Eric's review. The agent does not submit. Eligibility is the organizers' decision, not a guarantee.

Last verified commit: `232629b65ceffb127675e7bd321fc901fcc5cd08` (`main` after the avatar packs PR #196; re-read for release candidate RC-4)

Rules read: the Devpost overview page https://kiroween.devpost.com/ on 2026-11-18 (HTTP 200). The Rules tab https://kiroween.devpost.com/rules returned HTTP 403 to automated fetches on 2026-11-18 (web fetch and curl with a browser user agent), so the requirements below come from the overview's "What to Submit" section and the master plan's W6 summary. The overview itself says to review the Rules tab for full details.

Status values: MET (evidence exists now), PARTIAL, PENDING (needs a later stage or Eric), DRAFT (text exists, not final), INFO, N/A.

| ID | Requirement (paraphrased) | Status | Evidence or command | Notes |
|---|---|---|---|---|
| R-0 | Read the full Rules tab in a browser once before submitting | PENDING (Eric) | Eric records the date here | The Rules tab was not readable by automated fetch |
| R-1 | New project built in the submission period, Oct 30 to Dec 4 2026 | MET, disclosed | Repo created 2026-11-05 (`gh api repos/burlabs/specter-arena -q .created_at` prints `2026-11-05T04:22:40Z`); first commit holds only `LICENSE` (`git show --stat 156385b`); `docs/provenance.md` | Pre-period material is disclosed, not copied: Dragonboat (reference only) and the orchestration kit (external tooling) |
| R-2 | Deadline Friday 2026-12-04 2:00 PM Pacific | INFO | Submit target 2026-12-03 (program plan) | Eric submits |
| R-3 | Working software application that uses Kiro; pick one category | PENDING | Release artifact and `docs/release/install.md`; owner install check OA-6 (issue #133) | Category is Eric's choice in the form; the draft targets Costume Contest |
| R-4 | Public GitHub repository URL with all source, assets and instructions | MET | `gh repo view burlabs/specter-arena --json visibility -q .visibility` prints `PUBLIC`; `docs/release/install.md` | Re-run at release |
| R-5 | Open-source license, detectable and visible in About | MET | `gh api repos/burlabs/specter-arena -q .license.spdx_id` prints `MIT` | The About description is empty; setting it is Eric's repository setting |
| R-6 | `/.kiro` at the repo root showing specs, hooks and steering, not ignored | PARTIAL | `git ls-files .kiro` lists `specs/` (11 folders plus a README) and `steering/` (3 files), 40 files in all; `npm run check:provenance` fails if `.kiro/` is untracked or ignored | No hooks exist and none are claimed. A hook would be new scope |
| R-7 | URL to the working app; credentials only in the private form | PENDING | The GitHub Release page for the tagged artifact, `docs/release/install.md`, `docs/release/judge-access.md` | Crew apps have no hosted URL; the organizers decide whether this satisfies the rule |
| R-8 | Text description of features and functionality | DRAFT | `docs/submission/features.md` | |
| R-9 | Demo video under 3 minutes, shows the project on the device it was built for, public on YouTube, no third-party trademarks or unlicensed music | PENDING (Eric) | `docs/submission/demo-script.md` (target 2:28) | Eric records and uploads; no music, or only original or licensed |
| R-10 | Write-up on how Kiro was used (surfaces, agents, hooks, specs, steering, MCP, property tests, powers) | DRAFT | `docs/submission/kiro-use.md` | States what is absent |
| R-11 | Best Kiro Crew App bonus: public repo URL of the Crew app and a description of its features | DRAFT | Repo URL above; `docs/submission/features.md` | |
| R-12 | Optional bonuses (Social Blitz post with #KiroweenHackathon26, blog post, Ghost of Kiroween Past, Startup, Student) | N/A unless Eric opts in | None planned | Each has its own extra fields |
| R-13 | Judging criteria: Potential Impact, Technological Implementation, Design, Innovation/Idea, Presentation | INFO | `docs/submission/architecture.md`, `features.md`, `demo-script.md` | |
