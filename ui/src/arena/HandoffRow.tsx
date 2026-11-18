import type { MouseEvent } from 'react';
import { useHostNavigate } from '../host';
import { INSPECTOR } from './copy';
import { CopySummary } from './CopySummary';
import { CREW_HANDOFFS, HANDOFF_LIMIT_NOTE } from './handoff';

/**
 * Navigation only: each entry goes to a Crew page and runs nothing there. The summary button is always offered,
 * because the one route Crew allows cannot open the bot or an approval.
 */
export function HandoffRow({ buildSummary }: { buildSummary: () => string }) {
  const navigate = useHostNavigate();
  const open = (event: MouseEvent<HTMLAnchorElement>, path: ReturnType<(typeof CREW_HANDOFFS)[number]['buildHref']>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  };
  return (
    <section className="sa-arena-section" aria-label={INSPECTOR.handoffHeading}>
      <h3>{INSPECTOR.handoffHeading}</h3>
      <ul className="sa-arena-plain">
        {CREW_HANDOFFS.map((handoff) => {
          const path = handoff.buildHref();
          return (
            <li key={handoff.id}>
              <a href={path} data-handoff={handoff.id} onClick={(event) => open(event, path)}>
                {handoff.label}
              </a>
            </li>
          );
        })}
      </ul>
      <p className="sa-help">{HANDOFF_LIMIT_NOTE}</p>
      <CopySummary build={buildSummary} />
      <p className="sa-help">{INSPECTOR.summaryHelp}</p>
    </section>
  );
}
