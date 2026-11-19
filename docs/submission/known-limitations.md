# Known limitations (draft)

Draft for Eric's review. The agent does not submit. The classified list (BLOCKER or KNOWN LIMITATION, with evidence) is `docs/release/blockers.md`; the rows below are the judge-facing wording. Each KNOWN LIMITATION there names where it is disclosed, and security-relevant ones are disclosed in `docs/release/threat-model.md`.

Last verified commit: `65e0f549691af2c6f4c9425f021d4b17b6b76a82` (`main` after FP-16 PR-B #149; the changes of FP-16 PR-C were re-read at that PR's head)

Each row names where the limit was recorded.

| Limit | What it means for you | Source |
|---|---|---|
| First enable needs network access to PyPI | Crew downloads the backend's Python packages on the first start. Offline first enable fails | `docs/release/install.md` |
| "Waiting on you" and "Blocked" bot states are not shown | Crew does not expose approval signals to apps in a proven way. The roster shows "Working", "No turn running" and "Unknown" only. "No turn running" is not a health reading | FP-04 handoff, decision Q1 |
| The roster lists only bots Crew lets the app see | Bots without a store, never-opened direct messages and scheduled turns are invisible. Coverage is the collector's, since the bot was first seen | FP-04 handoff, "must NOT assume" list |
| Worker-session attribution and gateway restarts are unproven live | Some attempts may not be linkable as evidence | FP-04 handoff, open risks; FP-08+09 handoff (B10) |
| Every decision is recorded as `app-owner` | Crew gives apps no per-user identity, so multi-user attribution is not possible | FP-08+09 handoff, open risks |
| XP is derived from accepted work items only | An ended attempt is not success. Items you never link or accept earn nothing | FP-08+09 handoff |
| "Open Bots in Crew" opens the Bots page only | Crew 0.12.2 has no route for one bot's chat or for an approval. The click was read statically and not clicked live (issue #124) | FP-10+11 handoff; `docs/compatibility/handoff-routes.md` |
| Accepted items created long ago can be missing from the arena | Work lists sort by creation and the arena reads one page of accepted items. The list view says so | FP-10+11 handoff, open risks |
| The arena draws at most 80 enemies | Overflow is listed in the list view as "Not drawn in the scene" | FP-10+11 handoff |
| Each poll reads a few hundred KB of work-item JSON | Acceptable for one machine; a lighter list read would be a work-ledger change | FP-10+11 handoff |
| The 2.8 MB arena-map image is unproven through the real Crew proxy | If it fails the arena shows a fallback without the map. A smaller fallback was measured (issue #124). Since FP-16 the map and sprites are blob URLs because Chromium paints nothing for a data URL above 2 MiB in a CSS variable; whether the host's content-security policy allows `blob:` images is not verified on an installed app (OA-5), and the fallback is a labelled map plate | FP-10+11 handoff; FP-16 PR-B and PR-C reports |
| The "gap longer than two polls" rule has unit tests only | End-to-end tests cover the hidden-tab path | FP-10+11 handoff |
| Performance numbers are from the FIXTURE preview on one fast Apple machine | They are not measurements of the installed app | `.kiro/specs/fp-16-heroes-parity/performance.md` (after FP-16); `.kiro/specs/fp-10-11-live-arena/performance.md` (before) |
| A password value of several unquoted words keeps its later words in the copied diagnostic summary | The summary removes credential-shaped values, but a credential word followed by several unquoted words loses only its first word. Check the summary before sharing it | `docs/release/blockers.md` (KL-18) |
| No purge, in-app backup, restore or export | The app keeps everything. Only `kirocrew app uninstall specter-arena --purge-data` shrinks the store. Backup and restore are offline steps, and the hand restore was not exercised on a live Crew install | `docs/release/data-and-recovery.md`; `docs/release/blockers.md` (KL-07, KL-08) |
| The automated accessibility scan covers the FIXTURE preview only | Screen-reader output, the real host theme and Windows High Contrast are manual checks, listed with blank results until the owner sitting | `docs/release/a11y-checklist.md`; `docs/release/blockers.md` (KL-17) |
| SQLite 3.37 or newer is required | The work tables are STRICT. A host with older SQLite fails at migration; CI is the check | FP-08+09 handoff |
| Do not install an older release over a newer one | The store refuses a database whose schema is newer than the code | `docs/release/install.md` "Update" |
| Art is AI-generated and may not be unique | Disclosed with its terms check; the arena map carries a C2PA metadata chunk | `docs/provenance.md` "Terms checked" |
| One demo machine | Tested on macOS only | `docs/compatibility/crew-0.12.2.md` |
| A hero's text is fixed | Changing a hero's name, epithet or personality needs a new release. The owner changes only the avatar | `docs/release/install.md` section 7 |
