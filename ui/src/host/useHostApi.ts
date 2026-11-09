import { useAppApi } from '@kirocrew/app-sdk';
import { useMemo } from 'react';

/** Plain-data view of the host API; the SDK client itself never leaves this module. */
export interface HostApi {
  getJson<T>(path: string): Promise<T>;
  postJson<T>(path: string, body: unknown): Promise<T>;
}

function isResponseLike(value: unknown): value is Pick<Response, 'ok' | 'status' | 'json'> {
  return typeof value === 'object' && value !== null && 'ok' in value && typeof (value as Response).json === 'function';
}

// The host client's resolved shape is confirmed live in FP-01; a fetch Response is
// checked for success, any other resolved value is already parsed data.
async function unwrap<T>(pending: Promise<unknown>): Promise<T> {
  const result = await pending;
  if (!isResponseLike(result)) return result as T;
  if (!result.ok) throw new Error(`Request failed with status ${result.status}`);
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
