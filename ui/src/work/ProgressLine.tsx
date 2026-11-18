import { progressWords } from './model';

/** Text only. The props admit nothing but milestone counts, so tokens, time or animation cannot become progress. */
export function ProgressLine({ progress }: { progress: { done: number; total: number } | null }) {
  return <p className="sa-work-progress">{progressWords(progress)}</p>;
}
