import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { gotoRoster } from './support';

// FP-20 PR-C: the waiting condition and the context reading, on the FIXTURE `crew-signals` scenario.
test.use({ locale: 'en-US', timezoneId: 'UTC' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FORBIDDEN = /\b(idle|healthy|available)\b/i;

const bots = (page: Page) => page.getByRole('list', { name: 'Bots' });
const row = (page: Page, name: string) => bots(page).getByRole('listitem').filter({ hasText: name });
const selectBot = (page: Page, name: string) => bots(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
const sectionTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name });

async function open(page: Page) {
  await gotoRoster(page, './?scenario=crew-signals');
  await expect(bots(page).getByRole('listitem')).toHaveCount(6);
}

async function axe(page: Page) {
  const result = await new AxeBuilder({ page }).include('.specter-arena-root').withTags(WCAG_TAGS).analyze();
  return result.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(' ')) }));
}

test('SG-1 each waiting bot says Waiting on you with the flag it came from, and the flag-only bot does not', async ({ page }) => {
  await open(page);
  await expect(row(page, 'Approval')).toContainText('Waiting on you');
  await expect(row(page, 'Question')).toContainText('Waiting on you');
  await expect(row(page, 'Flag only')).toContainText('No turn running');

  await selectBot(page, 'Approval');
  const detail = page.getByRole('region', { name: 'Bot detail' });
  await expect(detail).toContainText("Crew's row flag says a tool approval is waiting for you");
  await expect(detail).toContainText('has not been checked against a live approval');
  await selectBot(page, 'Question');
  await expect(detail).toContainText("Crew's row flag says a question is waiting for your answer");
  expect((await page.locator('.specter-arena-root').textContent()) ?? '').not.toMatch(FORBIDDEN);
});

test('SG-2 the legend names Waiting on you as read from Crew flags and keeps Blocked as not observable yet', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /What the states mean/ }).click();
  await expect(page.getByText('Not observable yet.', { exact: false })).toHaveCount(1);
  await expect(page.getByText(/Crew's approval or question flag is set for this bot/)).toBeVisible();
});

test('SG-3 Context in use shows on the Activity tab only: a figure, a real zero, and Not collected', async ({ page }) => {
  await open(page);
  await selectBot(page, 'Approval');
  const detail = page.getByRole('region', { name: 'Bot detail' });
  await expect(detail.getByRole('region', { name: 'Context in use' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Activity' }).click();
  const gauge = detail.getByRole('region', { name: 'Context in use' });
  await expect(gauge).toContainText('48,000 of 200,000 tokens');
  await expect(gauge).toContainText('not tokens spent, not a total, not XP');

  await selectBot(page, 'Zero reading');
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(detail.getByRole('region', { name: 'Context in use' })).toContainText('0 of 200,000 tokens');

  await selectBot(page, 'No reading');
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(detail.getByRole('region', { name: 'Context in use' })).toContainText('Not collected.');

  await page.getByRole('tab', { name: 'Progression' }).click();
  await expect(detail).not.toContainText('Context in use');
  await expect(bots(page)).not.toContainText('tokens');
});

test('SG-4 the arena says Waiting on you for a waiting bot and shows its reason in the inspector', async ({ page }) => {
  await open(page);
  await sectionTab(page, 'Arena').click();
  await expect(page.getByRole('group', { name: 'Arena map' })).toBeVisible();
  // crew-signals has no Specters, so the bots are listed in the rail under "No Specter yet" and no token is drawn (FP-23).
  await expect(page.locator('[data-scene-node="specter"]')).toHaveCount(0);
  const row = page.getByRole('complementary', { name: 'Specters' }).getByRole('button', { name: /^Approval/ });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Waiting on you');
  await row.click();
  const inspector = page.getByRole('complementary', { name: 'Encounter inspector' });
  await expect(inspector).toContainText("Crew's row flag says a tool approval is waiting for you");
  await expect(inspector).not.toContainText('Context in use');
  expect(await axe(page)).toEqual([]);
});

test('SG-5 no WCAG 2.1 A or AA violation with the legend open and a waiting bot on the Activity tab, at 1440 and 390 px', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.getByRole('button', { name: /What the states mean/ }).click();
    await selectBot(page, 'Approval');
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('region', { name: 'Context in use' })).toBeVisible();
    expect(await axe(page), `${width} px`).toEqual([]);
  }
});

test('SG-6 at 390 px the roster with waiting bots and the context card do not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await selectBot(page, 'Approval');
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByRole('region', { name: 'Context in use' })).toBeVisible();
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.view);
  const badge = row(page, 'Approval').locator('.sa-status--waiting');
  const box = await badge.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
});

test('SG-7 with reduced motion requested, the waiting states and the context card run no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await selectBot(page, 'Approval');
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByRole('region', { name: 'Context in use' })).toBeVisible();
  await sectionTab(page, 'Arena').click();
  await expect(page.getByRole('group', { name: 'Arena map' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
