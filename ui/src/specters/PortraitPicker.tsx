import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { PortraitAssetV1, PortraitsV1 } from '../contracts/types';
import { ASSETS_PATH, HostApiError, PORTRAITS_PATH, useHostApi } from '../host';
import { Button } from '../observatory/ui';
import { AssetImage } from './AssetImage';
import { HeroThumb } from './HeroThumb';
import { CLIENT_NOT_PNG, CLIENT_TOO_LARGE, PICKER, errorWords } from './copy';

export const MAX_UPLOAD_BYTES = 1_048_576;
const NONE = '';
const LABEL_UNSAFE = /[\u0000-\u001f\u007f<>]/g;

interface Props {
  /** The hero whose own thumbnail is drawn beside "Use the hero portrait". */
  heroId?: string;
  currentAssetId: string | null;
  busy: boolean;
  onApply: (assetId: string | null) => void;
  onCancel: () => void;
}

function labelFrom(fileName: string): string | undefined {
  const label = Array.from(fileName.replace(/\.[^.]*$/, '').replace(LABEL_UNSAFE, ' ').trim()).slice(0, 80).join('');
  return label === '' ? undefined : label;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('unreadable file'));
    reader.readAsDataURL(file);
  });
}

export function PortraitPicker({ heroId, currentAssetId, busy, onApply, onCancel }: Props) {
  const api = useHostApi();
  const [items, setItems] = useState<PortraitAssetV1[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [choice, setChoice] = useState<string>(currentAssetId ?? NONE);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.getJson<PortraitsV1>(PORTRAITS_PATH).then(
      (body) => {
        if (live) setItems(Array.isArray(body?.items) ? body.items : []);
      },
      () => {
        if (live) setLoadFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    if (file.type !== 'image/png') return setUploadError(CLIENT_NOT_PNG);
    if (file.size > MAX_UPLOAD_BYTES) return setUploadError(CLIENT_TOO_LARGE);
    setUploadError(null);
    try {
      const dataBase64 = await readBase64(file);
      const label = labelFrom(file.name);
      const asset = await api.postJson<PortraitAssetV1>(ASSETS_PATH, { mediaType: 'image/png', dataBase64, ...(label === undefined ? {} : { label }) });
      setItems((previous) => [...(previous ?? []).filter((item) => item.assetId !== asset.assetId), asset]);
      setChoice(asset.assetId);
    } catch (error) {
      setUploadError(errorWords(error instanceof HostApiError ? (error.error ?? 'invalid_image') : 'offline'));
    }
  };

  return (
    <section className="sa-form" aria-label={PICKER.heading}>
      <h3>{PICKER.heading}</h3>
      {loadFailed && <p className="sa-error">{PICKER.failed}</p>}
      {items === null && !loadFailed && <p role="status">{PICKER.loading}</p>}
      {items !== null && (
        <div className="sa-gallery" role="radiogroup" aria-label={PICKER.gallery}>
          <label className="sa-gallery__item">
            <input type="radio" name="specter-portrait" value={NONE} checked={choice === NONE} onChange={() => setChoice(NONE)} />
            {heroId !== undefined && <HeroThumb heroId={heroId} name={PICKER.heroDefault} size={64} />}
            <span>{PICKER.heroDefault}</span>
          </label>
          {items.map((item) => (
            <label key={item.assetId} className="sa-gallery__item">
              <input type="radio" name="specter-portrait" value={item.assetId} checked={choice === item.assetId} onChange={() => setChoice(item.assetId)} />
              <AssetImage assetId={item.assetId} size={64} />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      )}
      <label>
        {PICKER.upload}
        <input type="file" accept="image/png" onChange={(event) => void upload(event)} />
      </label>
      {uploadError !== null && (
        <p className="sa-error" role="alert">
          {uploadError}
        </p>
      )}
      <div className="sa-actions">
        <Button disabled={busy || items === null || choice === (currentAssetId ?? NONE)} onClick={() => onApply(choice === NONE ? null : choice)}>
          {PICKER.apply}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {PICKER.cancel}
        </Button>
      </div>
    </section>
  );
}
