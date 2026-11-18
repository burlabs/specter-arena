import { useAppApi } from '@kirocrew/app-sdk';
import { useMemo } from 'react';

/** What the host seam can tell: the installed host is LIVE; only the fixture SDK reports FIXTURE. */
export type HostSourceMode = 'LIVE' | 'FIXTURE';

/** Plain-data view of the host API; the SDK client itself never leaves this module. */
export interface HostApi {
  readonly mode: HostSourceMode;
  getJson<T>(path: string): Promise<T>;
  postJson<T>(path: string, body: unknown): Promise<T>;
}

/** A non-2xx reply. `error` is the `api-error.v1` code when the body carried one. */
export class HostApiError extends Error {
  readonly status: number;
  readonly error: string | null;

  constructor(status: number, error: string | null) {
    super(`Request failed with status ${status}`);
    this.name = 'HostApiError';
    this.status = status;
    this.error = error;
  }
}

const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

function codeOfBody(body: unknown): string | null {
  const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : null;
}

async function errorCodeOf(response: Pick<Response, 'json'>): Promise<string | null> {
  try {
    return codeOfBody(await response.json());
  } catch {
    return null;
  }
}

/**
 * The installed SDK client resolves parsed JSON and throws an `ApiError` carrying an integer `status` and the
 * raw body text on a non-2xx. Converting it makes the `HostApiError` branches work on a real install. A throw
 * without a status (a permission error, a network failure) is left alone.
 */
function hostErrorOf(error: unknown): HostApiError | null {
  if (error instanceof HostApiError) return error;
  if (typeof error !== 'object' || error === null) return null;
  const { status, body } = error as { status?: unknown; body?: unknown };
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) return null;
  let parsed: unknown = null;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
  }
  return new HostApiError(status, codeOfBody(parsed));
}

function isResponseLike(value: unknown): value is Pick<Response, 'ok' | 'status' | 'json'> {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof (value as Response).json === 'function';
}

// The host client's resolved shape is confirmed live in FP-01; a fetch Response is
// checked for success, any other resolved value is already parsed data.
async function unwrap<T>(pending: Promise<unknown>): Promise<T> {
  let result: unknown;
  try {
    result = await pending;
  } catch (error) {
    throw hostErrorOf(error) ?? error;
  }
  if (!isResponseLike(result)) return result as T;
  if (!result.ok) throw new HostApiError(result.status, await errorCodeOf(result));
  if (result.status === 204) return undefined as T;
  return (await result.json()) as T;
}

export function useHostApi(): HostApi {
  const client = useAppApi();
  return useMemo(
    () => ({
      mode: client.sourceMode === 'FIXTURE' ? ('FIXTURE' as const) : ('LIVE' as const),
      getJson: <T>(path: string) => unwrap<T>(client.get(path)),
      postJson: <T>(path: string, body: unknown) => unwrap<T>(client.post(path, body)),
    }),
    [client],
  );
}
