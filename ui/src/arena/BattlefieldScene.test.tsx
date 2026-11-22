import { useAppApi } from '@kirocrew/app-sdk';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSceneAssetsFailing } from '@kirocrew/app-sdk';
import { BattlefieldScene } from './BattlefieldScene';
import type { ExchangeSnapshot } from './exchangePlanner';
import type { PresentationCue } from './PresentationCueLayer';
import { clearSceneArtCache } from './sceneAssetCache';
import { buildSceneModel } from './sceneModel';
import type { ArenaSelection } from './selection';
import { botOf, creditedOf, inputsOf, specterOf, taskOf, xpOf } from './testData';

const atlas = botOf(1, { displayName: 'Atlas', state: 'working' });
const brindle = botOf(2, { displayName: 'Brindle' });
const dune = botOf(3, { displayName: 'Dune', state: 'unknown' });

const work = [
  taskOf(1, atlas, { kind: 'worker', runMs: 90_000 }),
  taskOf(2, atlas, { kind: 'bot-turn', runMs: 300_000 }),
  taskOf(3, atlas, { kind: 'worker', runMs: 1_000_000 }),
  creditedOf(4, atlas, { kind: 'worker', runMs: 600_000, xpCredited: 14 }),
];

const model = buildSceneModel(inputsOf({ roster: [atlas, brindle, dune], specters: [specterOf(atlas, 'Vesper'), specterOf(brindle, 'Wisp'), specterOf(dune, 'Murk')], xp: [xpOf(atlas, 250, 3)], tasks: work }));
const motion = { animate: true, paused: false, togglePause: vi.fn() };

function show(props: { selection?: ArenaSelection | null; onSelect?: (s: ArenaSelection) => void; animate?: boolean; paused?: boolean; toggle?: () => void; cues?: PresentationCue[]; celebrating?: Set<string>; onCueComplete?: (id: string) => void } = {}) {
  return render(
    <BattlefieldScene
      model={model}
     
      selection={props.selection ?? null}
      onSelect={props.onSelect ?? vi.fn()}
      motion={{ animate: props.animate ?? true, paused: props.paused ?? false, togglePause: props.toggle ?? motion.togglePause }}
      cues={props.cues ?? []}
      celebrating={props.celebrating ?? new Set()}
      onCueComplete={props.onCueComplete ?? vi.fn()}
    />,
  );
}

beforeEach(() => clearSceneArtCache());
afterEach(() => {
  setSceneAssetsFailing(false);
  vi.restoreAllMocks();
});

describe('a waiting Specter', () => {
  it('is announced as Waiting on you, never as No turn running, and is not engaging', () => {
    const fenn = botOf(4, { displayName: 'Fenn', state: 'waiting' });
    const waitingModel = buildSceneModel(inputsOf({ roster: [fenn], specters: [specterOf(fenn, 'Hollow')] }));
    render(<BattlefieldScene model={waitingModel} selection={null} onSelect={vi.fn()} motion={motion} cues={[]} celebrating={new Set()} onCueComplete={vi.fn()} />);
    const token = screen.getByRole('button', { name: /^Hollow for Fenn, Waiting on you, Level 1$/ });
    expect(token.className).not.toContain('sa-is-engaging');
    expect(token.getAttribute('aria-label')).not.toContain('No turn running');
  });
});

describe('tokens', () => {
  it('has one named button per specter and per enemy with a sprite marker each', () => {
    const { container } = show();
    expect(container.querySelectorAll('[data-sprite]')).toHaveLength(3 + 4);
    expect(container.querySelectorAll('[data-scene-node]')).toHaveLength(7);
    expect(screen.getByRole('button', { name: /^Vesper ×3 attempts for Atlas, Working, Level 3, 3 open attempts$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Wisp for Brindle, No turn running, Level 1$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Murk for Dune.*Coverage unknown/ })).toBeTruthy();
  });

  it('draws no token for a bot that has no Specter yet, and keeps it out of the keyboard order', () => {
    const noHero = buildSceneModel(inputsOf({ roster: [atlas, brindle], specters: [specterOf(atlas, 'Vesper')], tasks: [work[0]!] }));
    const { container } = render(<BattlefieldScene model={noHero} selection={null} onSelect={vi.fn()} motion={motion} cues={[]} celebrating={new Set()} onCueComplete={vi.fn()} />);
    expect(container.querySelectorAll('[data-sprite="specter"]')).toHaveLength(1);
    expect(container.querySelector(`[data-token="${brindle.bindingId}"]`)).toBeNull();
    expect(screen.queryByText(/no Specter yet/i)).toBeNull();
    const first = container.querySelector<HTMLElement>('[data-scene-node]')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(container.querySelectorAll('[data-scene-node]')[1]);
  });

  it('shows one specter node for three attempts with a count badge, never clones', () => {
    const { container } = show();
    expect(container.querySelectorAll('[data-token="' + atlas.bindingId + '"]')).toHaveLength(1);
    expect(screen.getByText('×3 attempts')).toBeTruthy();
  });

  it('names enemies by their kind and run time, state, progress and the word task, and never by size', () => {
    show();
    expect(screen.getByRole('button', { name: 'Worker task · 1 min, Running, Progress unknown, task' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bot turn · 5 min, Running, Progress unknown, task' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Worker task · 16 min, Running, Progress unknown, task' })).toBeTruthy();
  });

  it('gives every token an accessible name that contains the words printed on it (WCAG 2.5.3)', () => {
    const { container } = show();
    const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}+\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    const tokens = [...container.querySelectorAll<HTMLElement>('[data-scene-node]')];
    expect(tokens).toHaveLength(7);
    for (const token of tokens) {
      expect(words(token.getAttribute('aria-label') ?? ''), token.getAttribute('aria-label') ?? '').toContain(words(token.textContent ?? ''));
    }
  });

  it('shows the defeated pose with its committed XP and no animation class', () => {
    show();
    const shipped = screen.getByRole('button', { name: /^Worker task · 10 min, Defeated.*\+14 XP, task$/ });
    expect(within(shipped).getByText('+14 XP')).toBeTruthy();
    expect(shipped.className).toContain('sa-is-defeated');
    expect(shipped.querySelector('.sa-is-animated')).toBeNull();
    expect(shipped.querySelector('.sa-is-static')).not.toBeNull();
  });

  it('draws one engagement line per engaged pair, one for each running task of the bot', () => {
    const { container } = show();
    expect(container.querySelectorAll('.sa-arena-engage')).toHaveLength(3);
    expect(container.querySelector('[data-engage]')?.getAttribute('data-engage')).toBe(`${atlas.bindingId}:${work[0]?.taskId}`);
  });

  it('marks the selected token with aria-pressed and reports selections', () => {
    const onSelect = vi.fn();
    show({ onSelect, selection: { kind: 'work', workId: work[2]!.taskId } });
    expect(screen.getByRole('button', { name: /^Worker task · 16 min/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /^Worker task · 10 min/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: /^Worker task · 10 min/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'work', workId: work[3]!.taskId });
    fireEvent.click(screen.getByRole('button', { name: /^Vesper ×3 attempts for Atlas/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'specter', bindingId: atlas.bindingId });
  });
});

describe('hero placement and minion size', () => {
  const heroSpots = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-sprite="specter"]')].map((node) => [node.dataset.token, node.style.left, node.style.top]);
  const percent = (text: string) => Number.parseFloat(text);
  const props = { selection: null, onSelect: vi.fn(), motion, cues: [], celebrating: new Set<string>(), onCueComplete: vi.fn() };

  it('stands every hero in the lower map, a cell apart', () => {
    const { container } = render(<BattlefieldScene model={model} {...props} visitSeed={11} />);
    const spots = heroSpots(container);
    expect(spots).toHaveLength(3);
    for (const [, left, top] of spots) {
      expect(percent(top as string)).toBeGreaterThanOrEqual(60);
      expect(percent(top as string)).toBeLessThanOrEqual(95);
      expect(percent(left as string)).toBeGreaterThanOrEqual(6);
      expect(percent(left as string)).toBeLessThanOrEqual(94);
    }
  });

  it('keeps the same spots for the same seed, and moves them for another', () => {
    const one = heroSpots(render(<BattlefieldScene model={model} {...props} visitSeed={11} />).container);
    const same = heroSpots(render(<BattlefieldScene model={model} {...props} visitSeed={11} />).container);
    const other = heroSpots(render(<BattlefieldScene model={model} {...props} visitSeed={12} />).container);
    expect(same).toEqual(one);
    expect(other).not.toEqual(one);
  });

  it('does not move a hero on a later poll, and a joining bot leaves the others where they stand', () => {
    const { container, rerender } = render(<BattlefieldScene model={model} {...props} visitSeed={11} />);
    const before = heroSpots(container);
    const polled = buildSceneModel(inputsOf({ roster: [atlas, brindle, dune], specters: [specterOf(atlas, 'Vesper'), specterOf(brindle, 'Wisp'), specterOf(dune, 'Murk')], xp: [xpOf(atlas, 251, 3)], tasks: work }));
    rerender(<BattlefieldScene model={polled} {...props} visitSeed={11} />);
    expect(heroSpots(container)).toEqual(before);
    const fenn = botOf(4, { displayName: 'Fenn' });
    const joined = buildSceneModel(inputsOf({ roster: [atlas, brindle, dune, fenn], specters: [specterOf(atlas, 'Vesper'), specterOf(brindle, 'Wisp'), specterOf(dune, 'Murk'), specterOf(fenn, 'Hollow')], tasks: work }));
    rerender(<BattlefieldScene model={joined} {...props} visitSeed={11} />);
    const after = heroSpots(container);
    expect(after).toHaveLength(4);
    for (const spot of before) expect(after).toContainEqual(spot);
  });

  it('sets the minion scale from the size class on each token and a base size on the stage', () => {
    const { container } = render(<BattlefieldScene model={model} {...props} />);
    const byClass = new Map<string, string>();
    for (const token of container.querySelectorAll<HTMLElement>('[data-sprite="enemy"]')) byClass.set(token.dataset.sizeClass as string, token.style.getPropertyValue('--sa-minion-scale'));
    expect(Object.fromEntries(byClass)).toEqual({ small: '0.8', medium: '1', large: '1.3' });
    expect(container.querySelector<HTMLElement>('.sa-arena-stage')?.style.getPropertyValue('--sa-minion-base')).toBe('28.00px');
  });

  it('puts the overview after the map frame, not inside it', () => {
    const { container } = render(<BattlefieldScene model={model} {...props} />);
    const minimap = container.querySelector('.sa-arena-minimap');
    expect(minimap).not.toBeNull();
    expect(container.querySelector('.sa-arena-frame')?.contains(minimap)).toBe(false);
    expect(minimap?.parentElement).toBe(container.querySelector('.sa-arena-scene'));
    expect(container.querySelector('.sa-arena-frame')?.nextElementSibling).toBe(minimap);
  });
});

describe('roving focus', () => {
  it('has one tab stop and moves it with the arrow keys, Home and End', () => {
    const { container } = show();
    const stops = () => [...container.querySelectorAll<HTMLElement>('[data-scene-node]')].filter((node) => node.tabIndex === 0);
    expect(stops()).toHaveLength(1);
    const first = stops()[0]!;
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = stops()[0]!;
    expect(second).not.toBe(first);
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(container.querySelectorAll('[data-scene-node]')[6]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document.activeElement!, { key: 'x' });
    expect(stops()).toHaveLength(1);
  });

  it('ignores keys that do not come from a token', () => {
    show();
    fireEvent.keyDown(screen.getByRole('group', { name: 'Arena map' }), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(document.body);
  });
});

describe('camera and controls', () => {
  it('zooms in steps inside 1 to 2.5, announces it, and fits and resets', () => {
    show();
    const zoom = () => screen.getByLabelText('Zoom').textContent;
    expect(zoom()).toBe('1.00×');
    expect(screen.getByRole('button', { name: 'Zoom out' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoom()).toBe('1.25×');
    for (let i = 0; i < 8; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoom()).toBe('2.50×');
    expect(screen.getByRole('button', { name: 'Zoom in' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(zoom()).toBe('2.25×');
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(zoom()).toBe('2.25×');
    fireEvent.click(screen.getByRole('button', { name: 'Fit map' }));
    expect(zoom()).toBe('1.00×');
    expect(screen.getByLabelText('Zoom').getAttribute('aria-live')).toBe('polite');
  });

  it('pans by dragging the map but not by pressing a token, and stops when the pointer is released', () => {
    const { container } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const viewport = screen.getByRole('group', { name: 'Arena map' });
    const stage = container.querySelector<HTMLElement>('.sa-arena-stage')!;
    const left = () => stage.style.left;
    const before = left();
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Worker task · 10 min/ }), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(viewport, { clientX: 60, clientY: 10 });
    expect(left()).toBe(before);
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { clientX: 60, clientY: 90 });
    expect(left()).not.toBe(before);
    const moved = left();
    fireEvent.pointerUp(viewport);
    fireEvent.pointerMove(viewport, { clientX: 0, clientY: 0 });
    expect(left()).toBe(moved);
    fireEvent.pointerDown(viewport, { clientX: 1, clientY: 1 });
    fireEvent.pointerLeave(viewport);
    fireEvent.pointerCancel(viewport);
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(left()).toBe(before);
  });

  it('toggles the animation pause through the motion gate only', () => {
    const toggle = vi.fn();
    const { rerender, container } = show({ toggle });
    expect(container.querySelector('.sa-arena-scene')?.className).toContain('sa-is-animated');
    fireEvent.click(screen.getByRole('button', { name: 'Pause animation' }));
    expect(toggle).toHaveBeenCalledTimes(1);
    rerender(<BattlefieldScene model={model} selection={null} onSelect={vi.fn()} motion={{ animate: false, paused: true, togglePause: toggle }} cues={[]} celebrating={new Set()} onCueComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Resume animation' }).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.sa-arena-scene')?.className).toContain('sa-is-static');
  });

  it('toggles the overview', () => {
    show();
    const button = screen.getByRole('button', { name: 'Hide overview' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Show overview' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('makes no request of its own besides the scene art reads, whatever the user does', async () => {
    const get = vi.spyOn(useAppApi(), 'get');
    const post = vi.spyOn(useAppApi(), 'post');
    const { container } = show();
    await waitFor(() => expect(container.querySelector('[data-map="ready"]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause animation' }));
    fireEvent.click(screen.getByRole('button', { name: /^Worker task · 10 min/ }));
    fireEvent(window, new Event('resize'));
    expect(post).not.toHaveBeenCalled();
    expect(get.mock.calls.every(([path]) => /\/scene-assets\//.test(String(path)))).toBe(true);
    expect(get.mock.calls.length).toBeLessThanOrEqual(6);
  });
});

describe('art', () => {
  it('draws every Specter as a sprite image and never as a CSS variable', async () => {
    const { container } = show();
    await waitFor(() => expect(container.querySelector('.sa-hero__img')).not.toBeNull());
    const sprite = container.querySelector('.sa-hero__img');
    expect(sprite?.tagName).toBe('IMG');
    expect(sprite?.getAttribute('src')).toMatch(/^(?:blob:|data:image\/png;base64,)/);
    expect(sprite?.getAttribute('alt')).toBe('');
    await waitFor(() => expect(container.querySelectorAll('.sa-hero')).toHaveLength(3));
    expect(container.querySelectorAll('.sa-token__placeholder')).toHaveLength(0);
    expect(container.querySelector<HTMLElement>('.sa-arena-scene')?.getAttribute('style') ?? '').not.toContain('hero');
  });

  it('shows the initials placeholder for a hero whose sprite fails, and keeps the token selectable', async () => {
    setSceneAssetsFailing(true);
    const { container } = show();
    await waitFor(() => expect(container.querySelector('[data-map="failed"]')).not.toBeNull());
    expect(container.querySelectorAll('.sa-hero')).toHaveLength(0);
    expect(container.querySelectorAll('.sa-token__placeholder')).toHaveLength(3);
  });

  it('idles only while motion is allowed', async () => {
    const { container, rerender } = show();
    await waitFor(() => expect(container.querySelector('.sa-hero')).not.toBeNull());
    expect(container.querySelector('.sa-hero')?.className).toContain('sa-is-animated');
    rerender(<BattlefieldScene model={model} selection={null} onSelect={vi.fn()} motion={{ animate: false, paused: true, togglePause: vi.fn() }} cues={[]} celebrating={new Set()} onCueComplete={vi.fn()} />);
    expect(container.querySelector('.sa-hero')?.className).toContain('sa-is-static');
    expect(container.querySelector('.sa-hero')?.className).not.toContain('sa-is-animated');
  });

  it('puts loaded art in CSS variables as blob URLs and uses sprites for the minions', async () => {
    const { container } = show();
    await waitFor(() => expect(container.querySelector('[data-map="ready"]')).not.toBeNull());
    const section = container.querySelector<HTMLElement>('.sa-arena-scene')!;
    await waitFor(() => expect(section.style.getPropertyValue('--sa-sprite-patchbrute')).toContain('blob:'));
    expect(section.style.getPropertyValue('--sa-map')).toContain('blob:');
    expect(section.style.getPropertyValue('--sa-sprite-patchling')).toContain('blob:');
    expect(container.querySelectorAll('.sa-minion__art').length).toBe(4);
    expect(container.querySelector('.sa-arena-map')?.className).toContain('sa-has-art');
  });

  it('shows a plate and the drawn fallbacks when the art fails, and stays selectable', async () => {
    setSceneAssetsFailing(true);
    const onSelect = vi.fn();
    const { container } = show({ onSelect });
    await waitFor(() => expect(container.querySelector('[data-map="failed"]')).not.toBeNull());
    expect(screen.getByText('Map art is not available. Positions are still correct.')).toBeTruthy();
    await act(async () => undefined);
    expect(container.querySelectorAll('svg.sa-minion__fallback').length).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: /^Worker task · 16 min/ }));
    expect(onSelect).toHaveBeenCalled();
  });
});

describe('reduced motion', () => {
  it('adds no animated class and starts no timer when animation is off', () => {
    const spy = vi.spyOn(window, 'setTimeout');
    const { container } = show({ animate: false });
    expect(container.querySelectorAll('.sa-is-animated')).toHaveLength(0);
    expect(container.querySelectorAll('.sa-is-static').length).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('empty model', () => {
  it('draws only the map when there is nothing to show', () => {
    const empty = buildSceneModel(inputsOf());
    const { container } = render(<BattlefieldScene model={empty} selection={null} onSelect={vi.fn()} motion={motion} cues={[]} celebrating={new Set()} onCueComplete={vi.fn()} />);
    expect(container.querySelectorAll('[data-scene-node]')).toHaveLength(0);
    expect(screen.getByRole('group', { name: 'Arena map' })).toBeTruthy();
  });
});

describe('celebration', () => {
  const shipped = model.enemies.find((enemy) => enemy.title === 'Worker task · 10 min')!;
  const cue: PresentationCue = { id: 'c1', workId: shipped.workId, title: 'Worker task · 10 min', committedXp: 100, durationMs: 1_800 };

  it('plays the defeat animation on the celebrating enemy only, and shows the cue', () => {
    const { container } = show({ cues: [cue], celebrating: new Set([shipped.workId]) });
    expect(container.querySelectorAll('.sa-minion.sa-is-defeat.sa-is-animated')).toHaveLength(1);
    expect(container.querySelector(`[data-token="${shipped.workId}"] .sa-is-defeat`)).not.toBeNull();
    expect(container.querySelector('[data-cue]')?.textContent).toContain('Worker task · 10 min · +100 XP');
  });

  it('keeps every defeated enemy a still, labelled pose when nothing is celebrating', () => {
    const { container } = show();
    expect(container.querySelectorAll('.sa-is-defeat')).toHaveLength(0);
    expect(container.querySelector(`[data-token="${shipped.workId}"] .sa-is-defeated`)).not.toBeNull();
    expect(container.querySelector('[data-cue]')).toBeNull();
  });

  it('reports completion of a cue to its owner', () => {
    vi.useFakeTimers();
    const onCueComplete = vi.fn();
    show({ cues: [cue], celebrating: new Set([shipped.workId]), onCueComplete });
    act(() => void vi.advanceTimersByTime(1_800));
    expect(onCueComplete).toHaveBeenCalledExactlyOnceWith('c1');
    vi.useRealTimers();
  });
});

describe('exchanges and the paused collector', () => {
  const attacking = (kind: 'attack' | 'cast', recoilFrom: string | null = atlas.bindingId): ExchangeSnapshot => ({
    heroes: new Map([[atlas.bindingId, { exchangeId: 7, kind, workId: model.enemies[0]!.workId }]]),
    enemies: new Map([[model.enemies[0]!.workId, { exchangeId: 7, strong: kind === 'cast', bindingId: recoilFrom }]]),
    layers: 1,
  });

  it('draws the hero attack layer and the enemy hit for the exchange, and nothing without one', async () => {
    const { container, rerender } = show();
    await waitFor(() => expect(container.querySelector('.sa-hero')).not.toBeNull());
    expect(container.querySelector('.sa-hero__fx')).toBeNull();
    expect(container.querySelector('.sa-is-hit')).toBeNull();
    expect(container.querySelector('.sa-strike')).toBeNull();
    const props = { model, selection: null, onSelect: vi.fn(), motion, cues: [], celebrating: new Set<string>(), onCueComplete: vi.fn() };
    rerender(<BattlefieldScene {...props} exchanges={attacking('attack')} />);
    await waitFor(() => expect(container.querySelector('.sa-hero.sa-is-attack')).not.toBeNull());
    expect(container.querySelector('.sa-hero__fx')).not.toBeNull();
    expect(container.querySelectorAll('.sa-strike--attack')).toHaveLength(1);
    const hit = container.querySelector<HTMLElement>('.sa-minion.sa-is-hit');
    expect(hit).not.toBeNull();
    expect(['-1', '1']).toContain(hit?.style.getPropertyValue('--sa-recoil'));
    rerender(<BattlefieldScene {...props} exchanges={attacking('cast', null)} />);
    await waitFor(() => expect(container.querySelector('.sa-hero.sa-is-cast')).not.toBeNull());
    expect(container.querySelectorAll('.sa-strike--cast')).toHaveLength(1);
    expect(container.querySelector('.sa-minion.sa-is-hit.sa-is-strong')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('.sa-minion.sa-is-hit')?.style.getPropertyValue('--sa-recoil')).toBe('1');
  });

  it('shows one status plate and no exchange effect when the collector is paused', () => {
    const { container, rerender } = show();
    expect(container.querySelector('.sa-arena-plate--paused')).toBeNull();
    rerender(<BattlefieldScene model={model} selection={null} onSelect={vi.fn()} motion={motion} cues={[]} celebrating={new Set()} onCueComplete={vi.fn()} collectorPaused />);
    const plate = container.querySelector('.sa-arena-plate--paused');
    expect(plate?.getAttribute('role')).toBe('status');
    expect(plate?.textContent).toBe('Collection paused. Nothing new is being recorded.');
  });
});

describe('the waiting marker and XP words', () => {
  const waiting = (reasonCode: string) => botOf(4, { displayName: 'Fenn', state: 'waiting', condition: { ...botOf(4).condition, state: 'waiting', reasonCode } });
  const scene = (bot: ReturnType<typeof botOf>, xpStatus?: 'loading' | 'failed') => buildSceneModel(inputsOf({ roster: [bot], specters: [specterOf(bot, 'Hollow')], xpStatus }));
  const draw = (m: ReturnType<typeof scene>) => render(<BattlefieldScene model={m} selection={null} onSelect={vi.fn()} motion={motion} cues={[]} celebrating={new Set()} onCueComplete={vi.fn()} />);

  it('draws the awaiting-approval marker for approval-pending only, as a hidden drawing', () => {
    const approval = draw(scene(waiting('approval-pending')));
    expect(approval.container.querySelectorAll('svg.sa-token__marker')).toHaveLength(1);
    expect(approval.container.querySelector('svg.sa-token__marker')?.getAttribute('aria-hidden')).toBe('true');
    approval.unmount();
    expect(draw(scene(waiting('question-pending'))).container.querySelectorAll('svg.sa-token__marker')).toHaveLength(0);
  });

  it('leaves the level out of the name while the ledger has not been read', () => {
    draw(scene(botOf(1, { displayName: 'Atlas' }), 'loading'));
    expect(screen.getByRole('button', { name: /^Hollow for Atlas, No turn running$/ })).toBeTruthy();
  });
});
