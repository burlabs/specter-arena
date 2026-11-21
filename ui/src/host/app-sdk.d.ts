declare module '@kirocrew/app-sdk' {
  export interface AppApiClient {
    get(path: string, init?: RequestInit): Promise<unknown>;
    post(path: string, body?: unknown, init?: RequestInit): Promise<unknown>;
    /** The installed 0.12.x client has `put` (read from the host source); no earlier route of this app used it. */
    put(path: string, body?: unknown, init?: RequestInit): Promise<unknown>;
    /** Present only on the fixture SDK; the installed host client has no such property. */
    readonly sourceMode?: unknown;
  }

  export function useAppApi(): AppApiClient;

  /** Present on Crew 0.12.2 and later; an older host does not export it. */
  export function useNavigate(): (path: string) => void;
}
