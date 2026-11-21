import { useState } from 'react';
import type { RosterItemV1, SpecterV2, XpSummaryV1 } from '../contracts/types';
import { ConditionBadge } from '../observatory/ConditionBadge';
import { botCondition } from '../observatory/model';
import { SpecterPortrait } from '../specters/SpecterPortrait';
import { SpecterProgression } from '../specters/SpecterProgression';
import { tokenInitials } from '../specters/model';
import { ARENA, HUD } from './copy';
import type { SceneModel } from './sceneModel';
import { isSelected } from './selection';
import type { ArenaSelection } from './selection';
import { Button } from '../observatory/ui';

interface Props {
  model: SceneModel;
  bots: readonly RosterItemV1[];
  specters: ReadonlyMap<string, SpecterV2>;
  xp: ReadonlyMap<string, XpSummaryV1>;
  selection: ArenaSelection | null;
  onSelect: (selection: ArenaSelection) => void;
}

/** Every Specter once, in the same order as the scene, with the roster's own condition words. */
export function ArenaRail({ model, bots, specters, xp, selection, onSelect }: Props) {
  const [open, setOpen] = useState(true);
  const botById = new Map(bots.map((bot) => [bot.bindingId, bot]));
  return (
    <aside className="sa-arena-rail" aria-label={ARENA.railLabel}>
      <Button variant="ghost" aria-expanded={open} aria-controls="sa-arena-rail-list" onClick={() => setOpen((value) => !value)}>
        {open ? HUD.railHide : HUD.railShow}
      </Button>
      <ul id="sa-arena-rail-list" className="sa-arena-rail__list" hidden={!open}>
        {model.specters.map((specter) => {
          const record = specters.get(specter.bindingId);
          const bot = botById.get(specter.bindingId);
          return (
            <li key={specter.bindingId}>
              <button
                type="button"
                className="sa-arena-rail__row"
                aria-pressed={isSelected(selection, 'specter', specter.bindingId)}
                onClick={() => onSelect({ kind: 'specter', bindingId: specter.bindingId })}
              >
                {record !== undefined ? (
                  <SpecterPortrait specter={record} size="sm" decorative />
                ) : (
                  <span className="sa-token__placeholder" aria-hidden="true">
                    {tokenInitials(specter.displayName)}
                  </span>
                )}
                <span className="sa-arena-rail__copy">
                  <strong>{specter.specterName ?? specter.displayName}</strong>
                  {specter.specterName !== null && <span className="sa-help">{`for ${specter.displayName}`}</span>}
                  {bot !== undefined && <ConditionBadge view={botCondition(bot.condition)} />}
                  <SpecterProgression compact summary={xp.get(specter.bindingId)} unavailable={specter.xpReading === 'ready' ? undefined : specter.xpReading} />
                  <span className="sa-help">{ARENA.linked(specter.openAttemptIds.length)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
