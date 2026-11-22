import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoRoster } from './support';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const FORBIDDEN = /\b(idle|healthy|available)\b/i;

const detailPanel = (page: Page) => page.getByRole('tabpanel', { name: /^(Attempts|Activity|Progression|Source details)$/ });

const selectBot = (page: Page, name: string) => page.getByRole('list', { name: 'Bots' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();

test('two concurrent workers show both conditions, each with its own reason', async ({ page }) => {
  await gotoRoster(page, './?scenario=two-concurrent');
  const row = page.getByRole('list', { name: 'Bots' }).getByRole('listitem').first();
  await expect(row).toContainText('Atlas');
  await expect(row).toContainText('Working');
  await expect(row).toContainText('1 worker working');
  await expect(row).toContainText('1 worker unknown');

  await selectBot(page, 'Atlas');
  const attempts = page.getByRole('list', { name: 'Attempts, newest first' }).getByRole('listitem');
  await expect(attempts).toHaveCount(3);
  await expect(attempts.nth(0)).toContainText('Worker');
  await expect(attempts.nth(0)).toContainText('Working');
  await expect(attempts.nth(1)).toContainText('Unknown');
  await expect(attempts.nth(1)).toContainText("This bot's chat has not appeared in updates");
  await expect(attempts.nth(2)).toContainText('Bot turn');
  await expect(attempts.nth(2)).toContainText('Ended');
  await expect(page.getByText('Showing Atlas: Working, 2 open attempts')).toBeAttached();

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(detailPanel(page)).toContainText('Collector covered 1 h 43 m of the 1 h 53 m since this bot was first seen (1 gap)');
  await expect(page.getByRole('region', { name: 'Last 24 hours' })).toContainText('Sample size3');
});

test('a keyboard-only journey reaches the detail tabs', async ({ page }) => {
  await gotoRoster(page, './?scenario=two-concurrent');
  const list = page.getByRole('list', { name: 'Bots' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.keyboard.press('/');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(list.getByRole('button', { name: /^Atlas/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Atlas' })).toBeVisible();

  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tab', { name: 'Attempts' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Source details' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(detailPanel(page)).toBeFocused();
});

test('every reason has words and none says idle, healthy or available', async ({ page }) => {
  await gotoRoster(page, './?scenario=all-reasons');
  const list = page.getByRole('list', { name: 'Bots' });
  // The list fills after the first poll; wait for all 21 rows before reading the count (B11).
  await expect(list.getByRole('listitem')).toHaveCount(21);
  const count = await list.getByRole('listitem').count();
  for (let index = 0; index < count; index += 1) {
    await list.getByRole('listitem').nth(index).getByRole('button').first().click();
    const detail = page.getByRole('region', { name: 'Bot detail' });
    const summary = detail.locator('section.sa-detail p').first();
    await expect(summary).not.toHaveText('');
    await expect(page.getByRole('list', { name: 'Attempts, newest first' }).getByRole('listitem').first().locator('p').first()).not.toHaveText('');
    expect((await detail.textContent()) ?? '').not.toMatch(FORBIDDEN);
  }
  expect((await page.locator('.specter-arena-root').textContent()) ?? '').not.toMatch(FORBIDDEN);
});

test('a paused collector is named, and a bot with no collected time says Not collected', async ({ page }) => {
  await gotoRoster(page, './?scenario=paused');
  await expect(page.getByRole('status').filter({ hasText: 'Collection paused' })).toContainText('Nothing new is being recorded.');
  await gotoRoster(page, './?scenario=not-collected');
  await selectBot(page, 'Atlas');
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.locator('.sa-activity').getByText('Not collected')).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Context in use' })).toContainText('Not collected.');
  await expect(page.getByText('No collected time in this window, so there are no counts.')).toHaveCount(2);
});

test('an attempts 404 says the bot is gone and keeps the roster', async ({ page }) => {
  await gotoRoster(page, './?scenario=attempt-gone');
  await selectBot(page, 'Atlas');
  await expect(detailPanel(page)).toHaveText('This bot is no longer on the roster.');
  await expect(page.getByRole('list', { name: 'Bots' }).getByRole('listitem')).toHaveCount(7);
});

test('with reduced motion requested, nothing animates', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoRoster(page, './?scenario=two-concurrent');
  await selectBot(page, 'Atlas');
  await expect(page.getByRole('list', { name: 'Attempts, newest first' })).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
