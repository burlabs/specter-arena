import os
import subprocess
import sys
from pathlib import Path

import starlette

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_backend_app_imports_the_way_crew_starts_it() -> None:
    # PYTHONPATH holds only the third-party deps, -s drops user site-packages, and cwd is
    # the repo root: the same import roots Crew gives the backend. An absolute
    # `import specter_arena` in app.py would fail here even if a dev venv masked it.
    deps_dir = str(Path(starlette.__file__).resolve().parents[1])
    env = {key: value for key, value in os.environ.items() if not key.startswith("PYTHON")}
    env["PYTHONPATH"] = deps_dir
    result = subprocess.run(
        [
            sys.executable,
            "-s",
            "-c",
            "import backend.app as m; print(type(m.app).__name__)",
        ],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "Starlette"
