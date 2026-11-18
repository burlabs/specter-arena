import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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
