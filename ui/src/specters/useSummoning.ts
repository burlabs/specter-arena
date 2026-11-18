import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpecterV1, SummoningBudgetV1, SummoningV1 } from '../contracts/types';
import { HostApiError, summoningActionPath, summoningPath, summoningsPath, useHostApi } from '../host';
import { isActive, newRequestId, readResume, writeResume } from './model';

export const SUMMONING_POLL_MS = 1500;
export const SUMMONING_GIVE_UP_MS = 100_000;
export const MAX_POLL_FAILURES = 3;

export type SummoningPhase =
  | { phase: 'idle' }
  | { phase: 'starting'; requestId: string }
  | { phase: 'active'; request: SummoningV1 }
  | { phase: 'done'; request: SummoningV1 }
  | { phase: 'lost'; requestId: string; why: 'timeout' | 'unreachable' }
  | { phase: 'error'; code: string };

export interface StartInput {
  purpose: string;
  style: string;
  keep: readonly string[];
}

export interface Summoning {
  state: SummoningPhase;
  budget: SummoningBudgetV1 | null;
  start: (input: StartInput) => Promise<void>;
  cancel: () => Promise<void>;
  accept: (expectedVersion: number) => Promise<SpecterV1 | null>;
  discard: () => void;
  checkAgain: () => Promise<void>;
  clearError: () => void;
}

const codeOf = (error: unknown): string => (error instanceof HostApiError ? (error.error ?? `http_${error.status}`) : 'offline');

const STARTABLE = new Set<SummoningPhase['phase']>(['idle', 'done', 'error', 'lost']);

export function useSummoning(bindingId: string | null): Summoning {
  const api = useHostApi();
  const [state, setState] = useState<SummoningPhase>({ phase: 'idle' });
  const [budget, setBudget] = useState<SummoningBudgetV1 | null>(null);
  const phaseRef = useRef<SummoningPhase>(state);
  const epoch = useRef(0);
  const retryId = useRef<string | null>(null);
  const startedAt = useRef(0);

  const go = useCallback((next: SummoningPhase) => {
    phaseRef.current = next;
    setState(next);
  }, []);

  const settle = useCallback(
    (record: SummoningV1) => {
      setBudget(record.budget);
      if (isActive(record.status)) {
        go({ phase: 'active', request: record });
        return;
      }
      if (record.status !== 'ready') writeResume(record.bindingId, null);
      go({ phase: 'done', request: record });
    },
    [go],
  );

  useEffect(() => {
    epoch.current += 1;
    retryId.current = null;
    setBudget(null);
    go({ phase: 'idle' });
    const requestId = bindingId === null ? null : readResume(bindingId);
    if (bindingId === null || requestId === null) {
      return () => {
        epoch.current += 1;
      };
    }
    let live = true;
    startedAt.current = Date.now();
    go({ phase: 'starting', requestId });
    api.getJson<SummoningV1>(summoningPath(requestId)).then(
      (record) => {
        if (!live) return;
        if (record.bindingId !== bindingId) {
          writeResume(bindingId, null);
          go({ phase: 'idle' });
          return;
        }
        settle(record);
      },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof HostApiError && error.error === 'unknown_request') {
          writeResume(bindingId, null);
          go({ phase: 'idle' });
          return;
        }
        go({ phase: 'lost', requestId, why: 'unreachable' });
      },
    );
    return () => {
      live = false;
      epoch.current += 1;
    };
  }, [api, bindingId, go, settle]);

  const activeId = state.phase === 'active' ? state.request.requestId : null;
  useEffect(() => {
    if (activeId === null) return;
    let stopped = false;
    let failures = 0;
    let waitingForVisible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      timer = setTimeout(() => void tick(), SUMMONING_POLL_MS);
    };
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - startedAt.current > SUMMONING_GIVE_UP_MS) {
        go({ phase: 'lost', requestId: activeId, why: 'timeout' });
        return;
      }
      if (document.visibilityState === 'hidden') {
        waitingForVisible = true;
        return;
      }
      try {
        const next = await api.getJson<SummoningV1>(summoningPath(activeId));
        if (stopped || next.requestId !== activeId) return;
        failures = 0;
        settle(next);
        if (isActive(next.status)) schedule();
      } catch {
        if (stopped) return;
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) go({ phase: 'lost', requestId: activeId, why: 'unreachable' });
        else schedule();
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !waitingForVisible) return;
      waitingForVisible = false;
      void tick();
    };

    document.addEventListener('visibilitychange', onVisible);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeId, api, go, settle]);

  const start = useCallback(
    async (input: StartInput) => {
      if (bindingId === null || !STARTABLE.has(phaseRef.current.phase)) return;
      const mine = epoch.current;
      const requestId = retryId.current ?? newRequestId();
      retryId.current = requestId;
      go({ phase: 'starting', requestId });
      const body: Record<string, unknown> = { requestId, keep: [...input.keep] };
      if (input.purpose.trim() !== '') body.purpose = input.purpose.trim();
      if (input.style.trim() !== '') body.style = input.style.trim();
      try {
        const record = await api.postJson<SummoningV1>(summoningsPath(bindingId), body);
        if (epoch.current !== mine) return;
        retryId.current = null;
        writeResume(bindingId, requestId);
        startedAt.current = Date.now();
        settle(record);
      } catch (error) {
        if (epoch.current !== mine) return;
        if (error instanceof HostApiError) retryId.current = null;
        go({ phase: 'error', code: codeOf(error) });
      }
    },
    [api, bindingId, go, settle],
  );

  const requestOf = (): SummoningV1 | null => {
    const phase = phaseRef.current;
    return phase.phase === 'active' || phase.phase === 'done' ? phase.request : null;
  };

  const cancel = useCallback(async () => {
    const request = requestOf();
    if (request === null) return;
    const mine = epoch.current;
    try {
      const record = await api.postJson<SummoningV1>(summoningActionPath(request.requestId, 'cancel'), {});
      if (epoch.current === mine) settle(record);
    } catch (error) {
      if (epoch.current === mine) go({ phase: 'error', code: codeOf(error) });
    }
  }, [api, go, settle]);

  const accept = useCallback(
    async (expectedVersion: number): Promise<SpecterV1 | null> => {
      const request = requestOf();
      if (request === null || request.status !== 'ready' || bindingId === null) return null;
      const mine = epoch.current;
      try {
        const specter = await api.postJson<SpecterV1>(summoningActionPath(request.requestId, 'accept'), { expectedVersion });
        if (epoch.current !== mine) return null;
        writeResume(bindingId, null);
        go({ phase: 'idle' });
        return specter;
      } catch (error) {
        if (epoch.current === mine) go({ phase: 'error', code: codeOf(error) });
        return null;
      }
    },
    [api, bindingId, go],
  );

  const discard = useCallback(() => {
    const request = requestOf();
    if (bindingId !== null) writeResume(bindingId, null);
    retryId.current = null;
    go({ phase: 'idle' });
    if (request?.status === 'ready') {
      api.postJson(summoningActionPath(request.requestId, 'cancel'), {}).catch(() => undefined);
    }
  }, [api, bindingId, go]);

  const checkAgain = useCallback(async () => {
    const phase = phaseRef.current;
    if (phase.phase !== 'lost') return;
    const mine = epoch.current;
    go({ phase: 'starting', requestId: phase.requestId });
    try {
      const record = await api.getJson<SummoningV1>(summoningPath(phase.requestId));
      if (epoch.current !== mine) return;
      startedAt.current = Date.now();
      settle(record);
    } catch (error) {
      if (epoch.current !== mine) return;
      if (error instanceof HostApiError && error.error === 'unknown_request') {
        if (bindingId !== null) writeResume(bindingId, null);
        go({ phase: 'idle' });
        return;
      }
      go({ phase: 'lost', requestId: phase.requestId, why: 'unreachable' });
    }
  }, [api, bindingId, go, settle]);

  const clearError = useCallback(() => {
    if (phaseRef.current.phase === 'error') go({ phase: 'idle' });
  }, [go]);

  return { state, budget, start, cancel, accept, discard, checkAgain, clearError };
}
