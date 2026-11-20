import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const FORBIDDEN = /\b(idle|healthy|available)\b/i;

const specterTab = (page: Page) => page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name: 'Specters' });
const botList = (page: Page) => page.getByRole('list', { name: 'Specter collection' });
const detail = (page: Page) => page.getByRole('region', { name: 'Specter detail' });

async function openSpecters(page: Page, scenario: string) {
  await page.goto(`./?scenario=${scenario}`);
  await expect(page.getByRole('list', { name: 'Bots' }).getByRole('listitem')).toHaveCount(7);
  await specterTab(page).click();
  await expect(botList(page)).toBeVisible();
}

const selectSpecterBot = (page: Page, name: string) => botList(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();

test('a keyboard-only journey changes the avatar and lands on the hero heading', async ({ page }) => {
  await page.goto('./?scenario=specters');
  await expect(page.getByRole('list', { name: 'Bots' }).getByRole('listitem')).toHaveCount(7);
  await page.getByRole('tab', { name: 'Roster' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(specterTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(botList(page)).toBeVisible();

  for (const control of ['searchbox', 'combobox', 'combobox'] as const) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole(control).and(page.locator(':focus'))).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(botList(page).getByRole('button', { name: /^Atlas/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(detail(page).getByRole('heading', { level: 2, name: 'Vell' })).toBeVisible();

  await detail(page).getByRole('button', { name: 'Change avatar' }).focus();
  await page.keyboard.press('Enter');
  const gallery = detail(page).getByRole('radiogroup', { name: 'Portraits' });
  await expect(gallery).toBeVisible();
  await gallery.getByRole('radio', { name: /Tide portrait/ }).check();
  await detail(page).getByRole('button', { name: 'Apply' }).focus();
  await page.keyboard.press('Enter');

  const heading = detail(page).getByRole('heading', { level: 2, name: 'Vell' });
  await expect(heading).toBeFocused();
  await expect(gallery).toHaveCount(0);
  await expect(detail(page).locator('.sa-portrait--lg img.sa-portrait__img')).toBeVisible();
});

test('every bot row shows its hero name after the bot name, and never idle, healthy or available', async ({ page }) => {
  await page.goto('./?scenario=specters');
  const list = page.getByRole('list', { name: 'Bots' });
  await expect(list.getByRole('button', { name: /^Atlas/ })).toBeVisible();
  for (const hero of ['Vell', 'Stitch', 'Reeve', 'Rattle', 'Ember', 'Shard', 'Poly']) {
    await expect(list.getByText(`Specter: ${hero}`, { exact: true })).toBeVisible();
  }
  await expect(list.locator('img.sa-portrait__img')).toHaveCount(7);
  const sources = await list.locator('img.sa-portrait__img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));
  expect(new Set(sources).size).toBe(7);
  expect((await page.locator('.specter-arena-root').textContent()) ?? '').not.toMatch(FORBIDDEN);
  await specterTab(page).click();
  await selectSpecterBot(page, 'Atlas');
  expect((await page.locator('.specter-arena-root').textContent()) ?? '').not.toMatch(FORBIDDEN);
});

test('no control edits the hero name or personality', async ({ page }) => {
  await openSpecters(page, 'specters');
  await selectSpecterBot(page, 'Atlas');
  await expect(detail(page).getByRole('button')).toHaveText(['Change avatar']);
  await expect(detail(page).locator('input[type=text], textarea')).toHaveCount(0);
  await expect(detail(page)).toContainText('Calm and a little formal.');
});

test('a twelfth bot shows the second hero ordinal', async ({ page }) => {
  await page.goto('./?scenario=arena-perf-1');
  const list = page.getByRole('list', { name: 'Bots' });
  await expect(list.getByText('Specter: Vell II', { exact: true })).toBeVisible();
  await expect(list.getByText('Specter: Lume II', { exact: true })).toBeVisible();
});

test('a portrait that fails to load falls back to a labelled token', async ({ page }) => {
  await openSpecters(page, 'asset-failed');
  await selectSpecterBot(page, 'Atlas');
  await expect(detail(page).getByText('Portrait could not be loaded. Showing a placeholder token.')).toBeVisible();
});

test('with reduced motion requested, nothing animates, even for a working bot with a Specter', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?scenario=specters');
  await expect(page.getByRole('list', { name: 'Bots' }).getByText('Specter: Vell', { exact: true })).toBeVisible();
  await specterTab(page).click();
  await selectSpecterBot(page, 'Atlas');
  await expect(detail(page).getByRole('heading', { level: 2, name: 'Vell' })).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('the Specter stylesheet is scoped and leaves the host page alone', async ({ page }) => {
  await page.goto('./?scenario=specters');
  await expect(page.getByRole('list', { name: 'Bots' })).toBeVisible();
  await expect(page.locator('style[data-specter-arena]')).toHaveCount(1);
  await expect(page.locator('style[data-specter-arena-specters]')).toHaveCount(1);
  const own = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { fontFamily: style.fontFamily, backgroundColor: style.backgroundColor };
  });
  const control = await page.context().newPage();
  await control.goto('about:blank');
  const blank = await control.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { fontFamily: style.fontFamily, backgroundColor: style.backgroundColor };
  });
  expect(own.fontFamily).toBe(blank.fontFamily);
  expect(own.backgroundColor).toBe(blank.backgroundColor);
});

test('the avatar picker applies a bundled portrait, resets to the hero portrait and explains a bad upload', async ({ page }) => {
  await openSpecters(page, 'specters');
  await selectSpecterBot(page, 'Atlas');
  await detail(page).getByRole('button', { name: 'Change avatar' }).click();
  const gallery = detail(page).getByRole('radiogroup', { name: 'Portraits' });
  await expect(gallery.getByRole('radio')).toHaveCount(12);
  await expect(detail(page).getByRole('button', { name: 'Apply' })).toBeDisabled();
  await gallery.getByRole('radio', { name: /Teal|Tide portrait/ }).first().check();
  await detail(page).getByRole('button', { name: 'Apply' }).click();
  await expect(gallery).toHaveCount(0);
  await expect(detail(page).locator('.sa-portrait--lg img.sa-portrait__img')).toBeVisible();

  await detail(page).getByRole('button', { name: 'Change avatar' }).click();
  await detail(page).getByRole('radio', { name: /Use the hero portrait/ }).check();
  await detail(page).getByRole('button', { name: 'Apply' }).click();
  await expect(gallery).toHaveCount(0);
  await expect(detail(page).getByRole('heading', { level: 2, name: 'Vell' })).toBeFocused();

  await detail(page).getByRole('button', { name: 'Change avatar' }).click();
  await detail(page).getByLabel(/^Upload a PNG/).setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is not a png') });
  await expect(detail(page).getByRole('alert')).toHaveText('That file is not a valid PNG image the app can use.');
});

const collection = (page: Page) => page.getByRole('list', { name: 'Specter collection' });
const controls = (page: Page) => ({
  search: page.getByRole('searchbox', { name: 'Search Specters' }),
  filter: page.getByRole('combobox', { name: 'Filter' }),
  sort: page.getByRole('combobox', { name: 'Sort' }),
  count: page.locator('.sa-collection-count'),
});

async function openCollection(page: Page, scenario = 'arena') {
  await openSpecters(page, scenario);
  await expect(controls(page).count).toHaveText('Showing 11 of 11');
}

test('FP17-E1 search finds a hero by name, epithet or bot, announces the count and clears with one button', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(`${request.method()} ${request.url()}`);
  });
  await openCollection(page);
  const { search, count } = controls(page);
  await expect(count).toHaveAttribute('aria-live', 'polite');
  await search.fill('vell');
  await expect(collection(page).getByRole('listitem')).toHaveCount(1);
  await expect(count).toHaveText('Showing 1 of 11');
  await search.fill('golden clasp');
  await expect(collection(page).getByRole('button', { name: /^Atlas/ })).toBeVisible();
  await search.fill('brindle');
  await expect(collection(page).getByRole('button', { name: /^Brindle/ })).toBeVisible();
  await search.fill('tide');
  await expect(collection(page).getByRole('listitem')).toHaveCount(1);
  await expect(collection(page).getByRole('button')).toHaveCount(0);
  await search.fill('no such hero');
  await expect(page.getByText('No Specters match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(search).toBeFocused();
  await expect(count).toHaveText('Showing 11 of 11');
  expect(writes).toEqual([]);
});

test('FP17-E2 the filter shows assigned bots, unassigned heroes or changed avatars and never assigns anything', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(request.url());
  });
  await openCollection(page);
  const { filter } = controls(page);
  await filter.selectOption('unassigned');
  await expect(collection(page).getByRole('listitem')).toHaveCount(4);
  await expect(collection(page).getByRole('button')).toHaveCount(0);
  await expect(collection(page).getByText('No bot yet')).toHaveCount(4);
  await filter.selectOption('assigned');
  await expect(collection(page).getByRole('button')).toHaveCount(7);
  await expect(collection(page).getByText('No bot yet')).toHaveCount(0);
  await filter.selectOption('avatar');
  await expect(collection(page).getByRole('button')).toHaveCount(1);
  await expect(collection(page).getByRole('button', { name: /^Brindle/ })).toBeVisible();
  expect(writes).toEqual([]);
});

test('FP17-E3 sort by XP puts the highest XP first and hero cards last, and roster order is the default', async ({ page }) => {
  await openCollection(page);
  const { sort } = controls(page);
  await expect(sort).toHaveValue('roster');
  const xpOf = async () =>
    collection(page)
      .getByRole('button')
      .evaluateAll((rows) => rows.map((row) => Number(/(\d+)(?: \/ \d+)? XP/.exec(row.textContent ?? '')?.[1] ?? 0)));
  await sort.selectOption('xp');
  const values = await xpOf();
  expect(values.length).toBe(7);
  expect(values).toEqual([...values].sort((a, b) => b - a));
  expect(Math.max(...values)).toBeGreaterThan(0);
  const last = await collection(page).getByRole('listitem').last().textContent();
  expect(last).toContain('No bot yet');
  await sort.selectOption('name');
  const first = await collection(page).getByRole('listitem').first().locator('strong').textContent();
  expect(first).toBe('bur');
});

test('FP17-E4 the controls come before the cards in tab order, and arrow keys move over the visible bot cards only', async ({ page }) => {
  await openCollection(page);
  const { search, filter, sort } = controls(page);
  await page.getByRole('tab', { name: 'Specters' }).focus();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(filter).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sort).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(collection(page).getByRole('button', { name: /^Atlas/ })).toBeFocused();
  await filter.selectOption('assigned');
  await collection(page).getByRole('button', { name: /^Atlas/ }).focus();
  await page.keyboard.press('End');
  await expect(collection(page).getByRole('button').last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(collection(page).getByRole('button').last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(collection(page).getByRole('button').first()).toBeFocused();
});

test('FP17-E5 a selected bot stays in the detail panel when a filter hides its card', async ({ page }) => {
  await openCollection(page);
  await selectSpecterBot(page, 'Atlas');
  await controls(page).filter.selectOption('unassigned');
  await expect(detail(page).getByRole('heading', { level: 2, name: 'Vell' })).toBeVisible();
  await controls(page).filter.selectOption('all');
  await expect(collection(page).getByRole('button', { name: /^Atlas/ })).toHaveAttribute('aria-current', 'true');
});

test('FP17-E6 with reduced motion requested, using every control starts no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCollection(page);
  const { search, filter, sort } = controls(page);
  await search.fill('e');
  await filter.selectOption('assigned');
  await sort.selectOption('xp');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('FP17-E7 at 390 px the controls stack and the page does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCollection(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const boxes = await Promise.all([controls(page).search, controls(page).filter, controls(page).sort].map((locator) => locator.boundingBox()));
  const tops = boxes.map((box) => Math.round(box?.y ?? 0));
  expect(new Set(tops).size).toBe(3);
});
