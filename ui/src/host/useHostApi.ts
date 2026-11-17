import { useAppApi } from '@kirocrew/app-sdk';
import { useMemo } from 'react';

/** Plain-data view of the host API; the SDK client itself never leaves this module. */
export interface HostApi {
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

async function errorCodeOf(response: Pick<Response, 'json'>): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
    return typeof code === 'string' && ERROR_CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}

function isResponseLike(value: unknown): value is Pick<Response, 'ok' | 'status' | 'json'> {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof (value as Response).json === 'function';
}

// The host client's resolved shape is confirmed live in FP-01; a fetch Response is
// checked for success, any other resolved value is already parsed data.
async function unwrap<T>(pending: Promise<unknown>): Promise<T> {
  const result = await pending;
  if (!isResponseLike(result)) return result as T;
  if (!result.ok) throw new HostApiError(result.status, await errorCodeOf(result));
  if (result.status === 204) return undefined as T;
  return (await result.json()) as T;
}

export function useHostApi(): HostApi {
  const client = useAppApi();
  return useMemo(
    () => ({
      getJson: <T>(path: string) => unwrap<T>(client.get(path)),
      postJson: <T>(path: string, body: unknown) => unwrap<T>(client.post(path, body)),
    }),
    [client],
  );
}
