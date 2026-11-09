declare module '@kirocrew/app-sdk' {
  export interface AppApiClient {
    get(path: string, init?: RequestInit): Promise<unknown>;
    post(path: string, body?: unknown, init?: RequestInit): Promise<unknown>;
  }

  export function useAppApi(): AppApiClient;
}
