import type { RosterItemV1, XpSummaryV1 } from '../contracts/types';
import { ConditionBadge } from '../observatory/ConditionBadge';
import { botCondition } from '../observatory/model';
import { SpecterPortrait } from '../specters/SpecterPortrait';
import { SpecterProgression } from '../specters/SpecterProgression';
import { tokenInitials } from '../specters/model';
import { ARENA, HUD } from './copy';
import type { SceneModel, SceneSpecter } from './sceneModel';
import { isSelected } from './selection';
import type { ArenaSelection } from './selection';
import { asPortraitRecord } from './specterShape';
import type { ArenaSpecter } from './specterShape';
import { Button } from '../observatory/ui';
import { CollapsedLabel } from './CollapsedLabel';

/** Whether the Specters read has finished. While it has not, "no Specter yet" would be a guess. */
export type SpecterReading = 'loading' | 'ready' | 'failed';

interface Props {
  model: SceneModel;
  bots: readonly RosterItemV1[];
  specters: ReadonlyMap<string, ArenaSpecter>;
  xp: ReadonlyMap<string, XpSummaryV1>;
  selection: ArenaSelection | null;
  onSelect: (selection: ArenaSelection) => void;
  open: boolean;
  onToggle: () => void;
  /** Default `ready`. */
  specterStatus?: SpecterReading;
  /** The bindings the backend says have no Specter (`unassignedBindingIds`). Every bot not on the field is listed under
   * "No Specter yet"; when this set is given, only the bots in it get an Assign button. */
  unassigned?: ReadonlySet<string>;
  /** Opens the assignment flow for a bot. Without it the rail shows no Assign button. */
  onAssign?: (bindingId: string) => void;
}

/** Every drawn Specter once, in the same order as the scene, then the bots that have no Specter yet. */
export function ArenaRail({ model, bots, specters, xp, selection, onSelect, open, onToggle, specterStatus = 'ready', unassigned, onAssign }: Props) {
  const botById = new Map(bots.map((bot) => [bot.bindingId, bot]));
  const heroed = model.specters.filter((specter) => specter.heroId !== null);
  const heroless = model.specters.filter((specter) => specter.heroId === null);
  const canAssign = (bindingId: string): boolean => onAssign !== undefined && (unassigned === undefined || unassigned.has(bindingId));

  const row = (specter: SceneSpecter) => {
    const record = specters.get(specter.bindingId);
    const bot = botById.get(specter.bindingId);
    return (
      <button
        type="button"
        className="sa-arena-rail__row"
        aria-pressed={isSelected(selection, 'specter', specter.bindingId)}
        onClick={() => onSelect({ kind: 'specter', bindingId: specter.bindingId })}
      >
        {record !== undefined ? (
          <SpecterPortrait specter={asPortraitRecord(record)} size="sm" decorative />
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
          {specter.heroId !== null && <span className="sa-help">{ARENA.linked(specter.openAttemptIds.length)}</span>}
        </span>
      </button>
    );
  };

  return (
    <aside className={`sa-arena-rail${open ? '' : ' sa-is-collapsed'}`} aria-label={ARENA.railLabel}>
      <Button variant="ghost" aria-expanded={open} aria-controls="sa-arena-rail-body" aria-label={open ? undefined : HUD.railShow} onClick={onToggle}>
        {open ? HUD.railHide : <CollapsedLabel glyph="›" text={HUD.railShow} />}
      </Button>
      <div id="sa-arena-rail-body" className="sa-arena-rail__body" hidden={!open}>
        <ul className="sa-arena-rail__list">
          {heroed.map((specter) => (
            <li key={specter.bindingId}>{row(specter)}</li>
          ))}
        </ul>
        {specterStatus !== 'ready' ? (
          <p className="sa-help" role="status">
            {specterStatus === 'loading' ? ARENA.specterLoading : ARENA.specterUnavailable}
          </p>
        ) : (
          heroless.length > 0 && (
            <section className="sa-arena-rail__unassigned" aria-labelledby="sa-arena-rail-unassigned">
              <h3 id="sa-arena-rail-unassigned">{`${ARENA.noSpecterYet} (${heroless.length})`}</h3>
              <ul className="sa-arena-rail__list">
                {heroless.map((specter) => (
                  <li key={specter.bindingId} className="sa-arena-rail__unassigned-row">
                    {row(specter)}
                    {canAssign(specter.bindingId) && onAssign !== undefined && (
                      <Button onClick={() => onAssign(specter.bindingId)} aria-label={ARENA.assignFor(specter.displayName)}>
                        {ARENA.assign}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        )}
      </div>
    </aside>
  );
}
