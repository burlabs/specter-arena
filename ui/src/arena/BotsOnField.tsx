import type { RosterItemV1 } from '../contracts/types';
import { ConditionBadge } from '../observatory/ConditionBadge';
import { botCondition, nameOf } from '../observatory/model';
import { Panel } from '../observatory/ui';
import { SpecterPortrait } from '../specters/SpecterPortrait';
import { tokenInitials } from '../specters/model';
import { ARENA, INSPECTOR } from './copy';
import { asPortraitRecord } from './specterShape';
import type { ArenaSpecter } from './specterShape';

interface Props {
  bots: readonly RosterItemV1[];
  specters: ReadonlyMap<string, ArenaSpecter>;
}

/** A collapsed, read-only list of every bot with its hero and condition. It assigns nothing and places nothing. */
export function BotsOnField({ bots, specters }: Props) {
  return (
    <Panel label={ARENA.botsOnField}>
      <details className="sa-bots-on-field">
        <summary>{ARENA.botsOnField}</summary>
        {bots.length === 0 ? (
          <p className="sa-help">{ARENA.botsOnFieldNone}</p>
        ) : (
          <ul className="sa-bots-on-field__list">
            {bots.map((bot) => {
              const specter = specters.get(bot.bindingId);
              return (
                <li key={bot.bindingId}>
                  {specter !== undefined ? (
                    <SpecterPortrait specter={asPortraitRecord(specter)} size="sm" decorative />
                  ) : (
                    <span className="sa-token__placeholder" aria-hidden="true">
                      {tokenInitials(nameOf(bot))}
                    </span>
                  )}
                  <span className="sa-bots-on-field__names">
                    <strong>{nameOf(bot)}</strong>
                    {specter !== undefined && <span className="sa-help">{INSPECTOR.specterIs(specter.displayName)}</span>}
                  </span>
                  <ConditionBadge view={botCondition(bot.condition)} />
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </Panel>
  );
}
