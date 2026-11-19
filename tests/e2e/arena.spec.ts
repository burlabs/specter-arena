import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const FIXTURE_LABEL = 'FIXTURE — demo data, not Crew activity';
const sectionTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name });
const arena = (page: Page) => page.getByRole('region', { name: 'Arena', exact: true });
const listView = (page: Page) => page.getByRole('region', { name: 'Arena list' });
const rows = (page: Page, caption: string) => listView(page).getByRole('table', { name: caption }).locator('tbody tr');
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __specterFixtureCalls: { method: string; path: string }[] }).__specterFixtureCalls);
const writes = async (page: Page) => (await calls(page)).filter((call) => call.method !== 'GET');

async function openArena(page: Page, scenario: string) {
  await page.goto(`./?scenario=${scenario}`);
  await expect(page.getByRole('list', { name: 'Bots' })).toBeVisible();
  await sectionTab(page, 'Arena').click();
  await expect(page.getByRole('group', { name: 'Arena map' })).toBeVisible();
  await expect(listView(page)).toBeVisible();
}

test('A-1 Arena is the fourth tab, reached by keyboard, and the others keep their order', async ({ page }) => {
  await page.goto('./?scenario=arena');
  await expect(sectionTab(page, 'Roster')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Sections' }).getByRole('tab')).toHaveText(['Roster', 'Specters', 'Work', 'Arena']);
  await sectionTab(page, 'Roster').focus();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press('ArrowRight');
  await expect(sectionTab(page, 'Arena')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(sectionTab(page, 'Work')).toHaveAttribute('aria-selected', 'true');
});

test('A-2 the arena and its list view say FIXTURE and never LIVE, and never "waiting on you"', async ({ page }) => {
  await openArena(page, 'arena');
  await expect(arena(page).getByText(FIXTURE_LABEL)).toHaveCount(2);
  await expect(listView(page).getByText(FIXTURE_LABEL)).toBeVisible();
  await expect(arena(page)).not.toContainText(/\bLIVE\b/);
  await expect(page.locator('body')).not.toContainText(/waiting on you/i);
});

test('A-3 every bot appears once in the scene and once in the list; concurrent attempts show a count, not clones', async ({ page }) => {
  await openArena(page, 'arena');
  await sectionTab(page, 'Roster').click();
  const names = await page.getByRole('list', { name: 'Bots' }).locator('li strong').allTextContents();
  expect(names).toHaveLength(7);
  await sectionTab(page, 'Arena').click();
  await expect(page.locator('[data-sprite="specter"]')).toHaveCount(names.length);
  await expect(rows(page, 'Specters')).toHaveCount(names.length);
  for (const name of names) await expect(listView(page).getByRole('table', { name: 'Specters' }).getByRole('button', { name, exact: true })).toHaveCount(1);

  await openArena(page, 'arena-perf-1');
  await expect(page.locator('[data-sprite="specter"]')).toHaveCount(20);
  await expect(arena(page).getByText('×3 attempts')).toHaveCount(6);
});

test('A-4 blocked and awaiting-review are labelled; progress is "N of M" or unknown, never a percentage', async ({ page }) => {
  await openArena(page, 'arena');
  await expect(listView(page)).toContainText('Blocked');
  await expect(listView(page)).toContainText('Awaiting your review');
  await expect(listView(page)).toContainText('Progress unknown');
  await expect(listView(page)).toContainText(/\d of \d milestones done/);
  await expect(arena(page)).not.toContainText(/\d\s?%/);
});

test('A-5 selecting, zooming, resizing, pausing and reloading under reduced motion send no write', async ({ page }) => {
  await openArena(page, 'arena');
  await page.locator('[data-sprite="enemy"]').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-sprite="enemy"]').first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await listView(page).getByRole('button', { name: 'Blocked', exact: true }).click();
  await page.setViewportSize({ width: 480, height: 800 });
  expect(await writes(page)).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await sectionTab(page, 'Arena').click();
  await expect(page.getByRole('group', { name: 'Arena map' })).toBeVisible();
  expect(await writes(page)).toEqual([]);
  expect((await calls(page)).length).toBeGreaterThan(0);
});

test('A-6 with reduced motion nothing animates and no animation frame callback runs', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __raf: number };
    w.__raf = 0;
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      w.__raf += 1;
      return original(callback);
    };
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openArena(page, 'arena');
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as { __raf: number }).__raf)).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await expect(page.locator('.sa-is-animated')).toHaveCount(0);
});

test('A-7 arena-perf-1 stays inside its node budget and lists everything', async ({ page }) => {
  await openArena(page, 'arena-perf-1');
  await expect(page.locator('[data-sprite="enemy"]')).toHaveCount(80);
  expect(await page.locator('[data-scene-node]').count()).toBeLessThanOrEqual(160);
  await expect(rows(page, 'Specters')).toHaveCount(20);
  await expect(rows(page, 'Work')).toHaveCount(112);
  await expect(listView(page).getByText('32 more on-field items are listed below and not drawn in the scene.')).toBeVisible();
  expect(await page.evaluate(() => performance.getEntriesByName('arena:first-render').length)).toBeGreaterThan(0);
  expect(await writes(page)).toEqual([]);
});

const inspector = (page: Page) => page.getByRole('complementary', { name: 'Encounter inspector' });
const inspectorHeading = (page: Page) => inspector(page).getByRole('heading', { level: 2 });
const workButton = (page: Page, title: string) => listView(page).getByRole('table', { name: 'Work' }).getByRole('button', { name: new RegExp(`^${title}`) });
const specterButton = (page: Page, name: string) => listView(page).getByRole('table', { name: 'Specters' }).getByRole('button', { name, exact: true });
const navigations = (page: Page) => page.evaluate(() => (window as unknown as { __specterFixtureNavigations?: string[] }).__specterFixtureNavigations ?? []);
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

async function tabTo(page: Page, target: Locator, maxTabs = 60) {
  for (let i = 0; i < maxTabs; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('The target never received focus by Tab');
}

async function acceptInInspector(page: Page, title: string) {
  await workButton(page, title).click();
  await expect(inspectorHeading(page)).toHaveText(title);
  await inspector(page).getByRole('button', { name: 'Accept…' }).click();
  await inspector(page).getByRole('checkbox', { name: /I reviewed the evidence above/ }).check();
  await inspector(page).getByRole('button', { name: 'Accept work' }).click();
}

test('A-8 keyboard only: select a Specter, inspect it, open its work, reach the Crew handoff and the summary, and Escape returns', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openArena(page, 'arena');
  const token = page.getByRole('group', { name: 'Arena map' }).getByRole('button', { name: /Atlas/ }).first();
  await token.focus();
  await page.keyboard.press('Enter');
  await expect(inspectorHeading(page)).toBeFocused();
  for (const name of ['Attempts', 'Coverage', 'XP ledger', 'Source details']) await expect(inspector(page).getByRole('heading', { level: 3, name })).toBeVisible();

  const firstWork = inspector(page).getByRole('region', { name: 'Open work' }).getByRole('button').first();
  const title = (await firstWork.textContent()) ?? '';
  await tabTo(page, firstWork);
  await page.keyboard.press('Enter');
  await expect(inspectorHeading(page)).toHaveText(title);
  await expect(inspectorHeading(page)).toBeFocused();
  for (const name of ['Where it stands', 'Evidence', 'Contributors', 'Decisions, newest first']) await expect(inspector(page).getByRole('heading', { level: 3, name })).toBeVisible();

  await tabTo(page, inspector(page).getByRole('link', { name: 'Open Bots in Crew' }));
  await page.keyboard.press('Enter');
  expect(await navigations(page)).toEqual(['/members']);
  await expect(inspector(page)).toContainText("Opens the Bots page in Crew. It cannot open this bot's chat or approvals directly.");

  await tabTo(page, inspector(page).getByRole('button', { name: 'Copy diagnostic summary' }));
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByText('Copied.')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.length).toBeLessThanOrEqual(4000);
  expect(copied).toContain('Specter Arena diagnostic summary');
  expect(copied).not.toMatch(/https?:\/\/|Bearer|token=/i);

  await page.keyboard.press('Escape');
  await expect(token).toBeFocused();
  await expect(inspector(page)).toContainText('Select a Specter or an enemy');
  expect(await writes(page)).toEqual([]);
});

test('A-9 accepting in the inspector makes exactly one write, defeats the enemy once with the committed XP, and a return shows the pose without a cue', async ({ page }) => {
  await openArena(page, 'arena');
  expect(await page.locator('[data-cue]').count()).toBe(0);
  await acceptInInspector(page, 'Migrate the nightly report');
  await expect(page.locator('[data-cue]')).toHaveCount(1);
  const cueText = (await page.locator('[data-cue]').textContent()) ?? '';
  const xp = Number(/\+(\d+) XP/.exec(cueText)?.[1]);
  expect(xp).toBeGreaterThan(0);
  await expect(page.locator('[data-cue]')).toHaveCount(0, { timeout: 6000 });
  const defeated = page.locator('[data-sprite="enemy"]', { hasText: 'Migrate the nightly report' });
  await expect(defeated).toContainText('Defeated');
  await expect(defeated).toContainText(`+${xp} XP`);

  const accepted = await writes(page);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]?.method).toBe('POST');
  expect(accepted[0]?.path).toMatch(/\/work\/wrk_[a-z0-9]+\/decisions$/);

  await sectionTab(page, 'Work').click();
  await page.getByRole('list', { name: 'Work items' }).getByRole('button', { name: /^Migrate the nightly report/ }).click();
  const contributors = await page.getByRole('region', { name: 'Work detail' }).getByRole('list', { name: 'Contributors' }).locator('li').allTextContents();
  expect(contributors.reduce((sum, line) => sum + Number(/(\d+) XP/.exec(line)?.[1] ?? 0), 0)).toBe(xp);

  await sectionTab(page, 'Roster').click();
  await sectionTab(page, 'Arena').click();
  await expect(page.getByRole('group', { name: 'Arena map' })).toBeVisible();
  await expect(page.locator('[data-sprite="enemy"]', { hasText: 'Migrate the nightly report' })).toContainText('Defeated');
  expect(await page.locator('[data-cue]').count()).toBe(0);
  expect(await writes(page)).toHaveLength(1);
});

test('A-10 a defeat that happened while the tab was hidden, or after a long gap, shows the pose and the coverage line but no cue', async ({ page }) => {
  await page.clock.install();
  await openArena(page, 'arena');
  await setVisibility(page, 'hidden');
  await acceptInInspector(page, 'Migrate the nightly report');
  await page.clock.runFor(1000);
  const defeated = page.locator('[data-sprite="enemy"]', { hasText: 'Migrate the nightly report' });
  await expect(defeated).toContainText('Defeated');
  await page.clock.fastForward(10 * 60_000);
  await setVisibility(page, 'visible');
  await page.clock.runFor(15_000);
  await expect(defeated).toContainText('Defeated');
  expect(await page.locator('[data-cue]').count()).toBe(0);
  await expect(arena(page).getByText(/^Coverage: /)).toBeVisible();
  await expect(arena(page).getByText(/^As of/)).toBeVisible();
  expect((await writes(page)).length).toBe(1);
});

test('A-10b with reduced motion a defeat is a static label: no cue, no running animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openArena(page, 'arena');
  await acceptInInspector(page, 'Migrate the nightly report');
  const defeated = page.locator('[data-sprite="enemy"]', { hasText: 'Migrate the nightly report' });
  await expect(defeated).toContainText('Defeated');
  await expect(defeated).toContainText(/\+\d+ XP/);
  expect(await page.locator('[data-cue]').count()).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('A-11 a vanished item and a vanished bot show a fallback and keep none of the earlier evidence', async ({ page }) => {
  await openArena(page, 'arena-stale');
  await workButton(page, 'Audit the shared drive permissions').click();
  await expect(inspectorHeading(page)).toHaveText('This item is no longer available');
  await expect(inspector(page)).not.toContainText('Waiting on the file owner');
  await expect(inspector(page).getByRole('button', { name: 'Accept…' })).toHaveCount(0);
  await expect(inspector(page).getByRole('button', { name: 'Copy diagnostic summary' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/waiting on you/i);
});

test('A-11b a bot that leaves the roster clears its Specter evidence at the next read', async ({ page }) => {
  await page.clock.install();
  await openArena(page, 'arena-stale');
  await specterButton(page, 'Fenn').click();
  await expect(inspectorHeading(page)).toHaveText('Poly');
  await expect(inspector(page).getByRole('heading', { level: 3, name: 'XP ledger' })).toBeVisible();
  await page.clock.runFor(16_000);
  await expect(inspectorHeading(page)).toHaveText('This item is no longer available');
  await expect(inspector(page).getByRole('heading', { level: 3, name: 'XP ledger' })).toHaveCount(0);
  await expect(inspector(page).getByRole('heading', { level: 3, name: 'Attempts' })).toHaveCount(0);
});

test('A-12 clicking every token, marker and handoff makes no write', async ({ page }) => {
  await openArena(page, 'arena');
  const nodes = page.locator('[data-scene-node]');
  const count = await nodes.count();
  expect(count).toBeGreaterThan(10);
  for (let i = 0; i < count; i += 1) await nodes.nth(i).click({ force: true });
  const markers = page.locator('.sa-token__marker');
  expect(await markers.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await markers.count()); i += 1) await markers.nth(i).click({ force: true });
  await inspector(page).getByRole('link', { name: 'Open Bots in Crew' }).click();
  await inspector(page).getByRole('button', { name: 'Copy diagnostic summary' }).click();
  expect(await navigations(page)).toContain('/members');
  expect(await writes(page)).toEqual([]);
  expect((await calls(page)).every((call) => call.method === 'GET')).toBe(true);
});

const sysctl = (key: string): string | null => {
  try {
    return execFileSync('sysctl', ['-n', key], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
const swVers = (): string | null => {
  try {
    return execFileSync('sw_vers', { encoding: 'utf8' }).trim().replace(/\n/g, '; ');
  } catch {
    return null;
  }
};
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

test('A-13 arena-perf-1 measured: first render, poll update, sprite nodes, animation frames and animations', async ({ browser }) => {
  test.setTimeout(180_000);
  const loose = process.env.CI ? 3 : 1;
  const budget = { firstRenderMs: 500 * loose, updateMs: 50 * loose, nodes: 160 };
  const machine = {
    platform: os.platform(),
    release: os.release(),
    swVers: swVers(),
    cpu: sysctl('machdep.cpu.brand_string') ?? os.cpus()[0]?.model ?? null,
    logicalCpus: os.cpus().length,
    memBytes: Number(sysctl('hw.memsize') ?? os.totalmem()),
    model: sysctl('hw.model'),
    node: process.version,
    chromium: browser.version(),
  };
  const full: { firstRenderMs: number; updateMs: number; scriptMs: number; longestTaskMs: number; spriteNodes: number; enemies: number; specters: number }[] = [];
  const reduced: { rafCallbacks: number; runningAnimations: number; animatedClasses: number }[] = [];

  for (let run = 0; run < 5; run += 1) {
    const context = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC', baseURL: 'http://127.0.0.1:4173/' });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      new PerformanceObserver((list) => list.getEntries().forEach((entry) => w.__long.push(entry.duration))).observe({ type: 'longtask', buffered: true });
    });
    await openArena(page, 'arena-perf-1');
    await page.waitForFunction(() => performance.getEntriesByName('arena:first-render').length > 0);
    const firstRenderMs = await page.evaluate(() => performance.measure('first', 'arena:data-ready', 'arena:first-render').duration);
    await page.waitForTimeout(500);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const scriptDuration = async () => ((await cdp.send('Performance.getMetrics')).metrics.find((metric) => metric.name === 'ScriptDuration')?.value ?? 0) * 1000;
    const before = await scriptDuration();
    await page.evaluate(() => {
      (window as unknown as { __long: number[] }).__long.length = 0;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => performance.getEntriesByName('arena:update-end').length > 0);
    const updateMs = await page.evaluate(() => performance.measure('update', 'arena:update-start', 'arena:update-end').duration);
    await page.waitForTimeout(300);
    const scriptMs = (await scriptDuration()) - before;
    const longestTaskMs = await page.evaluate(() => Math.max(0, ...(window as unknown as { __long: number[] }).__long));
    const spriteNodes = await page.locator('[data-sprite]').count();
    const enemies = await page.locator('[data-sprite="enemy"]').count();
    const specters = await page.locator('[data-sprite="specter"]').count();
    full.push({ firstRenderMs, updateMs, scriptMs, longestTaskMs, spriteNodes, enemies, specters });
    expect(spriteNodes).toBeLessThanOrEqual(budget.nodes);
    await context.close();
  }

  for (let run = 0; run < 5; run += 1) {
    const context = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC', baseURL: 'http://127.0.0.1:4173/', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const w = window as unknown as { __raf: number };
      w.__raf = 0;
      const original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        w.__raf += 1;
        return original(callback);
      };
    });
    await openArena(page, 'arena-perf-1');
    await page.waitForTimeout(3000);
    reduced.push({
      rafCallbacks: await page.evaluate(() => (window as unknown as { __raf: number }).__raf),
      runningAnimations: await page.evaluate(() => document.getAnimations().length),
      animatedClasses: await page.locator('.sa-is-animated').count(),
    });
    await context.close();
  }

  const record = { profile: 'arena-perf-1', budget, machine, full, reduced };
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/arena-perf-1.json', JSON.stringify(record, null, 2));
  await test.info().attach('arena-perf-1.json', { body: JSON.stringify(record, null, 2), contentType: 'application/json' });

  expect(reduced.every((sample) => sample.rafCallbacks === 0 && sample.runningAnimations === 0 && sample.animatedClasses === 0)).toBe(true);
  expect(full.every((sample) => sample.enemies === 80 && sample.specters === 20)).toBe(true);
  expect(median(full.map((sample) => sample.firstRenderMs))).toBeLessThanOrEqual(budget.firstRenderMs);
  expect(median(full.map((sample) => sample.updateMs))).toBeLessThanOrEqual(budget.updateMs);
});

const CHROMIUM_CUSTOM_PROPERTY_LIMIT = 2 * 1024 * 1024;

test('A-14 the arena map paints a background image above 2 MiB', async ({ page }) => {
  const mapBytes = statSync('backend/specter_arena/specters/scene/arena-map.png').size;
  const dataUrlLength = 'data:image/png;base64,'.length + Math.ceil(mapBytes / 3) * 4;
  expect(dataUrlLength, 'the shipped map is a data URL above the Chromium custom-property limit').toBeGreaterThan(CHROMIUM_CUSTOM_PROPERTY_LIMIT);

  await openArena(page, 'arena');
  const map = page.locator('.sa-arena-map');
  await expect(map).toHaveAttribute('data-map', 'ready');
  await expect(map).toHaveClass(/sa-has-art/);
  const painted = (selector: string) => page.locator(selector).evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(await painted('.sa-arena-map')).toMatch(/^url\("(?:blob:|data:image\/png)/);
  expect(await painted('.sa-arena-minimap__frame')).toMatch(/^url\("(?:blob:|data:image\/png)/);
});

test('A-15 every Specter token shows a decoded hero sprite image', async ({ page }) => {
  await openArena(page, 'arena');
  const tokens = page.locator('[data-sprite="specter"]');
  await expect(tokens).toHaveCount(7);
  await expect(page.locator('[data-sprite="specter"] img.sa-hero__img')).toHaveCount(7);
  const sizes = await page.locator('[data-sprite="specter"] img.sa-hero__img').evaluateAll((images) =>
    (images as HTMLImageElement[]).map((image) => ({ hero: image.closest('[data-hero]')?.getAttribute('data-hero'), width: image.naturalWidth, height: image.naturalHeight, complete: image.complete })),
  );
  expect(sizes.every((size) => size.complete && size.width === 512 && size.height === 512)).toBe(true);
  expect(new Set(sizes.map((size) => size.hero)).size).toBe(7);
});

test('A-16 hero sprites idle-animate, and stop under reduced motion', async ({ browser }) => {
  const idle = (page: Page) =>
    page.evaluate(() => ({
      names: [...document.querySelectorAll('.sa-hero__img')].map((image) => getComputedStyle(image).animationName),
      running: document.getAnimations().filter((animation) => (animation.effect as KeyframeEffect | null)?.target?.classList.contains('sa-hero__img') && animation.playState === 'running').length,
    }));

  const moving = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC', baseURL: 'http://127.0.0.1:4173/' });
  const movingPage = await moving.newPage();
  await openArena(movingPage, 'arena');
  await expect(movingPage.locator('.sa-hero__img')).toHaveCount(7);
  const running = await idle(movingPage);
  expect(running.names.every((name) => /^sa-arena-[a-z]+-idle$/.test(name))).toBe(true);
  expect(running.running).toBe(7);
  await moving.close();

  const still = await browser.newContext({ locale: 'en-US', timezoneId: 'UTC', baseURL: 'http://127.0.0.1:4173/', reducedMotion: 'reduce' });
  const stillPage = await still.newPage();
  await openArena(stillPage, 'arena');
  await expect(stillPage.locator('.sa-hero__img')).toHaveCount(7);
  const stopped = await idle(stillPage);
  expect(stopped.names.every((name) => name === 'none')).toBe(true);
  expect(stopped.running).toBe(0);
  await expect(stillPage.locator('.sa-hero.sa-is-animated')).toHaveCount(0);
  await still.close();
});
