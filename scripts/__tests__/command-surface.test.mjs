import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/** @type {{ engines: { node: string }, scripts: Record<string, string> }} */
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const scripts = pkg.scripts;

const ADAPTER_KEYS = [
  'docs.specSource',
  'docs.provider',
  'tracker.provider',
  'vcs.provider',
  'build.command',
  'ci.checks',
  'ci.checks.coverage',
];

const CI_CHECKS = [
  'lint',
  'typecheck',
  'test',
  'coverage',
  'secret-scan',
  'provenance',
  'lockfile-linux',
  'lock-agreement',
  'backend-smoke',
  'cdk-synth',
  'build',
  'fixtures',
  'e2e-smoke',
];

const CURRENT_JOBS = CI_CHECKS;

/**
 * npm commands referenced in a markdown document, skipping any section whose
 * heading says "Planned": those name commands that later PRs add.
 * @param {string} markdown
 */
function referencedCommands(markdown) {
  /** @type {Set<string>} */
  const commands = new Set();
  let planned = false;
  for (const line of markdown.split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) planned = /planned/i.test(heading[1] ?? '');
    if (planned) continue;
    for (const match of line.matchAll(/\bnpm (?:run ([\w:-]+)|(test))\b/g)) commands.add(match[1] ?? match[2] ?? '');
  }
  return commands;
}

/** @param {string} path */
const read = (path) => readFileSync(path, 'utf8');

describe('package.json command surface', () => {
  it('points every node script at a file that exists', () => {
    for (const [name, command] of Object.entries(scripts)) {
      for (const match of command.matchAll(/\bnode (?:--[\w-]+(?:=\S+)? )*(scripts\/\S+)/g)) {
        assert.ok(existsSync(match[1] ?? ''), `${name} runs missing ${match[1]}`);
      }
    }
  });

  it('declares the full FP-00 command surface', () => {
    for (const name of ['build', 'build:preview', 'lint', 'typecheck', 'test', 'coverage', 'test:e2e', 'check:lock', 'check:fixtures', 'check:provenance', 'dev']) {
      assert.ok(name in scripts, `missing script ${name}`);
    }
    assert.match(scripts.build ?? '', /vite build --config ui\/vite\.config\.ts/);
  });

  it('enforces 90% line coverage on scripts/', () => {
    assert.match(scripts.coverage ?? '', /--test-coverage-lines=90\b/);
    assert.match(scripts.coverage ?? '', /--test-coverage-include=scripts\/\*\.mjs/);
  });

  it('keeps .nvmrc and engines.node on the same major', () => {
    const nvmrc = read('.nvmrc').trim();
    const engineMajor = /(\d+)/.exec(pkg.engines.node)?.[1];
    assert.equal(nvmrc, engineMajor);
  });
});

describe('documentation references', () => {
  for (const doc of ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/development/adapters.md']) {
    it(`${doc} references only commands that exist`, () => {
      for (const command of referencedCommands(read(doc))) {
        assert.ok(command in scripts, `${doc} references npm ${command}, which package.json does not define`);
      }
    });
  }

  it('maps every adapter key and lists all 13 CI checks', () => {
    const adapters = read('docs/development/adapters.md');
    for (const key of ADAPTER_KEYS) assert.ok(adapters.includes(`| \`${key}\` |`), `adapters.md is missing ${key}`);
    for (const job of CI_CHECKS) assert.ok(adapters.includes(`| \`${job}\` |`), `adapters.md is missing job ${job}`);
  });

  it('branch-protection step 2 re-PUTs step 1 plus exactly the 13 GitHub Actions checks', () => {
    const protection = read('docs/ops/branch-protection.md');
    /** @param {string} heading */
    const section = (heading) => {
      const start = protection.indexOf(heading);
      const next = protection.indexOf('\n## ', start + heading.length);
      return protection.slice(start, next === -1 ? undefined : next);
    };
    /** @param {string} text */
    const body = (text) => JSON.parse(/<<'JSON'\n([\s\S]*?)\nJSON/.exec(text)?.[1] ?? 'null');
    const step1 = section('## Step 1');
    const step2 = section('## Step 2');
    assert.match(step2, /gh api -X PUT repos\/burlabs\/specter-arena\/branches\/main\/protection \\/);
    const { required_status_checks: checks, ...rest } = body(step2);
    const step1Body = body(step1);
    assert.equal(step1Body.required_status_checks, null);
    delete step1Body.required_status_checks;
    assert.deepEqual(rest, step1Body);
    assert.equal(checks.strict, true);
    assert.deepEqual(
      checks.checks,
      CI_CHECKS.map((context) => ({ context, app_id: 15368 })),
    );
  });

  it('links the adapter mapping from AGENTS.md', () => {
    assert.ok(read('AGENTS.md').includes('docs/development/adapters.md'));
  });
});

describe('PR template', () => {
  const template = read('.github/pull_request_template.md');

  it('has a home for every Required-Core section', () => {
    for (const heading of ['Context', 'Summary', 'Acceptance Criteria', 'Risk', 'References', 'Testing', 'Revisions']) {
      assert.match(template, new RegExp(`^## ${heading}$`, 'm'), `missing ## ${heading}`);
    }
  });

  it('asks for the issue link and the ephemeral dev environment', () => {
    assert.match(template, /^- Issue:/m);
    assert.match(template, /^- Ephemeral dev environment:/m);
  });
});

describe('ci.yml', () => {
  const ci = read('.github/workflows/ci.yml');
  const jobsSection = ci.slice(ci.indexOf('\njobs:\n'));
  const jobs = [...jobsSection.matchAll(/^ {2}([\w-]+):\s*$/gm)].map((match) => match[1]);

  it('defines exactly the jobs landed so far, each with a timeout', () => {
    assert.deepEqual(jobs, CURRENT_JOBS);
    assert.equal(ci.match(/timeout-minutes:/g)?.length, CURRENT_JOBS.length);
  });

  it('starts the backend smoke test the way Crew does', () => {
    assert.match(ci, /pip install --require-hashes --target \.deps -r requirements\.txt/);
    assert.match(ci, /PYTHONPATH=\.deps python -s -m uvicorn backend\.app:app --host 127\.0\.0\.1/);
  });

  it('verifies the gitleaks checksum before running it', () => {
    assert.ok(ci.indexOf('sha256sum -c') < ci.indexOf('./gitleaks git'));
  });

  it('never uses pull_request_target', () => {
    assert.equal(ci.includes('pull_request_target'), false);
  });

  it('installs both npm locks on Linux and synthesizes the preview stack offline', () => {
    assert.match(ci, /run: npm ci\n\s+working-directory: infra/);
    assert.match(ci, /cdk-synth:[\s\S]*run: npm run synth[\s\S]*run: npm test/);
    assert.equal(/aws-actions\/configure-aws-credentials/.test(ci), false);
  });
});

describe('preview workflows', () => {
  for (const file of ['.github/workflows/preview.yml', '.github/workflows/preview-cleanup.yml']) {
    const workflow = read(file);

    it(`${file} runs only for same-repository PRs in the preview environment`, () => {
      assert.equal(workflow.includes('pull_request_target'), false);
      assert.match(workflow, /if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
      assert.match(workflow, /environment: preview/);
      assert.match(workflow, /id-token: write/);
    });

    it(`${file} skips with a notice when the preview variables are unset`, () => {
      assert.match(workflow, /if \[ -z "\$PREVIEW_ROLE_ARN" \]/);
      assert.match(workflow, /::notice title=Preview[^:]*::preview infrastructure not configured/);
      assert.match(workflow, /configured=false/);
    });
  }

  it('posts a URL only after a successful upload, built from the configured domain', () => {
    const preview = read('.github/workflows/preview.yml');
    const upload = preview.indexOf('aws s3 sync ui/preview-dist');
    const comment = preview.indexOf('gh pr comment');
    assert.ok(upload > 0 && comment > upload);
    assert.match(preview, /url="https:\/\/\$\{PREVIEW_DOMAIN\}\/pr-\$\{PR_NUMBER\}\/"/);
    assert.equal((preview.match(/https:\/\//g) ?? []).length, 1);
  });
});
