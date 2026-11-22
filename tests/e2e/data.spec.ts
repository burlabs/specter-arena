import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const sectionTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name });
const dataPanel = (page: Page) => page.getByRole('region', { name: 'Data' });
const section = (page: Page, name: string) => dataPanel(page).getByRole('heading', { level: 3, name }).locator('xpath=ancestor::section[1]');
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __specterFixtureCalls: { method: string; path: string }[] }).__specterFixtureCalls);
const dataCalls = async (page: Page) => (await calls(page)).filter((call) => /\/(data|collector)(\/|$)/.test(call.path) && call.method !== 'GET');

async function openData(page: Page, scenario: string) {
  await page.goto(`./?scenario=${scenario}`);
  await expect(sectionTab(page, 'Data')).toBeVisible();
  await sectionTab(page, 'Data').click();
  await expect(dataPanel(page).getByRole('heading', { level: 2, name: 'Data and collection' })).toBeVisible();
}

async function press(page: Page, target: Locator, key: string) {
  await target.focus();
  await page.keyboard.press(key);
}

/** Violations inside the app root only; the preview page around it is not the product. */
async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).include('.specter-arena-root').withTags(WCAG_TAGS).analyze();
  return result.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(' ')) }));
}

test('DT-1 the Data tab is the last section, labelled FIXTURE, with all four areas', async ({ page }) => {
  await openData(page, 'data');
  await expect(page.getByRole('tablist', { name: 'Sections' }).getByRole('tab')).toHaveText(['Roster', 'Specters', 'Arena', 'Data']);
  await expect(dataPanel(page).locator('[data-mode="FIXTURE"]')).toHaveText('FIXTURE — demo data. Nothing here changes your real data.');
  for (const name of ['Collection', 'History', 'Export', 'Uploaded images']) await expect(section(page, name)).toBeVisible();
  await expect(page.getByText(/^History before .* was purged\. Coverage for that time is unknown\.$/)).toBeVisible();
  await expect(page.getByText(/The database file does not shrink after a purge/)).toBeVisible();
});

test('DT-2 a keyboard-only journey pauses and resumes collection, and the roster banner names the pause', async ({ page }) => {
  await openData(page, 'paused');
  await sectionTab(page, 'Roster').click();
  await expect(page.locator('.sa-collector')).toContainText('Collection paused. Nothing new is being recorded.');
  await sectionTab(page, 'Data').click();
  const collection = section(page, 'Collection');
  await expect(collection).toContainText('Collection paused. Nothing new is being recorded.');
  await press(page, collection.getByRole('button', { name: 'Resume collection' }), 'Enter');
  await expect(collection).toContainText('Collection is not paused.');
  await expect(collection.getByRole('button', { name: 'Pause collection' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(collection).toContainText('Collection paused. Nothing new is being recorded.');
  expect(await dataCalls(page)).toEqual([
    { method: 'POST', path: '/apps/specter-arena/api/collector' },
    { method: 'POST', path: '/apps/specter-arena/api/collector' },
  ]);
});

test('DT-3 a keyboard-only journey saves a window, previews, confirms and purges with the saved window', async ({ page }) => {
  await openData(page, 'data-none');
  const history = section(page, 'History');
  await expect(history).toContainText('Keep everything is selected, so nothing is ever purged.');
  await expect(history.getByRole('button', { name: 'Purge…' })).toBeDisabled();

  const picker = history.getByRole('combobox', { name: 'Keep history for' });
  await picker.focus();
  await picker.selectOption('30');
  await expect(history).toContainText('Save the setting before you purge.');
  await expect(history.getByRole('button', { name: 'Purge…' })).toBeDisabled();
  await press(page, history.getByRole('button', { name: 'Save setting' }), 'Enter');
  await expect(history).toContainText(/A purge now would delete history before .*: 1,200 observations, 3 quarantined records and 90 attempt records\./);

  await press(page, history.getByRole('button', { name: 'Purge…' }), 'Enter');
  const confirm = history.getByRole('group', { name: 'Purge old history' });
  await expect(confirm.getByRole('heading', { level: 4, name: 'Purge old history' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(history.getByRole('button', { name: 'Purge…' })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Purge history' }).focus();
  await page.keyboard.press('Enter');
  await expect(confirm).toHaveCount(0);
  const result = history.getByText(/^Last purge finished .*: deleted 1,200 observations, 3 quarantined records and 90 attempt records\.$/);
  await expect(result).toBeFocused();
  await expect(history).toContainText(/^.*History before .* was purged\. Coverage for that time is unknown\./s);
  expect(await dataCalls(page)).toEqual([
    { method: 'POST', path: '/apps/specter-arena/api/data/retention' },
    { method: 'POST', path: '/apps/specter-arena/api/data/purge' },
  ]);
});

test('DT-4 a purge that cannot back up says nothing was deleted and keeps the confirmation open', async ({ page }) => {
  await openData(page, 'data-backup-failed');
  const history = section(page, 'History');
  await press(page, history.getByRole('button', { name: 'Purge…' }), 'Enter');
  const confirm = history.getByRole('group', { name: 'Purge old history' });
  await confirm.getByRole('button', { name: 'Purge history' }).click();
  await expect(confirm.getByRole('alert')).toHaveText('The safety backup could not be written, so nothing was deleted.');
  await expect(confirm).toBeVisible();
});

test('DT-5 an export names the file under data/exports and lists it with its size and hash', async ({ page }) => {
  await openData(page, 'data-none');
  const exports = section(page, 'Export');
  await expect(exports).toContainText('No export has been written yet.');
  await press(page, exports.getByRole('button', { name: 'Export the store' }), 'Enter');
  const name = await exports.getByRole('list', { name: 'Exports' }).getByRole('listitem').first().locator('code').innerText();
  expect(name).toMatch(/^export-v9-\d{8}T\d{12}Z\.db$/);
  await expect(exports).toContainText(`Saved to data/exports/${name} in the app folder.`);
  await expect(exports.getByText(/SHA-256 [0-9a-f]{64}/)).toBeVisible();
});

test('DT-6 removing unused uploads shows the count first, then asks, then reports', async ({ page }) => {
  await openData(page, 'data');
  const uploads = section(page, 'Uploaded images');
  await expect(uploads).toContainText('12 of 100 uploaded images stored.');
  await expect(uploads).toContainText('3 uploaded images are not used by any avatar, current or past.');
  await press(page, uploads.getByRole('button', { name: 'Remove unused uploads…' }), 'Enter');
  const confirm = uploads.getByRole('group', { name: 'Remove unused uploads' });
  await expect(confirm.getByRole('heading', { level: 4 })).toBeFocused();
  await expect(confirm).toContainText('removes up to 3 uploaded images');
  await confirm.getByRole('button', { name: 'Remove unused uploads' }).focus();
  await page.keyboard.press('Enter');
  await expect(uploads).toContainText('9 of 100 uploaded images stored.');
  await expect(uploads.getByText(/^Last upload cleanup finished .*: removed 3 uploaded images\.$/)).toBeFocused();
});

test('DT-7 a running purge disables every write and says so', async ({ page }) => {
  await openData(page, 'data-running');
  await expect(dataPanel(page)).toContainText(/A purge is running \(started .*\)\. Wait for it to finish\./);
  for (const name of ['Save setting', 'Purge…', 'Export the store', 'Remove unused uploads…']) {
    await expect(dataPanel(page).getByRole('button', { name })).toBeDisabled();
  }
});

test('DT-8 the failure scenarios say what happened in words', async ({ page }) => {
  await openData(page, 'data-failure');
  await expect(dataPanel(page).getByRole('alert')).toContainText("The app's database is unavailable");
  await page.goto('./?scenario=data-unsupported');
  await sectionTab(page, 'Data').click();
  await expect(dataPanel(page).getByText('This version of the app has no data controls')).toBeVisible();
});

test('DT-9 the Data tab has no WCAG 2.1 A or AA axe violation in each state', async ({ page }) => {
  test.setTimeout(45_000);
  await openData(page, 'data');
  expect(await violations(page), 'default').toEqual([]);
  await section(page, 'History').getByRole('button', { name: 'Purge…' }).click();
  expect(await violations(page), 'purge confirmation').toEqual([]);
  await page.keyboard.press('Escape');
  await section(page, 'Uploaded images').getByRole('button', { name: 'Remove unused uploads…' }).click();
  expect(await violations(page), 'cleanup confirmation').toEqual([]);
  await page.keyboard.press('Escape');
  for (const scenario of ['data-paused', 'data-running', 'data-interrupted', 'data-full', 'data-failure']) {
    await page.goto(`./?scenario=${scenario}`);
    await sectionTab(page, 'Data').click();
    await expect(dataPanel(page).getByRole('heading', { level: 2 })).toBeVisible();
    expect(await violations(page), scenario).toEqual([]);
  }
});

test('DT-10 with reduced motion requested the Data tab runs no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openData(page, 'data');
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('DT-11 at 390 px the Data tab does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openData(page, 'data');
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.view);
});

test('DT-12 the Data tab never uses the words no activity, idle, healthy or available', async ({ page }) => {
  await openData(page, 'data-interrupted');
  const text = await dataPanel(page).innerText();
  expect(text).not.toMatch(/\b(idle|healthy|available)\b/i);
  expect(text).not.toMatch(/no activity/i);
});
