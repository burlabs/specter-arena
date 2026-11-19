import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const SECTIONS = ['Roster', 'Specters', 'Work', 'Arena'] as const;

const sectionTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name });
const rosterList = (page: Page) => page.getByRole('list', { name: 'Bots' });

async function open(page: Page, scenario: string) {
  await page.goto(`./?scenario=${scenario}`);
  await expect(rosterList(page).getByRole('listitem')).toHaveCount(7);
}

/** Violations found inside the app root only; the preview page around it is not the product. */
async function violations(page: Page, rules?: string[]) {
  const builder = new AxeBuilder({ page }).include('.specter-arena-root');
  const result = await (rules === undefined ? builder.withTags(WCAG_TAGS) : builder.withRules(rules)).analyze();
  return result.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(' ')) }));
}

test('AX-1 each of the four tabs has no WCAG 2.1 A or AA axe violation', async ({ page }) => {
  await open(page, 'arena');
  for (const section of SECTIONS) {
    await sectionTab(page, section).click();
    await expect(page.getByRole('tabpanel', { name: section })).toBeVisible();
    expect(await violations(page), section).toEqual([]);
  }
});

test('AX-2 selected states have no violation: bot, Specter, Work item, and every Arena token', async ({ page }) => {
  test.setTimeout(45_000);
  await open(page, 'arena');
  await rosterList(page).getByRole('button', { name: /^Atlas/ }).click();
  expect(await violations(page), 'bot detail').toEqual([]);
  await page.getByRole('tab', { name: 'Progression' }).click();
  expect(await violations(page), 'progression').toEqual([]);

  await sectionTab(page, 'Specters').click();
  await page.getByRole('list', { name: 'Bots with Specters' }).getByRole('button').first().click();
  expect(await violations(page), 'Specter detail').toEqual([]);

  await sectionTab(page, 'Work').click();
  await page.getByRole('list', { name: 'Work items' }).getByRole('button').first().click();
  expect(await violations(page), 'Work detail').toEqual([]);

  await sectionTab(page, 'Arena').click();
  await expect(page.getByRole('group', { name: 'Arena map' })).toBeVisible();
  const tokens = page.locator('[data-scene-node]');
  await expect(tokens.first()).toBeVisible();
  const count = await tokens.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await tokens.nth(index).click();
    expect(await violations(page), `Arena token ${index}`).toEqual([]);
  }
});

test('AX-3 the avatar picker has no violation', async ({ page }) => {
  await open(page, 'specters');
  await sectionTab(page, 'Specters').click();
  await page.getByRole('list', { name: 'Bots with Specters' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Change avatar' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Portraits' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

const outline = (locator: Locator) => locator.evaluate((node) => ({ style: getComputedStyle(node).outlineStyle, width: getComputedStyle(node).outlineWidth }));

test('AX-4 with forced colors on, a keyboard-focused tab, button, link and search box each show an outline', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await open(page, 'arena');
  await sectionTab(page, 'Roster').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await expect(sectionTab(page, 'Roster')).toBeFocused();
  const focused: Array<[string, Locator]> = [
    ['tab', sectionTab(page, 'Roster')],
    ['search box', page.getByRole('searchbox', { name: 'Search bots by name' })],
    ['row button', rosterList(page).getByRole('button', { name: /^Atlas/ })],
  ];
  for (const [name, locator] of focused) {
    await page.keyboard.press('Escape');
    await locator.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(locator, name).toBeFocused();
    const { style, width } = await outline(locator);
    expect(style, `${name} outline style`).not.toBe('none');
    expect(width, `${name} outline width`).not.toBe('0px');
  }
  await sectionTab(page, 'Arena').click();
  await page.locator('[data-sprite="enemy"]').first().click();
  const handoff = page.locator('a[data-handoff="open-bots"]');
  await handoff.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(handoff).toBeFocused();
  expect((await outline(handoff)).style).not.toBe('none');
});

test('AX-5 with reduced motion requested, Roster, Specters and Arena run no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'arena');
  for (const section of ['Roster', 'Specters', 'Arena'] as const) {
    await sectionTab(page, section).click();
    await expect(page.getByRole('tabpanel', { name: section })).toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.getAnimations().length), section).toBe(0);
  }
});

test('AX-6 one keyboard-only pass reaches all four tabs and moves focus into each panel', async ({ page }) => {
  await open(page, 'arena');
  const ready: Record<(typeof SECTIONS)[number], Locator> = {
    Roster: rosterList(page),
    Specters: page.getByRole('list', { name: 'Bots with Specters' }),
    Work: page.getByRole('button', { name: 'New work item' }),
    Arena: page.getByRole('group', { name: 'Arena map' }),
  };
  await sectionTab(page, 'Roster').focus();
  for (const section of SECTIONS) {
    if (section !== 'Roster') await page.keyboard.press('ArrowRight');
    await expect(sectionTab(page, section)).toHaveAttribute('aria-selected', 'true');
    await expect(sectionTab(page, section)).toBeFocused();
    await expect(ready[section]).toBeVisible();
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => document.activeElement?.closest('[role="tabpanel"]') !== null);
    expect(inside, `${section}: Tab moves into the panel`).toBe(true);
    await sectionTab(page, section).focus();
  }
  await page.keyboard.press('ArrowRight');
  await expect(sectionTab(page, 'Roster')).toHaveAttribute('aria-selected', 'true');
});
