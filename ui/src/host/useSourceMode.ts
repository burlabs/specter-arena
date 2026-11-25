import { useHostApi } from './useHostApi';
import type { HostSourceMode } from './useHostApi';

export type SourceMode = HostSourceMode | 'RECORDED';

/** FIXTURE only when the aliased fixture client says so; the installed host's client has no such property. */
export function useSourceMode(): SourceMode {
  return useHostApi().mode;
}
