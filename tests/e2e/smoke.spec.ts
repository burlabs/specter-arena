import { expect, test } from '@playwright/test';
import { gotoRoster } from './support';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

test('the preview harness shows the FIXTURE banner and the observatory roster', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await gotoRoster(page, './');

  await expect(page.locator('#fixture-banner')).toHaveText(
    'SPECTER-FIXTURE-ONLY: FIXTURE, not live Crew data; backend not running in preview',
  );
  await expect(page.getByRole('heading', { level: 1, name: 'Specters of the Abyss' })).toBeVisible();
  const roster = page.getByRole('list', { name: 'Bots' });
  await expect(roster.getByRole('listitem')).toHaveCount(7);
  for (const name of ['Atlas', 'Brindle', 'Cinder', 'Dune', 'Ember', 'Fenn', 'Unnamed bot']) {
    await expect(roster.getByText(name, { exact: true })).toBeVisible();
  }

  await roster.getByRole('button', { name: /^Atlas/ }).click();
  await expect(page.getByRole('region', { name: 'Bot detail' }).getByRole('heading', { level: 2, name: 'Atlas' })).toBeVisible();
  expect(errors).toEqual([]);
});
