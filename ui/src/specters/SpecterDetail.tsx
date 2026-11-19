import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { RosterItemV1, SpecterV2 } from '../contracts/types';
import { HostApiError, specterPortraitPath, useHostApi } from '../host';
import { nameOf } from '../observatory/model';
import { Button } from '../observatory/ui';
import { PortraitPicker } from './PortraitPicker';
import { SpecterPortrait } from './SpecterPortrait';
import { ACTIONS, COSMETIC_NOTE, FIELD_LABELS, HERO_NOTE, HERO_PENDING, errorWords } from './copy';
import type { SpectersState } from './useSpecters';

interface Props {
  bot: RosterItemV1;
  specter: SpecterV2 | null;
  specters: SpectersState;
  /** The bot's level and XP, drawn by the list so the card and the detail agree. */
  progression: ReactNode;
}

const codeOf = (error: unknown): string => (error instanceof HostApiError ? (error.error ?? `http_${error.status}`) : 'offline');

export function SpecterDetail({ bot, specter, specters, progression }: Props) {
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
        <h2 id={headingId}>{nameOf(bot)}</h2>
        <p className="sa-help">{HERO_PENDING}</p>
        <Button onClick={specters.refresh}>{ACTIONS.checkAgain}</Button>
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
      const code = codeOf(error);
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
          <dt>{FIELD_LABELS.bot}</dt>
          <dd>{nameOf(bot)}</dd>
        </div>
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
