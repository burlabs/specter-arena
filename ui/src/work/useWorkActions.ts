import { useRef, useState } from 'react';
import type { WorkItemV1 } from '../contracts/types';
import { HostApiError, WORK_PATH, useHostApi, workAttemptsPath, workDecisionsPath, workMilestonesPath } from '../host';
import { ShapeError, needsEvidence, newWorkRequestId, parseWorkItem } from './model';
import type { DecisionAction } from './model';

export type WriteResult = { ok: true; item: WorkItemV1 } | { ok: false; code: string };

export interface CreateInput {
  title: string;
  acceptanceCondition: string;
  rewardable: boolean;
  parentId: string | null;
  attemptIds: readonly string[];
  milestones: readonly string[];
}

export interface DecideInput {
  action: DecisionAction;
  evidenceRevision: string | null;
  note: string;
}

export interface WorkActions {
  busy: boolean;
  create: (input: CreateInput) => Promise<WriteResult>;
  linkAttempt: (item: WorkItemV1, attemptId: string) => Promise<WriteResult>;
  setMilestone: (item: WorkItemV1, position: number, done: boolean) => Promise<WriteResult>;
  decide: (item: WorkItemV1, input: DecideInput) => Promise<WriteResult>;
}

export const codeOf = (error: unknown): string =>
  error instanceof ShapeError ? 'unexpected' : error instanceof HostApiError ? (error.error ?? `http_${error.status}`) : 'offline';

/** Writes one work request at a time. `create` and `decide` carry a request id that survives a network failure so a retry is safe. */
export function useWorkActions(): WorkActions {
  const api = useHostApi();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const retry = useRef<{ intent: string; requestId: string } | null>(null);

  const requestIdFor = (intent: string): string => {
    if (retry.current?.intent !== intent) retry.current = { intent, requestId: newWorkRequestId() };
    return retry.current.requestId;
  };

  const send = async (path: string, body: (requestId: string) => Record<string, unknown>, intent: string | null): Promise<WriteResult> => {
    if (inFlight.current) return { ok: false, code: 'busy' };
    inFlight.current = true;
    setBusy(true);
    const requestId = intent === null ? '' : requestIdFor(intent);
    try {
      const item = parseWorkItem(await api.postJson<unknown>(path, body(requestId)));
      retry.current = null;
      return { ok: true, item };
    } catch (error) {
      if (intent === null || error instanceof HostApiError || error instanceof ShapeError) retry.current = null;
      return { ok: false, code: codeOf(error) };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return {
    busy,
    create: (input) => {
      const fields = {
        title: input.title.trim(),
        acceptanceCondition: input.acceptanceCondition.trim(),
        rewardable: input.rewardable,
        attemptIds: [...input.attemptIds],
        milestones: input.milestones.map((label) => label.trim()),
      };
      return send(
        WORK_PATH,
        (requestId) => ({ requestId, ...fields, ...(input.parentId === null ? {} : { parentId: input.parentId }) }),
        `create:${JSON.stringify([fields, input.parentId])}`,
      );
    },
    linkAttempt: (item, attemptId) => send(workAttemptsPath(item.workId), () => ({ expectedVersion: item.version, attemptId }), null),
    setMilestone: (item, position, done) => send(workMilestonesPath(item.workId), () => ({ expectedVersion: item.version, position, done }), null),
    decide: (item, input) => {
      const note = input.note.trim();
      const evidence = needsEvidence(input.action) && input.evidenceRevision !== null ? input.evidenceRevision : null;
      return send(
        workDecisionsPath(item.workId),
        (requestId) => ({
          requestId,
          expectedVersion: item.version,
          action: input.action,
          ...(evidence === null ? {} : { evidenceRevision: evidence }),
          ...(note === '' ? {} : { note }),
        }),
        `decide:${item.workId}:${input.action}:${evidence ?? ''}:${note}`,
      );
    },
  };
}
