# Registry install proof harness

This page records how to run Kiro Crew's own registry install code against a local copy of the `release` branch, in a throwaway Crew home. It proves what Crew does with the branch's `app-registry.json` and its install step without touching a real Crew install. It is not a CI job, because it needs the Crew desktop app's bundled Python. CI covers the branch contents instead (job `release-branch`, `docs/development/adapters.md`).

Tested on Kiro Crew 0.13.1 (macOS, arm64) for FP-28. Crew 0.12.x was not run. The owner sitting in `docs/release/oa-5-runbook.md` (Part C, registry install) is the check on a real Crew and the gateway process.

## What it proves

| Run | PATH | Result |
|---|---|---|
| Install the `release` branch | `/usr/bin:/bin` (no Node) | The registry lists one app on branch `release`. Install reports `installed specter-arena v0.1.0`, the installed tree has `ui/dist/index.mjs` (321,125 bytes) and no `package.json`, and Crew logs no npm line |
| Backend | the bundled Python, dependencies from `requirements.txt` | Started the way CI does (`python -s -m uvicorn backend.app:app` from the installed tree). `/health` returned `200 {"status":"ok"}` and the log has no "UI bundle not found" warning |
| Update to a second release commit | `/usr/bin:/bin` | `updated specter-arena v0.1.0 -> v0.1.1`, a fast-forward of the clone, `ui/dist/index.mjs` still present, no `package.json`, `/health` still OK |
| `main` without an index | `/usr/bin:/bin` | Typing a branch with no `app-registry.json` and no `apps/*/app.json` in Add Registry gives "Failed to load external registry" and an empty list. This is why `main` carries no index |
| `main` with an index (the old state) | `/usr/bin:/bin` | Listed, then installed from source with no build and no `ui/dist` (FP-26 planner evidence: no `ui/dist`, soft failure) |

The throwaway-home install does not cover the running gateway, the UI module load, the sidebar entry or the trust click. Those belong to the owner sitting. The backend was started by hand, not by Crew.

## Safety rules

- `KIROCREW_HOME` MUST point at a new temporary folder. Never point it at `~/.kiro/crew`.
- `sandbox_allow_unsandboxed_exec` and `apps_allow_third_party` are set only in the throwaway `config.json`. They are needed because the harness can nest inside another sandbox and installs an app that is not in Crew's trusted list. Do not set them in a real config for this.
- The git daemon serves a copy of the branch on `127.0.0.1` only. Nothing is pushed to GitHub.
- Crew writes short-lived clone folders under its scratch directory while it lists a registry. They are removed when the fetch ends.

## Steps

`PY` is the Python bundled with the Crew desktop app, which has the `kiro_crew` package. Build the branch in a scratch clone first: check out the commit under test, make `refs/remotes/origin/main` point at it (the script only builds commits that are on `origin/main`), and run `npm ci` and `npm run release:branch`.

```sh
PY=/Applications/KiroCrew.app/Contents/Resources/backend-dist/kirocrew-backend-arm64/bin/python3
WORK=$(mktemp -d)
```

Crew clones the URL inside the entry, and the branch's entry names GitHub. For a test of an unpublished branch, copy the release tip's tree into a bare repository under `$WORK/git/srv-release.git` as a new commit on `release`, rewriting only the `gitUrl` and `repo` values of `app-registry.json` to `git://127.0.0.1:9419/srv-release.git`. Repeat for the second release commit. Nothing else changes and nothing returns to the repository. Serve it:

```sh
git daemon --reuseaddr --export-all --base-path="$WORK/git" --listen=127.0.0.1 --port=9419 &
```

Give a throwaway home the registry entry:

```sh
PH="$WORK/home"; mkdir -p "$PH"
cat > "$PH/config.json" <<'EOF'
{
  "agent": { "sandbox_allow_unsandboxed_exec": true, "apps_allow_third_party": true },
  "registries": [{ "name": "specter-local", "repo": "git://127.0.0.1:9419/srv-release.git", "branch": "release" }]
}
EOF
```

Write the harness script. It lists the registry, installs (or updates) the app and prints Crew's log.

```sh
cat > "$WORK/install.py" <<'EOF'
import asyncio, json, os
os.environ["KIROCREW_HOME"] = os.environ["PH"]
from kiro_crew.apps.registry_pipeline import indexes
from kiro_crew.apps.registry_pipeline.install import install_from_registry

async def main():
    listed = await indexes._load_external_registries()
    print("LISTED:", [(e.get("name"), e.get("_registry"), e.get("branch"), e.get("subdirectory")) for e in listed])
    log = []
    result = await install_from_registry("specter-arena", log)
    print("RESULT:", json.dumps({k: v for k, v in result.items() if k != "log"}, default=str)[:1500])
    print("\n".join(log)[-3500:])

asyncio.run(main())
EOF
PH="$PH" PATH="/usr/bin:/bin" "$PY" "$WORK/install.py"
ls -l "$PH/apps/specter-arena/ui/dist/index.mjs"
test ! -e "$PH/apps/specter-arena/package.json" && echo "no package.json"
```

Run the same install command again after serving the second release commit to see the update. To start the backend, install the pinned requirements into a scratch folder with `"$PY" -m pip install --require-hashes --target DEPS -r requirements.txt`, then run `PYTHONPATH=DEPS "$PY" -s -m uvicorn backend.app:app --host 127.0.0.1 --port 18765` from `$PH/apps/specter-arena` and request `/health`. Stop the daemon and the backend and delete `$WORK` afterwards.

## Notes

- A registry entry on the `release` branch names `branch: release`, but Crew uses the branch the user types for a same-repo entry, so the field is informational (`docs/release/install.md`, section 2A).
- Crew refuses a lower version than the one installed, so a release you want users to receive as an Update needs `app.json` at the same or a higher version.
- Backend start, UI load, the sidebar entry and the trust click are not covered. They belong to the owner sitting.
