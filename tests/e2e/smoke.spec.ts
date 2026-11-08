import { expect, test } from '@playwright/test';

test('the preview harness shows the FIXTURE banner and the stub shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('./');

  await expect(page.locator('#fixture-banner')).toHaveText(
    'SPECTER-FIXTURE-ONLY: FIXTURE, not live Crew data; backend not running in preview',
  );
  await expect(page.getByRole('heading', { level: 1, name: 'Specter Arena' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Specter Arena' })).toContainText('No product features yet.');
  expect(errors).toEqual([]);
});
