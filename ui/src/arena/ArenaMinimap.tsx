import { useId } from 'react';
import { ARENA_LAYOUT } from './mapLayout';
import { ARENA, HUD } from './copy';
import type { Placement } from './sceneLayout';
import { Button } from '../observatory/ui';

interface Props {
  placement: Placement;
  /** The part of the map the viewport shows, in 0..1 map coordinates. */
  view: { x: number; y: number; width: number; height: number };
  open: boolean;
  onToggle: () => void;
}

const percent = (value: number): string => `${(value * 100).toFixed(2)}%`;

/** A small overview: one dot per placed Specter and enemy and a frame for what the main view shows. */
export function ArenaMinimap({ placement, view, open, onToggle }: Props) {
  const panelId = useId();
  return (
    <div className="sa-arena-minimap">
      <Button variant="ghost" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        {open ? HUD.minimapHide : HUD.minimapShow}
      </Button>
      <div id={panelId} hidden={!open}>
        <div className="sa-arena-minimap__frame" role="img" aria-label={ARENA.minimapLabel}>
          <svg className="sa-arena-minimap__paths" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {ARENA_LAYOUT.paths.map((path) => (
              <polyline key={path.id} className="sa-arena-minimap__path" points={path.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')} />
            ))}
          </svg>
          {[...placement.enemies].map(([id, point]) => (
            <i key={id} className="sa-arena-minimap__dot sa-arena-minimap__dot--enemy" style={{ left: percent(point.x), top: percent(point.y) }} />
          ))}
          {[...placement.specters].map(([id, point]) => (
            <i key={id} className="sa-arena-minimap__dot sa-arena-minimap__dot--specter" style={{ left: percent(point.x), top: percent(point.y) }} />
          ))}
          <span
            className="sa-arena-minimap__view"
            style={{ left: percent(view.x), top: percent(view.y), width: percent(view.width), height: percent(view.height) }}
          />
        </div>
      </div>
    </div>
  );
}
