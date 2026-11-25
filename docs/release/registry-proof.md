# Registry install proof harness

This page records how to run Kiro Crew's own registry install code against a local copy of this repository, in a throwaway Crew home. It proves what Crew does with `app-registry.json` and the build step without touching a real Crew install. It is not a CI job, because it needs the Crew desktop app's bundled Python.

Tested on Kiro Crew 0.13.1 (macOS, arm64). Crew 0.12.x was not run. The owner sitting in `docs/release/oa-5-runbook.md` ("RC-7 single sitting", Part C, registry install) is the check on a real Crew.

## What it proves

| Run | PATH | Expected result |
|---|---|---|
| With Node | Node 22 or newer first | The registry lists one app, `npm install` and `npm run build` run, and the installed tree contains `ui/dist/index.mjs` |
| Without Node | `/usr/bin:/bin` | Crew logs `npm not found on PATH — skipping JavaScript build step`, then `No build step detected — using source as-is`, reports `installed specter-arena`, and the installed tree has no `ui/dist` |

| Repair | Node 22 or newer first, in the home from the without-Node run | Crew reports `updated specter-arena v0.1.0 -> v0.1.0`, runs `npm install` and `npm run build`, and `ui/dist/index.mjs` now exists |

The second run is the documented failure case and the third is its documented fix (`docs/release/install.md`, section 2A). The repair run is the same harness command as the with-Node run, pointed at the same home as the without-Node run.

## Safety rules

- `KIROCREW_HOME` MUST point at a new temporary folder. Never point it at `~/.kiro/crew`.
- `sandbox_allow_unsandboxed_exec` and `apps_allow_third_party` are set only in the throwaway `config.json`. They are needed because the harness can nest inside another sandbox and installs an app that is not in Crew's trusted list. Do not set them in a real config for this.
- The git daemon serves a copy of the repository on `127.0.0.1` only.

## Steps

Run from the repository root with the commit you want to test checked out. `PY` is the Python bundled with the Crew desktop app, which has the `kiro_crew` package. The commit is copied into the local repository as `main`, because Crew installs the branch named in the registry entry.

```sh
PY=/Applications/KiroCrew.app/Contents/Resources/backend-dist/kirocrew-backend-arm64/bin/python3
WORK=$(mktemp -d)
git init --bare --initial-branch=main "$WORK/git/specter-arena.git"
git -C "$WORK/git/specter-arena.git" fetch "$PWD" HEAD:refs/heads/main
git daemon --reuseaddr --export-all --base-path="$WORK/git" --listen=127.0.0.1 --port=9418 &
```

Write the harness script. It lists the registry, installs the app and prints Crew's install log.

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
```

The committed `app-registry.json` names `https://github.com/burlabs/specter-arena`, and Crew clones the URL in the entry, so a test of an unmerged commit would build GitHub's `main` instead. Add one harness-only commit in a scratch clone of the local copy that rewrites the two URL keys to `git://127.0.0.1:9418/specter-arena.git`, and push that commit as `main` to the local copy. Nothing else changes, and nothing is committed back to this repository.

Create one throwaway home per run and give it the registry entry.

```sh
for run in with-node without-node; do
  PH="$WORK/home-$run"; mkdir -p "$PH"
  cat > "$PH/config.json" <<'EOF'
{
  "agent": { "sandbox_allow_unsandboxed_exec": true, "apps_allow_third_party": true },
  "registries": [{ "name": "specter-local", "repo": "git://127.0.0.1:9418/specter-arena.git", "branch": "main" }]
}
EOF
done
```

Run with Node 22 or newer on the PATH, then with a bare PATH. The Python interpreter is called by absolute path, so the bare PATH does not hide it.

```sh
PH="$WORK/home-with-node" PATH="$(dirname "$(command -v node)"):/usr/bin:/bin" "$PY" "$WORK/install.py" | tee "$WORK/with-node.log"
PH="$WORK/home-without-node" PATH="/usr/bin:/bin" "$PY" "$WORK/install.py" | tee "$WORK/without-node.log"
```

Check the installed trees, then stop the daemon and delete `$WORK`.

```sh
ls -l "$WORK/home-with-node/apps/specter-arena/ui/dist/index.mjs"
ls "$WORK/home-without-node/apps/specter-arena/ui/"
kill %1
```

## Notes

- Crew allows 600 seconds for each build command. A first install downloads the dev dependencies that the Vite build needs, so allow a few minutes.
- `npm install` may rewrite `package-lock.json` inside Crew's clone. Nothing is committed back.
- The harness installs whatever commit you fetched as `main` into the local copy, so it tests a pull request head before merge.
- Backend start, UI load, the sidebar entry and the trust click are not covered. They belong to the owner sitting.
