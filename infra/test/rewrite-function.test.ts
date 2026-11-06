import { describe, expect, it } from 'vitest';
import { REWRITE_FUNCTION_CODE } from '../lib/rewrite-function.ts';

type Handler = (event: { request: { uri: string } }) => { uri: string };

const handler = new Function(`${REWRITE_FUNCTION_CODE}\nreturn handler;`)() as Handler;

const rewrite = (uri: string) => handler({ request: { uri } }).uri;

describe('index rewrite function', () => {
  it('serves index.html for a PR directory with a trailing slash', () => {
    expect(rewrite('/pr-12/')).toBe('/pr-12/index.html');
  });

  it('serves index.html for a bare PR path', () => {
    expect(rewrite('/pr-12')).toBe('/pr-12/index.html');
  });

  it('serves index.html for nested directories', () => {
    expect(rewrite('/pr-12/assets/')).toBe('/pr-12/assets/index.html');
  });

  it('leaves file requests alone', () => {
    expect(rewrite('/pr-12/assets/main.js')).toBe('/pr-12/assets/main.js');
    expect(rewrite('/pr-12/index.html')).toBe('/pr-12/index.html');
  });

  it('does not rewrite paths that only look like PR prefixes', () => {
    expect(rewrite('/pr-abc')).toBe('/pr-abc');
    expect(rewrite('/other')).toBe('/other');
  });
});
