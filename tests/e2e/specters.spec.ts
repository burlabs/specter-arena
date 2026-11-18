import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const FORBIDDEN = /\b(idle|healthy|available)\b/i;

const specterTab = (page: Page) => page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name: 'Specters' });
const botList = (page: Page) => page.getByRole('list', { name: 'Bots with Specters' });
const detail = (page: Page) => page.getByRole('region', { name: 'Specter detail' });

async function openSpecters(page: Page, scenario: string) {
  await page.goto(`./?scenario=${scenario}`);
  await expect(page.getByRole('list', { name: 'Bots' }).getByRole('listitem')).toHaveCount(7);
  await specterTab(page).click();
  await expect(botList(page)).toBeVisible();
}

const selectSpecterBot = (page: Page, name: string) => botList(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();

test('a keyboard-only journey summons, accepts and lands on the new heading', async ({ page }) => {
  await page.goto('./?scenario=specters-empty');
  await expect(page.getByRole('list', { name: 'Bots' }).getByRole('listitem')).toHaveCount(7);
  await page.getByRole('tab', { name: 'Roster' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(specterTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(botList(page)).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(botList(page).getByRole('button', { name: /^Atlas/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(detail(page).getByRole('heading', { level: 2, name: 'Atlas' })).toBeVisible();

  await detail(page).getByLabel(/^What is this bot for/).fill('keeps the books');
  await detail(page).getByRole('button', { name: 'Summon a Specter' }).focus();
  await page.keyboard.press('Enter');
  await expect(detail(page).getByText('A candidate is ready to review')).toBeVisible({ timeout: 8000 });
  await detail(page).getByRole('button', { name: 'Accept this Specter' }).focus();
  await page.keyboard.press('Enter');

  const heading = detail(page).getByRole('heading', { level: 2, name: 'Lanternwick' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(detail(page).getByText('Placeholder token, not a portrait')).toBeVisible();
});

test('roster rows show distinct portraits or a token, keep the bot name first, and never say idle, healthy or available', async ({ page }) => {
  await page.goto('./?scenario=specters');
  const list = page.getByRole('list', { name: 'Bots' });
  await expect(list.getByRole('button', { name: /^Atlas/ })).toBeVisible();
  await expect(list.getByText('Specter: Vesper')).toBeVisible();
  await expect(list.getByText(/Specter: Wren/)).toContainText('placeholder token, not a portrait');
  await expect(list.locator('img.sa-portrait__img')).toHaveCount(2);
  const sources = await list.locator('img.sa-portrait__img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));
  expect(new Set(sources).size).toBe(2);
  expect(await list.locator('.sa-portrait__token').count()).toBeGreaterThanOrEqual(1);
  expect((await page.locator('.specter-arena-root').textContent()) ?? '').not.toMatch(FORBIDDEN);
  await specterTab(page).click();
  await selectSpecterBot(page, 'Atlas');
  expect((await page.locator('.specter-arena-root').textContent()) ?? '').not.toMatch(FORBIDDEN);
});

test('a failed summoning says what happened and leaves the existing Specter alone', async ({ page }) => {
  await openSpecters(page, 'summon-failure');
  await selectSpecterBot(page, 'Atlas');
  await detail(page).getByRole('button', { name: 'Reroll' }).click();
  await expect(detail(page).getByText('The summoning did not finish')).toBeVisible({ timeout: 8000 });
  await expect(detail(page).getByText('Crew did not answer in time.')).toBeVisible();
  await expect(detail(page).getByRole('heading', { level: 2, name: 'Vesper' })).toBeVisible();
});

test('a portrait that fails to load falls back to a labelled token', async ({ page }) => {
  await openSpecters(page, 'asset-failed');
  await selectSpecterBot(page, 'Atlas');
  await expect(detail(page).getByText('Portrait could not be loaded. Showing a placeholder token.')).toBeVisible();
});

test('long names never widen a 320 px page beyond what the roster already needs', async ({ page }) => {
  const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('./?scenario=default');
  await expect(page.getByRole('list', { name: 'Bots' }).getByRole('listitem')).toHaveCount(7);
  const baseline = await pageWidth();

  await page.goto('./?scenario=long-names');
  await expect(page.getByText(/Specter: W{40}/)).toBeVisible();
  expect(await pageWidth()).toBeLessThanOrEqual(baseline);
  await specterTab(page).click();
  await selectSpecterBot(page, 'Atlas');
  await expect(detail(page).getByRole('heading', { level: 2, name: 'W'.repeat(40) })).toBeVisible();
  expect(await pageWidth()).toBeLessThanOrEqual(baseline);
});

test('with reduced motion requested, nothing animates, even for a working bot with a Specter', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('./?scenario=specters');
  await expect(page.getByRole('list', { name: 'Bots' }).getByText('Specter: Vesper')).toBeVisible();
  await specterTab(page).click();
  await selectSpecterBot(page, 'Atlas');
  await expect(detail(page).getByRole('heading', { level: 2, name: 'Vesper' })).toBeVisible();
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

test('manual entry never mentions AI and saves as written by you', async ({ page }) => {
  await openSpecters(page, 'specters-none');
  await selectSpecterBot(page, 'Atlas');
  await detail(page).getByRole('button', { name: 'Write one by hand' }).click();
  const form = detail(page).getByRole('form', { name: 'Write a Specter by hand' });
  expect((await form.textContent()) ?? '').not.toMatch(/\bAI\b/);
  await form.getByLabel(/^Name/).fill('Hand');
  await form.getByLabel(/^Personality/).fill('Plain.');
  await form.getByLabel(/^Appearance/).fill('Plain coat.');
  await form.getByLabel(/^Mannerism/).fill('Still.');
  await form.getByLabel(/^Why this fits/).fill('It fits.');
  await form.getByLabel(/^Art brief/).fill('A coat.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(detail(page).getByText('Written by you')).toBeVisible();
  await expect(detail(page).getByRole('heading', { level: 2, name: 'Hand' })).toBeFocused();
});

test('the portrait picker applies a bundled portrait and explains a bad upload', async ({ page }) => {
  await openSpecters(page, 'specters');
  await selectSpecterBot(page, 'Brindle');
  await detail(page).getByRole('button', { name: 'Choose portrait' }).click();
  const gallery = detail(page).getByRole('radiogroup', { name: 'Portraits' });
  await expect(gallery.getByRole('radio')).toHaveCount(4);
  await gallery.getByRole('radio', { name: /Teal portrait/ }).check();
  await detail(page).getByRole('button', { name: 'Apply' }).click();
  await expect(gallery).toHaveCount(0);
  await expect(detail(page).locator('.sa-portrait--lg img.sa-portrait__img')).toBeVisible();
  await expect(detail(page).getByText('Placeholder token, not a portrait')).toHaveCount(0);

  await detail(page).getByRole('button', { name: 'Choose portrait' }).click();
  await detail(page).getByLabel(/^Upload a PNG/).setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is not a png') });
  await expect(detail(page).getByRole('alert')).toHaveText('That file is not a valid PNG image the app can use.');
});

test('rename: Escape cancels and returns focus, Save updates the heading and the roster row', async ({ page }) => {
  await openSpecters(page, 'specters');
  await selectSpecterBot(page, 'Atlas');
  await detail(page).getByRole('button', { name: 'Rename' }).click();
  const form = detail(page).getByRole('form', { name: 'Rename' });
  await expect(form.getByLabel(/^Name/)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(form).toHaveCount(0);
  await expect(detail(page).getByRole('button', { name: 'Rename' })).toBeFocused();

  await detail(page).getByRole('button', { name: 'Rename' }).click();
  await form.getByLabel(/^Name/).fill('Vesperine');
  await form.getByRole('button', { name: 'Save' }).click();
  const heading = detail(page).getByRole('heading', { level: 2, name: 'Vesperine' });
  await expect(heading).toBeFocused();
  await page.getByRole('tab', { name: 'Roster' }).click();
  await expect(page.getByRole('list', { name: 'Bots' }).getByText('Specter: Vesperine')).toBeVisible();
});
