import { useAsset } from './useAsset';

/** A gallery thumbnail. The label is the picture's name, and it is also printed beside it, so the image itself is decorative. */
export function AssetImage({ assetId, size }: { assetId: string; size: number }) {
  const asset = useAsset(assetId);
  if (asset.status !== 'ready' || asset.src === null) {
    return <span className="sa-portrait sa-portrait--sm sa-portrait--loading" aria-hidden="true" data-asset={asset.status} />;
  }
  return <img className="sa-portrait__img" src={asset.src} alt="" width={size} height={size} />;
}
