export type Size = { width: number; height: number };
export type Pan = { x: number; y: number };
export type NormalizedPoint = { x: number; y: number };

export type SceneTransform = {
  viewport: Size;
  intrinsic: Size;
  zoom: number;
  fitScale: number;
  scale: number;
  offset: Pan;
  pan: Pan;
  displayed: Size;
};

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 2.5;

export const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));

/** Fits the map inside the viewport, then applies zoom and a pan that can never leave the map. */
export function createSceneTransform(viewport: Size, intrinsic: Size, zoom = 1, requestedPan: Pan = { x: 0, y: 0 }): SceneTransform {
  if (![viewport.width, viewport.height, intrinsic.width, intrinsic.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Viewport and intrinsic dimensions must be finite and greater than zero.');
  }
  const boundedZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const fitScale = Math.min(viewport.width / intrinsic.width, viewport.height / intrinsic.height);
  const scale = fitScale * boundedZoom;
  const displayed = { width: intrinsic.width * scale, height: intrinsic.height * scale };
  const offset = { x: (viewport.width - displayed.width) / 2, y: (viewport.height - displayed.height) / 2 };
  const overflow = {
    x: Math.max(0, (displayed.width - viewport.width) / 2),
    y: Math.max(0, (displayed.height - viewport.height) / 2),
  };
  const pan = { x: clamp(requestedPan.x, -overflow.x, overflow.x), y: clamp(requestedPan.y, -overflow.y, overflow.y) };
  return { viewport, intrinsic, zoom: boundedZoom, fitScale, scale, offset, pan, displayed };
}

export function normalizedToDisplay(point: NormalizedPoint, transform: SceneTransform): Pan {
  return {
    x: transform.offset.x + transform.pan.x + point.x * transform.intrinsic.width * transform.scale,
    y: transform.offset.y + transform.pan.y + point.y * transform.intrinsic.height * transform.scale,
  };
}

export function displayToNormalized(point: Pan, transform: SceneTransform): NormalizedPoint {
  return {
    x: (point.x - transform.offset.x - transform.pan.x) / (transform.intrinsic.width * transform.scale),
    y: (point.y - transform.offset.y - transform.pan.y) / (transform.intrinsic.height * transform.scale),
  };
}

/** The part of the map the viewport shows, in 0..1 map coordinates. */
export function visibleNormalizedRect(transform: SceneTransform): { x: number; y: number; width: number; height: number } {
  const topLeft = displayToNormalized({ x: 0, y: 0 }, transform);
  const bottomRight = displayToNormalized({ x: transform.viewport.width, y: transform.viewport.height }, transform);
  const left = clamp(topLeft.x, 0, 1);
  const top = clamp(topLeft.y, 0, 1);
  const right = clamp(bottomRight.x, 0, 1);
  const bottom = clamp(bottomRight.y, 0, 1);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}
