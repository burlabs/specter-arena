import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { RosterItemV1, SpecterProfileV1, SpecterV1 } from '../contracts/types';
import { HostApiError, specterActionPath, useHostApi } from '../host';
import { nameOf } from '../observatory/model';
import { Button } from '../observatory/ui';
import { ManualEntry } from './ManualEntry';
import { PortraitPicker } from './PortraitPicker';
import { SpecterPortrait } from './SpecterPortrait';
import { SummonPanel } from './SummonPanel';
import { ACTIONS, ARCHIVE, COSMETIC_NOTE, FIELD_LABELS, NO_SPECTER, RENAME, errorWords, sourceWords } from './copy';
import { lengthOf } from './model';
import type { SpectersState } from './useSpecters';
import { useSummoning } from './useSummoning';

type Mode = 'view' | 'rename' | 'portrait' | 'manual' | 'archive';
type FocusTarget = 'heading' | 'rename' | null;

interface Props {
  bot: RosterItemV1;
  specter: SpecterV1 | null;
  specters: SpectersState;
}

const codeOf = (error: unknown): string => (error instanceof HostApiError ? (error.error ?? `http_${error.status}`) : 'offline');

const FIELDS = ['personality', 'appearance', 'mannerism', 'signatureAction', 'assignmentRationale', 'artBrief'] as const;

function RenameForm({ profile, busy, onSave, onCancel }: { profile: SpecterProfileV1; busy: boolean; onSave: (name: string, epithet: string | null) => void; onCancel: () => void }) {
  const [name, setName] = useState(profile.name);
  const [epithet, setEpithet] = useState(profile.epithet ?? '');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);
  const valid = name.trim() !== '' && lengthOf(name.trim()) <= 40 && lengthOf(epithet.trim()) <= 60;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSave(name.trim(), epithet.trim() === '' ? null : epithet.trim());
  };
  return (
    <form
      className="sa-form"
      aria-label={RENAME.heading}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <label>
        {RENAME.name}
        <input ref={nameRef} type="text" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        {RENAME.epithet}
        <input type="text" value={epithet} maxLength={60} onChange={(event) => setEpithet(event.target.value)} />
      </label>
      <div className="sa-actions">
        <Button type="submit" disabled={busy || !valid}>
          {RENAME.save}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {RENAME.cancel}
        </Button>
      </div>
    </form>
  );
}

export function SpecterDetail({ bot, specter, specters }: Props) {
  const api = useHostApi();
  const summoning = useSummoning(bot.bindingId);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<FocusTarget>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    const element = target === 'heading' ? headingRef.current : renameRef.current;
    if (element === null) return;
    focusAfter.current = null;
    element.focus();
  });

  const write = async (action: 'manual' | 'name' | 'portrait' | 'archive', body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setWriteError(null);
    try {
      const next = await api.postJson<SpecterV1>(specterActionPath(bot.bindingId, action), { expectedVersion: specter?.version ?? 0, ...body });
      if (action === 'archive') specters.remove(bot.bindingId);
      else specters.apply(next);
      return true;
    } catch (error) {
      const code = codeOf(error);
      if (code === 'version_conflict') specters.refresh();
      setWriteError(code);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const finish = async (action: 'manual' | 'name' | 'portrait' | 'archive', body: Record<string, unknown>) => {
    if (!(await write(action, body))) return;
    focusAfter.current = action === 'archive' ? null : 'heading';
    setMode('view');
  };

  const cancelMode = (focus: FocusTarget = null) => {
    focusAfter.current = focus;
    setMode('view');
  };

  const accept = async () => {
    const next = await summoning.accept(specter?.version ?? 0);
    if (next !== null) {
      focusAfter.current = 'heading';
      specters.apply(next);
    } else specters.refresh();
  };

  const nameTaken = (name: string) =>
    [...specters.byBinding.values()].some((other) => other.bindingId !== bot.bindingId && other.profile.name === name);

  return (
    <section className="sa-profile" aria-labelledby={headingId}>
      <div className="sa-profile__head">
        {specter !== null && <SpecterPortrait specter={specter} size="lg" active={bot.condition.state === 'working'} />}
        <div>
          <h2 id={headingId} ref={headingRef} tabIndex={-1}>
            {specter === null ? nameOf(bot) : specter.profile.name}
          </h2>
          {specter?.profile.epithet != null && <p>{specter.profile.epithet}</p>}
          <p className="sa-help">{specter === null ? NO_SPECTER : sourceWords(specter.source, specter.promptVersion)}</p>
          <p className="sa-help">{COSMETIC_NOTE}</p>
        </div>
      </div>

      {specter !== null && (
        <dl>
          {FIELDS.map((field) => {
            const text = specter.profile[field];
            return text === null ? null : (
              <div key={field} className="sa-field">
                <dt>{FIELD_LABELS[field]}</dt>
                <dd>{text}</dd>
              </div>
            );
          })}
        </dl>
      )}

      {writeError !== null && (
        <p className="sa-error" role="alert">
          {errorWords(writeError)}
        </p>
      )}

      <div className="sa-actions">
        {specter !== null && (
          <Button ref={renameRef} aria-expanded={mode === 'rename'} onClick={() => setMode('rename')}>
            {ACTIONS.rename}
          </Button>
        )}
        {specter !== null && (
          <Button aria-expanded={mode === 'portrait'} onClick={() => setMode('portrait')}>
            {ACTIONS.portrait}
          </Button>
        )}
        <Button aria-expanded={mode === 'manual'} onClick={() => setMode('manual')}>
          {ACTIONS.manual}
        </Button>
        {specter !== null && (
          <Button variant="ghost" aria-expanded={mode === 'archive'} onClick={() => setMode('archive')}>
            {ACTIONS.archive}
          </Button>
        )}
      </div>

      {mode === 'rename' && specter !== null && (
        <RenameForm
          profile={specter.profile}
          busy={busy}
          onSave={(name, epithet) => void finish('name', { name, epithet })}
          onCancel={() => cancelMode('rename')}
        />
      )}
      {mode === 'portrait' && specter !== null && (
        <PortraitPicker
          currentAssetId={specter.portrait?.assetId ?? null}
          busy={busy}
          onApply={(assetId) => void finish('portrait', { assetId })}
          onCancel={() => cancelMode()}
        />
      )}
      {mode === 'manual' && (
        <ManualEntry initial={specter?.profile ?? null} busy={busy} onSave={(profile) => void finish('manual', { profile })} onCancel={() => cancelMode()} />
      )}
      {mode === 'archive' && specter !== null && (
        <div className="sa-inline-confirm" role="group" aria-label={ACTIONS.archive}>
          <Button variant="ghost" onClick={() => cancelMode()}>
            {ARCHIVE.keep}
          </Button>
          <span>{ARCHIVE.ask(specter.profile.name)}</span>
          <Button disabled={busy} onClick={() => void finish('archive', {})}>
            {ARCHIVE.confirm}
          </Button>
        </div>
      )}

      <SummonPanel summoning={summoning} specter={specter} nameTaken={nameTaken} onAccept={() => void accept()} />
    </section>
  );
}
