import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RosterItemV1, SpecterV2, SpecterV3 } from '../contracts/types';
import { specterPortraitPath, useHostApi } from '../host';
import { Button } from '../observatory/ui';
import { PortraitPicker } from './PortraitPicker';
import { SpecterPortrait } from './SpecterPortrait';
import { ACTIONS, ASSIGN, COSMETIC_NOTE, FIELD_LABELS, HERO_NOTE, HERO_PENDING, NO_SPECTER, errorWords } from './copy';
import { errorCodeOf } from './useSpecters';
import type { SpectersState } from './useSpecters';

interface Props {
  bot: RosterItemV1;
  specter: SpecterV3 | null;
  specters: SpectersState;
  /** The bot's level and XP, drawn by the list so the card and the detail agree. */
  progression: ReactNode;
  /** Given for a bot that holds no hero: offers the assignment walkthrough. */
  onAssign?: () => void;
}

export function SpecterDetail({ bot, specter, specters, progression, onAssign }: Props) {
  const api = useHostApi();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusHeading.current || headingRef.current === null) return;
    focusHeading.current = false;
    headingRef.current.focus();
  });

  if (specter === null) {
    return (
      <section className="sa-profile" aria-labelledby={headingId}>
        <h2 id={headingId}>{NO_SPECTER}</h2>
        {onAssign === undefined ? (
          <>
            <p className="sa-help">{HERO_PENDING}</p>
            <Button onClick={specters.refresh}>{ACTIONS.checkAgain}</Button>
          </>
        ) : (
          <>
            <p className="sa-help">{ASSIGN.detailHelp}</p>
            <Button onClick={onAssign}>{ACTIONS.assign}</Button>
          </>
        )}
      </section>
    );
  }

  const setAvatar = async (assetId: string | null) => {
    setBusy(true);
    setWriteError(null);
    try {
      specters.apply(await api.postJson<SpecterV2>(specterPortraitPath(bot.bindingId), { expectedVersion: specter.version, assetId }));
      focusHeading.current = true;
      setPicking(false);
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === 'version_conflict') specters.refresh();
      setWriteError(code);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sa-profile" aria-labelledby={headingId}>
      <div className="sa-profile__head">
        <SpecterPortrait specter={specter} size="lg" active={bot.condition.state === 'working'} />
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            {specter.displayName}
          </h2>
          <p>{specter.epithet}</p>
          <p className="sa-help">{HERO_NOTE}</p>
          <p className="sa-help">{COSMETIC_NOTE}</p>
        </div>
      </div>
      <dl>
        <div className="sa-field">
          <dt>{FIELD_LABELS.progression}</dt>
          <dd>{progression}</dd>
        </div>
        <div className="sa-field">
          <dt>{FIELD_LABELS.personality}</dt>
          <dd>{specter.personality}</dd>
        </div>
        <div className="sa-field">
          <dt>{FIELD_LABELS.appearance}</dt>
          <dd>{specter.appearance}</dd>
        </div>
      </dl>
      {writeError !== null && (
        <p className="sa-error" role="alert">
          {errorWords(writeError)}
        </p>
      )}
      <div className="sa-actions">
        <Button aria-expanded={picking} onClick={() => setPicking(true)}>
          {ACTIONS.avatar}
        </Button>
      </div>
      {picking && (
        <PortraitPicker
          heroId={specter.heroId}
          currentAssetId={specter.avatarChosen ? specter.portrait.assetId : null}
          busy={busy}
          onApply={(assetId) => void setAvatar(assetId)}
          onCancel={() => {
            focusHeading.current = true;
            setPicking(false);
          }}
        />
      )}
    </section>
  );
}
