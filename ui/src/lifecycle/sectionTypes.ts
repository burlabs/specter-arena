import type { DataLifecycleV1 } from '../contracts/types';
import type { DataActions, LifecycleResult } from './useDataActions';

/** Sends one lifecycle write, applies the answer to the page and announces `done`. Resolves to an error sentence, or null on success. */
export type Submit = (pending: Promise<LifecycleResult>, done: string) => Promise<string | null>;

export interface SectionProps {
  data: DataLifecycleV1;
  actions: DataActions;
  submit: Submit;
}
