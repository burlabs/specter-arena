import { useState } from 'react';
import type { FormEvent } from 'react';
import type { SpecterProfileV1 } from '../contracts/types';
import { Button } from '../observatory/ui';
import { FIELD_LABELS, MANUAL, MANUAL_FORM, characterCount } from './copy';
import { FIELD_BOUNDS, PROFILE_FIELDS, lengthOf } from './model';
import type { ProfileField } from './model';

interface Props {
  initial: SpecterProfileV1 | null;
  busy: boolean;
  onSave: (profile: SpecterProfileV1) => void;
  onCancel: () => void;
}

type Draft = Record<ProfileField, string>;

const draftOf = (profile: SpecterProfileV1 | null): Draft =>
  Object.fromEntries(PROFILE_FIELDS.map((field) => [field, profile?.[field] ?? ''])) as Draft;

/** Returns the profile to save, or the names of the fields that are out of bounds. */
export function checkDraft(draft: Draft): { profile: SpecterProfileV1 } | { invalid: ProfileField[] } {
  const invalid = PROFILE_FIELDS.filter((field) => {
    const size = lengthOf(draft[field].trim());
    const bounds = FIELD_BOUNDS[field];
    return size > bounds.max || (bounds.required && size === 0);
  });
  if (invalid.length > 0) return { invalid };
  const text = (field: ProfileField) => draft[field].trim();
  const optional = (field: ProfileField) => (text(field) === '' ? null : text(field));
  return {
    profile: {
      contractVersion: 1,
      name: text('name'),
      epithet: optional('epithet'),
      personality: text('personality'),
      appearance: text('appearance'),
      mannerism: text('mannerism'),
      signatureAction: optional('signatureAction'),
      assignmentRationale: text('assignmentRationale'),
      artBrief: text('artBrief'),
    },
  };
}

export function ManualEntry({ initial, busy, onSave, onCancel }: Props) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [invalid, setInvalid] = useState<readonly ProfileField[]>([]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = checkDraft(draft);
    if ('invalid' in result) setInvalid(result.invalid);
    else {
      setInvalid([]);
      onSave(result.profile);
    }
  };

  return (
    <form className="sa-form" onSubmit={submit} aria-label={MANUAL.heading}>
      <h3>{MANUAL.heading}</h3>
      <p className="sa-help">{MANUAL.help}</p>
      {PROFILE_FIELDS.map((field) => {
        const bounds = FIELD_BOUNDS[field];
        const used = lengthOf(draft[field]);
        const set = (value: string) => setDraft((previous) => ({ ...previous, [field]: value }));
        const label = `${FIELD_LABELS[field]}${bounds.required ? '' : MANUAL_FORM.optional}`;
        const flagged = invalid.includes(field);
        return (
          <label key={field}>
            {label}
            {bounds.multiline ? (
              <textarea rows={3} value={draft[field]} aria-invalid={flagged} onChange={(event) => set(event.target.value)} />
            ) : (
              <input type="text" value={draft[field]} aria-invalid={flagged} onChange={(event) => set(event.target.value)} />
            )}
            <span className="sa-counter">{characterCount(used, bounds.max)}</span>
          </label>
        );
      })}
      {invalid.length > 0 && (
        <p className="sa-error" role="alert">
          Check these fields: {invalid.map((field) => FIELD_LABELS[field]).join(', ')}.
        </p>
      )}
      <div className="sa-actions">
        <Button type="submit" disabled={busy}>
          {MANUAL_FORM.save}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {MANUAL_FORM.cancel}
        </Button>
      </div>
    </form>
  );
}
