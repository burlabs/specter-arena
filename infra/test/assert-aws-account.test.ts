import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PREVIEW_ACCOUNT } from '../lib/preview-config.ts';
import { callerAccount, run } from '../scripts/assert-aws-account.mjs';

function check(getAccount: () => string) {
  const lines: string[] = [];
  const code = run({ getAccount, log: (line: string) => lines.push(line) });
  return { code, lines };
}

describe('assert-aws-account', () => {
  it('passes when the specter-preview profile is the preview account', () => {
    const { code, lines } = check(() => PREVIEW_ACCOUNT);
    expect(code).toBe(0);
    expect(lines).toEqual([`assert-aws-account: profile specter-preview is account ${PREVIEW_ACCOUNT}`]);
  });

  it('refuses any other account', () => {
    const { code, lines } = check(() => '111122223333');
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/is account 111122223333, expected 640822987719; refusing to continue/);
  });

  it('refuses an empty answer', () => {
    expect(check(() => '').lines[0]).toMatch(/is account \(empty\)/);
  });

  it('asks the AWS CLI for the specter-preview caller account', () => {
    const bin = mkdtempSync(join(tmpdir(), 'fake-aws-'));
    const argsFile = join(bin, 'args');
    writeFileSync(join(bin, 'aws'), `#!/bin/sh\necho "$@" > "${argsFile}"\necho " 111122223333 "\n`);
    chmodSync(join(bin, 'aws'), 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${originalPath}`;
    try {
      expect(callerAccount()).toBe('111122223333');
      expect(readFileSync(argsFile, 'utf8').trim()).toBe(
        'sts get-caller-identity --profile specter-preview --query Account --output text',
      );
    } finally {
      process.env.PATH = originalPath;
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it('refuses when the profile cannot be read', () => {
    const { code, lines } = check(() => {
      throw new Error('The config profile (specter-preview) could not be found');
    });
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/cannot read the specter-preview profile: The config profile/);
  });
});
