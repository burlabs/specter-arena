import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PREVIEW_ACCOUNT, PREVIEW_PROFILE } from '../lib/preview-config.ts';

/** @returns {string} the account ID the preview profile's credentials belong to */
export function callerAccount() {
  return execFileSync(
    'aws',
    ['sts', 'get-caller-identity', '--profile', PREVIEW_PROFILE, '--query', 'Account', '--output', 'text'],
    { encoding: 'utf8' },
  ).trim();
}

/**
 * @param {{ getAccount?: () => string, log?: (line: string) => void }} [options]
 * @returns {number} process exit code
 */
export function run({ getAccount = callerAccount, log = console.log } = {}) {
  let account;
  try {
    account = getAccount();
  } catch (error) {
    log(`assert-aws-account: cannot read the ${PREVIEW_PROFILE} profile: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (account !== PREVIEW_ACCOUNT) {
    log(`assert-aws-account: profile ${PREVIEW_PROFILE} is account ${account || '(empty)'}, expected ${PREVIEW_ACCOUNT}; refusing to continue`);
    return 1;
  }
  log(`assert-aws-account: profile ${PREVIEW_PROFILE} is account ${PREVIEW_ACCOUNT}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run();
}
