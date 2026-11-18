import { useEffect, useState } from 'react';
import { useHostApi } from '../host';
import { loadSceneArt } from './sceneAssetCache';
import type { SceneArt } from './sceneAssetCache';

export type SceneAssetView = { status: 'loading'; art: null } | { status: 'ready'; art: SceneArt } | { status: 'failed'; art: null };

type Settled = { key: string; view: SceneAssetView };

/** A scene image by key. A failure is a state, never an error: the scene draws a plate or a fallback drawing. */
export function useSceneAsset(key: string): SceneAssetView {
  const api = useHostApi();
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    let live = true;
    loadSceneArt(api, key).then(
      (art) => {
        if (live) setSettled({ key, view: { status: 'ready', art } });
      },
      () => {
        if (live) setSettled({ key, view: { status: 'failed', art: null } });
      },
    );
    return () => {
      live = false;
    };
  }, [api, key]);

  return settled !== null && settled.key === key ? settled.view : { status: 'loading', art: null };
}
