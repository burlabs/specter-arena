# Install a Specter Arena release

Draft for Eric's review. The agent does not submit.

Last verified commit: `232629b65ceffb127675e7bd321fc901fcc5cd08` (`main` after the avatar packs PR #196; re-read for release candidate RC-4)

Platform facts below were read from the Kiro Crew 0.12.2 source and its dashboard strings. Facts that only a live run can confirm say "to be confirmed in OA-6 (#133)": the owner's clean-install check, which this page does not claim has happened yet. Agents cannot perform the install, trust, enable, update or uninstall steps: Crew refuses them from an agent shell (`docs/compatibility/crew-0.12.2.md`, "Install method"). They are the owner's steps, in the owner's own terminal and dashboard.

## 1. Who this is for and what you get

This page installs the Specter Arena release into your own Kiro Crew. There is no hosted instance; Crew apps run inside the user's Crew (`docs/release/judge-access.md`). You get one Crew app with four tabs, in this order: Arena, Roster, Specters and Data. The app opens on the Arena. In Crew's sidebar the app shows the Specter Arena logo, not the default box, selected and unselected. That icon behaviour is read from the Crew 0.13.0 source (`docs/compatibility/crew-0.13.0.md`, "App icons on 0.13.0") and is checked on the installed app in the RC-4 sitting.

## 2. Requirements

- Kiro Crew 0.13.1 is the host of the RC-4 sitting. Kiro Crew 0.13.0 hosted the RC-3 test, and Kiro Crew 0.12.2 was the version the install facts below were first read from (`kirocrew --version` printed `kirocrew 0.12.2` on 2026-11-18). Nothing is confirmed on an installed RC-4 until `docs/release/oa-5-result.md` exists. The minimum is 0.12.0 (`app.json` `minKiroCrewVersion`); Crew's install refuses a lower version (`manager_tree._validate_source_path`, which calls `check_min_version`).
- macOS or Linux.
- Network access to PyPI on the first enable. Crew installs the packages in `requirements.txt` with `pip --target` (`kiro_crew/apps/backend_runtime/provisioning.py`).
- At least one Crew bot, to see a populated roster (`docs/compatibility/monitoring-scope.md`).
- Node, npm and uv are not needed to install the artifact. They are only needed to build from a git clone (section 12).

## 3. Verify and extract

Download the artifact `specter-arena-VERSION-SHA12.tar.gz` and its checksum file `specter-arena-VERSION-SHA12.tar.gz.sha256` from the GitHub Release page into one folder, then run one of:

```sh
shasum -a 256 -c specter-arena-VERSION-SHA12.tar.gz.sha256   # macOS
sha256sum -c specter-arena-VERSION-SHA12.tar.gz.sha256       # Linux
tar -xzf specter-arena-VERSION-SHA12.tar.gz
```

The checksum line must end in `OK`. Extract to a place that will stay where it is: `kirocrew app update` re-reads the recorded source folder (section 8). The top folder is named like the artifact, without `.tar.gz`.

The checksum covers the uploaded file only. If the extracted folder holds a `RELEASE-MANIFEST.txt`, it lists a sha256 for each file. To check them, run this inside the extracted folder:

```sh
grep -E '^[0-9a-f]{64}  ' RELEASE-MANIFEST.txt | shasum -a 256 -c
```

## 4. Install

In your own terminal, outside any agent:

```sh
kirocrew app install ./specter-arena-VERSION-SHA12
```

Or use App Store, Manage app sources, Install from Path in the dashboard. The dashboard string reads "Developer install of a local app directory (equivalent to `kirocrew app install <path>`)" (`sourcesPopover.install_from_path`).

Result: the app is installed, disabled and not yet trusted, and nothing is running. The CLI prints "Run: kirocrew app enable" (`install_app`; `cli_commands_app._handle_app`). Installing a name that is already installed is refused; update it instead (section 8).

Crew copies the whole folder without building anything. It skips only `node_modules`, `.git`, `__pycache__`, `.venv` and its own bookkeeping names (`manager_tree._COPY_IGNORE`) and has no size limit. The artifact therefore ships the built `ui/dist/index.mjs`; the README states that Crew does not build apps.

## 5. Trust and enable

Open Apps, then Library, then Specter Arena. Locally installed apps appear in Library, not Discover (`docs/compatibility/host-facts.json`, fact "Where does a locally installed third-party app appear", evidence L2).

The dashboard shows a modal titled "Trust "..." to run its own code?". It says trust covers this app only, and that the app runs its own code in Crew's process with Crew's access, keeps a background program running and runs shell commands from a list the app ships. Crew cannot limit it to less. Choose "Trust this app and enable". Cancel changes nothing (`trustAppModal.*` strings in the Crew dashboard bundle).

This click is the consent click. The permissions Specter Arena declares in `app.json` are recorded as approved at install time, so there is no separate approve click on a first install (`install_app`, whose comment reads "Installing is the consent moment"). The declared permissions are:

| Kind | Entry |
|---|---|
| API | `/apps/specter-arena/api/*`, `/api/agents` |
| Event | `slots:user` |

"Approve new permissions" appears only after an update that adds entries (`update_app`; the `approve_new_permissions` string).

The modal wording, the permissions view and the re-enable behavior on 0.12.2 are read from Crew's source and dashboard strings, to be confirmed in OA-6 (#133).

To revoke trust later, use Settings, Security, Third-party apps. The dashboard says removing trust also switches the app off (`security_trusted_apps.py`).

## 6. Check it works

- The page opens at `/apps/specter-arena` in the Crew dashboard.
- The first enable can take longer while Python packages download (`provisioning.py`).
- The backend answers `/health` (`app.json` `backend.healthCheck`).
- With no bots, the roster is empty. With bots, each appears with a plain condition: "Working", "Waiting on you", "No turn running" or "Unknown". "Waiting on you" is read from Crew 0.13.0 source and not live-tested (KL-21).
- "Blocked" is not an observable bot state, so the app never shows it for a bot.
- A new bot shows "No Specter yet" until you assign one (section 7).
- The arena is a read-only view of what the app observed. XP appears there when a task ends cleanly (section 7).

## 7. Specters, tasks and XP

**Assigning a Specter is your step.** A new bot starts with no Specter. The first time you open the app after a bot appears, a dialog walks you through the unassigned bots: for each you pick one of the 11 fixed heroes (the ones held least often are listed first), or press "Randomize all unassigned". You can skip a bot and assign it later from the Specters tab ("Assign Specters (N)"), the Roster or the bot's own Specter tab. An assignment is final: there is no reassign and no un-assign. A hero's name, epithet and personality are fixed and ship with the app. You change only the avatar, under Roster, the bot, then Specter: pick a bundled portrait, upload a PNG, or reset to the hero portrait. No model is called and nothing is billed. Bots that already had a hero in an earlier build keep it. A bot with no Specter is not drawn on the Arena, and the Arena rail lists it under "No Specter yet".

**The Specters tab** is a showcase of the 11 heroes: a large idle sprite, the epithet and personality, Attack and Cast preview buttons (off when the OS asks for reduced motion), and a list of the bots that hold the hero. It also links to the hero's optional avatar pack on GitHub. The packs are not in the release artifact. Importing one into Crew is done in your own Crew dashboard (Avatar, Customize, Library, Import), and the app never does it.

**Tasks and XP are automatic.** The app builds a task from each worker session a bot starts, and from a bot's own turn once it has run 60 seconds. The Arena draws each task as a minion, small, medium or large by run time (under 2 minutes, under 15 minutes, 15 minutes or more). Size is for looks only. When a task ends cleanly, and the app was watching the whole time, with no approval or question pending at the end, it is "Credited" and its bot earns 10 XP plus 1 XP for each full 2 minutes of run time, at most 30 (`xp-policy-2`). Otherwise it is "Not credited", with one of three reasons: the end could not be read, a collection gap overlapped it, or something was waiting on you at the end. Nobody accepts anything, and there is no Work tab. XP follows what the app observed. It is not a check that the outcome was right. Tokens are never XP. XP from manual acceptance in earlier builds stays as history.

## 8. Update

1. Extract the newer artifact to a new folder, or replace the old folder.
2. In your own terminal run `kirocrew app update specter-arena --source ./NEW-FOLDER`. The Crew gateway must be running; otherwise the CLI says "No running gateway answered, so nothing was updated". The Update button on the app card does the same.

`update_app` does not compare version numbers, so any artifact can be applied. Without `--source`, Crew uses the recorded source folder, so do not delete the folder you installed from.

Crew stops the app, deregisters it, replaces its files, registers it again and restarts it (`handle_update_app`). Trust, the enabled state, approved permissions and `data/` carry over. Permissions the new version adds stay off until you press "Approve new permissions".

The app migrates its own database on the next backend start. First it copies the database to `data/store/backups/pre-migrate-vN-to-vM-STAMP.db` and keeps the newest 3 copies (`backend/specter_arena/store/backup.py`, `KEEP_PRE_MIGRATION`). Do not install an older release over a newer one: the store refuses a database whose schema is newer than the code (`SchemaNewer`, `store/migrate.py`).

## 9. Disable and re-enable

Use the Library toggle, or `kirocrew app disable specter-arena` and `kirocrew app enable specter-arena`.

While disabled, the backend is stopped and the page shows "Enable this app from Apps to use it." (observed on Crew 0.12.0: `docs/compatibility/evidence/L2/run-log.md`). Trust and data stay. Re-enabling does not ask for trust again, because the grant is still stored (`enable_app`); the page and backend return. On 0.12.0 the backend recovered after re-enable (the "Re-enable, press" row of that log). Re-enable on 0.12.2 is to be confirmed in OA-6 (#133).

## 10. Uninstall and data retention

`kirocrew app uninstall specter-arena`, or Uninstall on the app card, withdraws trust first, stops the backend and removes the app folder except `data/` (`uninstall_app`). Python packages Crew provisioned under `data/.kirocrew-deps*` are removed.

What stays:

| Item | Location | After a default uninstall |
|---|---|---|
| Database (Specters, tasks, XP, earlier work items) | `~/.kiro/crew/apps/specter-arena/data/store/specter-arena.db`, with `-wal` and `-shm` files while in use | Kept |
| Backups (pre-migration, pre-purge, pre-cleanup) | `~/.kiro/crew/apps/specter-arena/data/store/backups/` | Kept |
| Exports from the Data tab | `~/.kiro/crew/apps/specter-arena/data/exports/` | Kept |
| Provisioned Python packages | `data/.kirocrew-deps*` | Removed |
| The rest of the app folder | `~/.kiro/crew/apps/specter-arena/` | Removed |

(`backend/specter_arena/store/location.py`: `DB_FILENAME`, `STORE_DIRNAME`, `BACKUPS_DIRNAME`.)

Reinstalling restores your Specters, tasks and XP, asks for trust again and starts disabled (`install_app` preserves `data/`).

To remove everything, run `kirocrew app uninstall specter-arena --purge-data`. This deletes the whole folder including the database, the backups and `data/exports/`, and cannot be undone. To keep a copy first, stop the app (disable it), then copy the whole `data` folder, not only the `.db` file. Recent writes can sit in the `-wal` file beside it:

```sh
cp -R ~/.kiro/crew/apps/specter-arena/data BACKUP-FOLDER
```

What is kept, what shrinks, how to restore and what a restore loses: `docs/release/data-and-recovery.md`.

## 11. Building the artifact (maintainers)

Install the locked dependencies, then build from a commit:

```sh
npm ci
npm run package -- --commit COMMIT
```

`--commit` defaults to `HEAD`. The commit must be reachable from a branch or tag of the repository. The output goes to `.release/`, which git ignores: `specter-arena-VERSION-SHA12.tar.gz` and its `.sha256` sidecar. `--out DIR` writes elsewhere, outside the repository.

The script clones the commit with `git clone --no-local` into a temporary directory, runs `npm ci` and `npm run build` there, and packs only the files git tracks at that commit plus the built `ui/dist/index.mjs`. Uncommitted, untracked and ignored files in your working tree cannot enter the artifact. It needs the Node major in `.nvmrc`, and `app.json` and `package.json` must carry the same x.y.z version.

The build fails with exit code 1, and writes no file, when it finds any of these:

- an env file other than `.env.example`, a probe artifact (`.probe-*`), a `data/` directory or a database file;
- a QA art file (light/dark check images, reference crops, roster reference sheets, `-master.png` files);
- preview or diagnostic build output, CDK output, a previous `.release/` output;
- a dependency, cache or report directory (`node_modules`, `.venv`, `.deps`, `coverage`, `playwright-report`, `test-results`, `__pycache__`, tool caches), a `.pyc`, `.coverage` or `.DS_Store` file;
- a credential-shaped file name (`id_rsa*`, `.pem`, `.key`, `.p12`);
- a symlink, a submodule, or a path that is not plain ASCII or is too long for the tar format;
- a fixture or diagnostic marker in the build, the probe switch file in the release tree, or any file in `ui/dist` other than `index.mjs`.

The tarball is deterministic for one commit and one toolchain: sorted entries, fixed owner 0/0 with no names, commit time as modification time. Do not rely on identical bytes across machines, because a different Vite or npm version can change `index.mjs`. `RELEASE-MANIFEST.txt` inside the artifact lists the commit, version, Node and npm versions and one line per file in the form `64-hex-sha256`, two spaces, `path`, which the check in section 3 reads. The `.sha256` sidecar covers the uploaded file.

The script never tags, uploads or publishes. Eric alone tags the release, uploads the artifact and submits.

## 12. Building from a git clone instead

```sh
npm ci && npm run build
kirocrew app install .
```

A plain clone is not the supported route for judges. Crew's registry path runs `npm install`, not `npm ci` (`kiro_crew/apps/registry.py`, `_run_app_build`), and a local-path install does not build at all, so you must build first. This route needs Node and npm at the versions in `.nvmrc` and `package.json` `engines`.

## 13. Troubleshooting

| Symptom | Cause and action |
|---|---|
| "third-party app execution is disabled; trust this app alone from the dashboard's App Store ..." | The app is not trusted. Do the Trust step in section 5 (`execution._execution_admission`) |
| "already installed" on install | Update it instead (section 8), or uninstall first |
| Update fails because the source folder is gone | Recreate the folder, or pass `--source` with the new folder |
| "could not verify this process as the local owner" | You ran the command from an agent shell. Run it in your own terminal (`docs/compatibility/crew-0.12.2.md`, "Install method") |
| App starts, then reports a newer schema (`SchemaNewer`) | You installed an older release over a newer database. Install the newer release, or restore a `pre-migrate` backup (steps: `docs/release/data-and-recovery.md`, section 5) |
| First enable hangs or fails | PyPI is unreachable. Connect and enable again |

## 14. Privacy

The app stores only what `docs/compatibility/monitoring-scope.md` allows. It reads bot names and the scope described there, and never a bot's memory or notes. See that file for the exact rules; this page does not restate them.

The Specters tab sends nothing to any model. A hero's text is fixed and shipped with the app. The only outside address the app offers is the link to a hero's avatar pack on GitHub, which opens when you click it.

Threats considered and what is disclosed: `docs/release/threat-model.md`.
