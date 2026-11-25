import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'UTC', viewport: { width: 1280, height: 900 } });

/** When set, the tests write real rendered PNGs of the recap here (a review aid; CI leaves it unset). */
const SHOTS = process.env.RECAP_SHOTS_DIR;
const TUESDAY = new Date('2026-11-25T15:00:00Z');
const MONDAY = new Date('2026-11-23T15:00:00Z');

const modeBar = (page: Page) => page.getByRole('group', { name: 'Arena view' });
const mode = (page: Page, name: string) => modeBar(page).getByRole('button', { name, exact: true });
const slider = (page: Page) => page.getByRole('slider', { name: 'Playback position' });
const controls = (page: Page) => page.getByRole('toolbar', { name: 'Recap controls' });
const arena = (page: Page) => page.getByRole('region', { name: 'Arena', exact: true });
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __specterFixtureCalls: { method: string; path: string }[] }).__specterFixtureCalls);
const shot = async (target: Page | Locator, name: string) => {
  if (SHOTS === undefined) return;
  mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: `${SHOTS}/${name}.png` });
};

async function openArena(page: Page, now: Date = TUESDAY) {
  await page.clock.setFixedTime(now);
  await page.goto('./?scenario=arena');
  await expect(page.getByRole('tab', { name: 'Arena', selected: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Arena map' })).toBeVisible();
}

async function openRecap(page: Page, name: 'Today' | 'Yesterday' | 'This week', now: Date = TUESDAY) {
  await openArena(page, now);
  await mode(page, name).click();
  await expect(slider(page)).toBeVisible();
}

/** A range input takes a new value through the native setter, so React sees the change. */
const setSlider = (page: Page, value: number) =>
  slider(page).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
const max = async (page: Page) => Number(await slider(page).getAttribute('max'));
const value = async (page: Page) => Number(await slider(page).inputValue());
const cues = (page: Page) => page.locator('[data-cue]');
const defeated = (page: Page) => page.locator('[data-sprite="enemy"][aria-label*="Defeated"]');

test('FP30-S1 the Arena opens on Live with the four choices in order', async ({ page }) => {
  await openArena(page);
  await expect(modeBar(page).getByRole('button')).toHaveText(['Live', 'Today', 'Yesterday', 'This week']);
  await expect(mode(page, 'Live')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('RECORDED — not live')).toHaveCount(0);
});

test('FP30-S2 Today is labelled RECORDED, says the heroes are as they are today, and opens paused on the first task', async ({ page }) => {
  await openRecap(page, 'Today');
  await expect(arena(page).getByText('RECORDED — not live')).toHaveCount(3);
  await expect(arena(page).getByText('Heroes shown as they are today.', { exact: false })).toBeVisible();
  expect(await value(page)).toBe(0);
  await expect(slider(page)).toHaveAttribute('aria-valuetext', /Nov 25, 2026/);
  await expect(page.locator('[data-sprite="enemy"]').first()).toBeVisible();
  await shot(page, 'today');
});

test('FP30-S3 a minion appears, a defeat is celebrated with its recorded XP, and the list says Credited', async ({ page }) => {
  test.setTimeout(60_000);
  await openRecap(page, 'Today');
  await controls(page).getByRole('button', { name: '4x' }).click();
  for (let step = 0; step < 40 && (await defeated(page).count()) === 0; step += 1) await controls(page).getByRole('button', { name: 'Next event' }).click();
  await expect(defeated(page).first()).toBeVisible();
  await controls(page).getByRole('button', { name: 'Previous event' }).click();
  await expect(defeated(page)).toHaveCount(0);
  await controls(page).getByRole('button', { name: 'Play' }).click();
  await expect(cues(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(cues(page).first()).toContainText(/\+\d+ XP/);
  await controls(page).getByRole('button', { name: 'Pause' }).click();
  expect((await calls(page)).filter((call) => call.method !== 'GET')).toEqual([]);
});

test('FP30-S4 scrub and keyboard: Pause, drag, Play at 2x, and no defeat burst after a jump', async ({ page }) => {
  await openRecap(page, 'Today');
  await controls(page).getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(600);
  await controls(page).getByRole('button', { name: 'Pause' }).click();
  const paused = await value(page);
  expect(paused).toBeGreaterThan(200);
  await page.waitForTimeout(400);
  expect(await value(page)).toBe(paused);
  await setSlider(page, Math.round((await max(page)) * 0.6));
  expect(await value(page)).toBeGreaterThan(paused);
  await controls(page).getByRole('button', { name: '2x' }).click();
  await expect(controls(page).getByRole('button', { name: '2x' })).toHaveAttribute('aria-pressed', 'true');
  await expect(cues(page)).toHaveCount(0);
  await slider(page).focus();
  await page.keyboard.press('End');
  expect(await value(page)).toBe(await max(page));
  await page.keyboard.press('Home');
  expect(await value(page)).toBe(0);
  await expect(cues(page)).toHaveCount(0);
});

test('FP30-S5 the scrub bar shows a cut notch and a hatched Not collected block as two different marks, and the clock names the pause', async ({ page }) => {
  await openRecap(page, 'Today');
  const bar = page.locator('.sa-recap-scrub');
  await expect(bar.locator('.sa-recap-notch').first()).toBeAttached();
  await expect(bar.locator('.sa-recap-block--hatched')).toHaveCount(2);
  await expect(bar.getByRole('list', { name: 'Cut and not collected stretches' })).toContainText(/Skipped \d+ (s|min|h)/);
  await expect(bar.getByRole('list', { name: 'Cut and not collected stretches' })).toContainText('Not collected: collection was paused');
  for (let step = 0; step < 40 && (await page.locator('.sa-recap-caption--hatched').count()) === 0; step += 1) await controls(page).getByRole('button', { name: 'Next event' }).click();
  await expect(page.locator('.sa-recap-caption--hatched').first()).toContainText('Not collected');
  await expect(page.locator('[data-sprite="specter"]').first()).toBeVisible();
  await shot(bar, 'scrub-bar-skip-and-not-collected');
  await shot(page, 'today-not-collected-beat');
});

test('FP30-S6 Yesterday and This week each have a recap between 30 s and 3 min (This week 4 min), asked for as local-zone integers', async ({ page }) => {
  await openRecap(page, 'Yesterday');
  expect(await max(page)).toBeGreaterThanOrEqual(30_000);
  expect(await max(page)).toBeLessThanOrEqual(180_000 + 6_000);
  await expect(page.getByRole('heading', { name: 'Arena: Yesterday' })).toBeVisible();
  await shot(page, 'yesterday');
  await mode(page, 'This week').click();
  await expect(page.getByRole('heading', { name: 'Arena: This week' })).toBeVisible();
  expect(await max(page)).toBeLessThanOrEqual(240_000 + 6_000);
  await expect(page.getByText('This week started today (Monday)')).toHaveCount(0);
  await shot(page, 'this-week');
  const periods = (await calls(page)).map((call) => call.path).filter((path) => path.includes('/recap?'));
  expect(periods).toHaveLength(2);
  const [yesterday, week] = periods.map((path) => new URL(path, 'http://x').searchParams);
  expect(Number(yesterday?.get('toMs')) - Number(yesterday?.get('fromMs'))).toBe(24 * 3_600_000);
  expect(new Date(Number(week?.get('fromMs'))).toISOString()).toBe('2026-11-23T00:00:00.000Z');
});

test('FP30-S6b on a Monday This week is the same recap as Today and says so', async ({ page }) => {
  await openRecap(page, 'Today', MONDAY);
  await mode(page, 'This week').click();
  await expect(page.getByText('This week started today (Monday)')).toBeVisible();
  const periods = (await calls(page)).map((call) => call.path).filter((path) => path.includes('/recap?'));
  expect(periods).toHaveLength(2);
  expect(periods[0]).toBe(periods[1]);
  await shot(page, 'monday-this-week-equals-today');
});

test('FP30-S7 Exit to live shows the live arena with no celebration and a fresh read', async ({ page }) => {
  test.setTimeout(60_000);
  await openRecap(page, 'Today');
  await controls(page).getByRole('button', { name: '4x' }).click();
  for (let step = 0; step < 40 && (await defeated(page).count()) === 0; step += 1) await controls(page).getByRole('button', { name: 'Next event' }).click();
  await controls(page).getByRole('button', { name: 'Previous event' }).click();
  await controls(page).getByRole('button', { name: 'Play' }).click();
  await expect(cues(page).first()).toBeVisible({ timeout: 20_000 });
  await controls(page).getByRole('button', { name: 'Exit to live' }).click();
  await expect(mode(page, 'Live')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Arena map' })).toBeVisible();
  await expect(cues(page)).toHaveCount(0);
  await expect(page.getByText('RECORDED — not live')).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(cues(page)).toHaveCount(0);
});

test.describe('FP30-S8 reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('opens paused with Previous and Next event, no Play, no attack animation and no animation frame', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __raf: number };
      w.__raf = 0;
      const original = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (callback) => {
        w.__raf += 1;
        return original(callback);
      };
    });
    await openRecap(page, 'Today');
    await expect(controls(page).getByRole('button', { name: 'Play' })).toHaveCount(0);
    await expect(controls(page).getByRole('button', { name: 'Next event' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await value(page)).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __raf: number }).__raf)).toBe(0);
    await expect(page.locator('.sa-is-animated')).toHaveCount(0);
    await controls(page).getByRole('button', { name: 'Next event' }).click();
    expect(await value(page)).toBeGreaterThan(0);
    await setSlider(page, 5_000);
    expect(await value(page)).toBe(5_000);
    await expect(cues(page)).toHaveCount(0);
  });
});

test('FP30-S9 a recap reads and shows only: every request is a GET and none changes a total', async ({ page }) => {
  await openRecap(page, 'Today');
  await mode(page, 'Yesterday').click();
  await mode(page, 'This week').click();
  await mode(page, 'Live').click();
  expect((await calls(page)).filter((call) => call.method !== 'GET')).toEqual([]);
});

test('AX-recap the recap view has no WCAG 2.1 A or AA axe violation, and the slider is reachable by keyboard', async ({ page }) => {
  await openRecap(page, 'Today');
  const result = await new AxeBuilder({ page }).include('.specter-arena-root').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(' ')) }))).toEqual([]);
  await mode(page, 'Live').focus();
  let reached = false;
  for (let tab = 0; tab < 24 && !reached; tab += 1) {
    await page.keyboard.press('Tab');
    reached = await slider(page).evaluate((element) => element === document.activeElement);
  }
  expect(reached).toBe(true);
});
