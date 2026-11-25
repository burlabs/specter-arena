import { expect, test } from '@playwright/test';
import { gotoRoster } from './support';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

test('a keyboard-only user can find a bot, select it, watch it and switch views', async ({ page }) => {
  await gotoRoster(page, './?scenario=default');
  const roster = page.getByRole('list', { name: 'Bots' });
  await expect(roster.getByRole('listitem')).toHaveCount(7);

  await page.keyboard.press('/');
  await expect(page.getByRole('searchbox', { name: 'Search bots by name' })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(roster.getByRole('button', { name: /^Atlas/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(roster.getByRole('button', { name: /^Brindle/ })).toBeFocused();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('region', { name: 'Bot detail' });
  await expect(detail.getByRole('heading', { level: 2, name: 'Brindle' })).toBeVisible();
  await expect(detail).toContainText('Crew reports no running turn. This is not a health reading.');

  await page.keyboard.press('Tab');
  const watch = roster.getByRole('button', { name: 'Watch Brindle' });
  await expect(watch).toBeFocused();
  await page.keyboard.press('Space');
  await expect(watch).toHaveAttribute('aria-pressed', 'true');

  const watchedTab = page.getByRole('tab', { name: 'Watched' });
  await page.getByRole('tab', { name: 'All bots' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(watchedTab).toHaveAttribute('aria-selected', 'true');
  await expect(roster.getByRole('listitem')).toHaveCount(1);

  await page.reload();
  await page.getByRole('tab', { name: 'Roster', exact: true }).click();
  await expect(watchedTab).toHaveAttribute('aria-selected', 'true');
  await expect(roster.getByRole('listitem')).toHaveCount(1);
});

test('the legend lists Waiting on you as observed and Blocked as not observable', async ({ page }) => {
  await gotoRoster(page, './');
  await page.getByRole('button', { name: /What the states mean/ }).click();
  await expect(page.getByText('Not observable yet.')).toHaveCount(1);
});

test('an empty roster and an unreachable backend each get their own state', async ({ page }) => {
  await page.goto('./?scenario=empty');
  await expect(page.getByRole('heading', { name: 'No bots are on the roster yet' })).toBeVisible();

  await page.goto('./?scenario=offline');
  await expect(page.getByRole('alert')).toContainText('Could not reach the app backend');
});

test('the stylesheet does not leak onto the host page', async ({ page, context }) => {
  await gotoRoster(page, './?scenario=default');
  await expect(page.getByRole('list', { name: 'Bots' })).toBeVisible();
  await expect(page.locator('style[data-specter-arena]')).toHaveCount(1);

  const probe = () => {
    const style = getComputedStyle(document.body);
    return { fontFamily: style.fontFamily, backgroundColor: style.backgroundColor };
  };
  const control = await context.newPage();
  await control.goto('about:blank');
  expect(await page.evaluate(probe)).toEqual(await control.evaluate(probe));
  const rootFont = await page.locator('.specter-arena-root').evaluate((element) => getComputedStyle(element).fontFamily);
  expect(rootFont).toContain('Inter');
});
