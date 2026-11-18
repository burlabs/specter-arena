import { useEffect, useState } from 'react';
import { useHostApi } from '../host';
import { loadAssetUrl } from './assetCache';

export interface AssetView {
  status: 'none' | 'loading' | 'ready' | 'failed';
  src: string | null;
}

type Settled = { assetId: string; status: 'ready' | 'failed'; src: string | null };

export function useAsset(assetId: string | null): AssetView {
  const api = useHostApi();
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (assetId === null) return;
    let live = true;
    loadAssetUrl(api, assetId).then(
      (src) => {
        if (live) setSettled({ assetId, status: 'ready', src });
      },
      () => {
        if (live) setSettled({ assetId, status: 'failed', src: null });
      },
    );
    return () => {
      live = false;
    };
  }, [api, assetId]);

  if (assetId === null) return { status: 'none', src: null };
  if (settled === null || settled.assetId !== assetId) return { status: 'loading', src: null };
  return { status: settled.status, src: settled.src };
}
