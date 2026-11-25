import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Opens the page and moves to the Roster tab: the Arena is the tab the page opens on. */
export async function gotoRoster(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name: 'Roster' }).click();
  await expect(page.getByRole('tab', { name: 'Roster', selected: true })).toBeVisible();
}
