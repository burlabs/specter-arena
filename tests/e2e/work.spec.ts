import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const FORBIDDEN = /\b(idle|healthy|available)\b/i;
const RESULT_WORDS = /\b(success(ful|fully)?|succeeded|completed?|defeated|finished)\b/i;
const ACK = 'I reviewed the evidence above and accept this work';

const sectionTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name });
const workList = (page: Page) => page.getByRole('list', { name: 'Work items' });
const detail = (page: Page) => page.getByRole('region', { name: 'Work detail' });
const botDetail = (page: Page) => page.getByRole('region', { name: 'Bot detail' });
const rosterList = (page: Page) => page.getByRole('list', { name: 'Bots' });
const card = (page: Page, title: string) => botDetail(page).getByRole('heading', { level: 3, name: title, exact: true }).locator('..');
const badge = (page: Page) => detail(page).locator('.sa-work-badge');

async function openRoster(page: Page, scenario: string) {
  await page.goto(`./?scenario=${scenario}`);
  await expect(rosterList(page).getByRole('listitem')).toHaveCount(7);
}

async function openWork(page: Page, scenario: string) {
  await openRoster(page, scenario);
  await sectionTab(page, 'Work').click();
  await expect(page.getByRole('button', { name: 'New work item' })).toBeVisible();
}

const selectWork = (page: Page, title: string) => workList(page).getByRole('button', { name: new RegExp(`^${title}`) }).click();
const selectBot = async (page: Page, name: string) => {
  await rosterList(page).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(botDetail(page).getByRole('heading', { level: 2, name })).toBeVisible();
};

async function press(page: Page, target: Locator, key: string) {
  await target.focus();
  await page.keyboard.press(key);
}

test('E-1 a keyboard-only journey creates, submits and accepts work, and the bot card shows the XP', async ({ page }) => {
  await openRoster(page, 'work-none');
  await page.getByRole('tab', { name: 'Roster' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(sectionTab(page, 'Work')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('No work items yet')).toBeVisible();

  await press(page, page.getByRole('button', { name: 'New work item' }), 'Enter');
  await page.getByRole('textbox', { name: /^Title/ }).fill('Tidy the inbox');
  await page.getByRole('textbox', { name: /^Acceptance condition/ }).fill('The inbox is empty.');
  await page.getByRole('combobox', { name: 'Bot' }).selectOption({ label: 'Brindle' });
  const attempt = page.getByRole('checkbox', { name: /Bot turn · .* · Ended/ });
  await expect(attempt).toBeVisible();
  await press(page, attempt, 'Space');
  await expect(attempt).toBeChecked();
  await press(page, page.getByRole('button', { name: 'Create work item' }), 'Enter');

  await expect(detail(page).getByRole('heading', { level: 2, name: 'Tidy the inbox' })).toBeFocused();
  await expect(badge(page)).toHaveText('Open');
  await press(page, detail(page).getByRole('button', { name: 'Submit for review' }), 'Enter');
  await expect(badge(page)).toHaveText('Awaiting your review');

  await press(page, detail(page).getByRole('button', { name: 'Accept…' }), 'Enter');
  const form = detail(page).getByRole('form', { name: 'Accept this work' });
  await expect(form.getByRole('heading', { name: 'Accept this work' })).toBeFocused();
  await expect(form).toContainText('1 linked attempt: ');
  await expect(form).toContainText('You are accepting this as the app owner.');
  const accept = form.getByRole('button', { name: 'Accept work' });
  await expect(accept).toBeDisabled();
  await press(page, form.getByRole('checkbox', { name: ACK }), 'Space');
  await expect(accept).toBeEnabled();
  await press(page, accept, 'Enter');

  await expect(badge(page)).toHaveText('Accepted');
  await expect(detail(page).getByRole('list', { name: 'Decisions, oldest first' })).toContainText('by app-owner');
  await sectionTab(page, 'Roster').click();
  await selectBot(page, 'Brindle');
  await expect(card(page, 'XP')).toContainText('100 XP from accepted work');
  await expect(card(page, 'Accepted work')).toContainText('1');
});

test('E-2 an ended attempt earns nothing until the owner accepts it', async ({ page }) => {
  await openRoster(page, 'work-none');
  await selectBot(page, 'Brindle');
  await expect(botDetail(page).getByRole('tabpanel')).toContainText('Ended');
  await expect(card(page, 'XP')).toContainText('0 XP from accepted work');
  await sectionTab(page, 'Work').click();
  await expect(page.getByText('Observed attempts stay unclassified and earn nothing until you track them as work.')).toBeVisible();

  await page.getByRole('button', { name: 'New work item' }).click();
  await page.getByRole('textbox', { name: /^Title/ }).fill('Left open');
  await page.getByRole('textbox', { name: /^Acceptance condition/ }).fill('Never submitted.');
  await page.getByRole('combobox', { name: 'Bot' }).selectOption({ label: 'Brindle' });
  await page.getByRole('checkbox', { name: /Ended/ }).check();
  await page.getByRole('button', { name: 'Create work item' }).click();
  await expect(badge(page)).toHaveText('Open');
  await expect(detail(page).getByRole('button', { name: 'Accept…' })).toHaveCount(0);
  await sectionTab(page, 'Roster').click();
  await selectBot(page, 'Brindle');
  await expect(card(page, 'XP')).toContainText('0 XP from accepted work');
});

test('E-3 a contributor is listed once and an attempt that is tracked cannot be picked again', async ({ page }) => {
  await openWork(page, 'work');
  await selectWork(page, 'Migrate the nightly report');
  const contributors = detail(page).getByRole('list', { name: 'Contributors' }).getByRole('listitem');
  await expect(contributors).toHaveText(['Atlas · 1 attempt · No XP yet', 'Brindle · 1 attempt · No XP yet']);
  await page.getByRole('button', { name: 'New work item' }).click();
  await page.getByRole('combobox', { name: 'Bot' }).selectOption({ label: 'Atlas' });
  const tracked = page.getByRole('checkbox', { name: /Worker · att_cccc…0001 · Still open/ });
  await expect(tracked).toBeDisabled();
  await expect(page.getByText('Tracked in Summarize the support backlog')).toBeVisible();
});

test('E-4 each state offers exactly its actions and shows every seeded decision', async ({ page }) => {
  await openWork(page, 'work');
  const names = /^(Submit for review|Accept…|Reject…|Mark blocked|Unblock|Cancel work item…|Reopen…)$/;
  const cases: Array<[string, string[]]> = [
    ['Summarize the support backlog', ['Submit for review', 'Mark blocked', 'Cancel work item…']],
    ['Rotate the staging keys', ['Submit for review', 'Mark blocked', 'Cancel work item…']],
    ['Migrate the nightly report', ['Accept…', 'Reject…', 'Mark blocked', 'Cancel work item…']],
    ['Audit the shared drive permissions', ['Unblock', 'Cancel work item…']],
    ['Rewrite the runbook intro', ['Reopen…', 'Cancel work item…']],
    ['Reconcile the Q3 invoices', ['Reopen…']],
    ['Clean up stale tickets', []],
  ];
  for (const [title, expected] of cases) {
    await selectWork(page, title);
    await expect(detail(page).getByRole('heading', { level: 2, name: title })).toBeVisible();
    expect(await detail(page).getByRole('button', { name: names }).allTextContents()).toEqual(expected);
  }
  await selectWork(page, 'Rotate the staging keys');
  const decisions = detail(page).getByRole('list', { name: 'Decisions, oldest first' }).getByRole('listitem');
  await expect(decisions).toHaveCount(3);
  await expect(decisions.nth(0)).toContainText('Submitted for review by app-owner');
  await expect(decisions.nth(1)).toContainText('Accepted by app-owner');
  await expect(decisions.nth(2)).toContainText('Reopened by app-owner');
  await expect(decisions.nth(2)).toContainText('One key was missed.');
});

test('E-5 progress is milestones done or unknown, never a percentage', async ({ page }) => {
  await openWork(page, 'work');
  await selectWork(page, 'Migrate the nightly report');
  await expect(detail(page).getByText('1 of 3 milestones done')).toBeVisible();
  const second = detail(page).getByRole('checkbox', { name: 'Check the totals' });
  await press(page, second, 'Space');
  await expect(detail(page).getByText('2 of 3 milestones done')).toBeVisible();
  await selectWork(page, 'Summarize the support backlog');
  await expect(detail(page).getByText('Progress unknown')).toBeVisible();
  const text = (await page.getByRole('tabpanel', { name: 'Work' }).textContent()) ?? '';
  expect(text).not.toMatch(/%/);
  await expect(page.getByRole('tabpanel', { name: 'Work' }).getByRole('progressbar')).toHaveCount(0);
});

test('E-6 stale evidence refuses the acceptance, then a fresh review succeeds and the XP moves once', async ({ page }) => {
  await openWork(page, 'work-stale');
  await selectWork(page, 'Migrate the nightly report');
  await detail(page).getByRole('button', { name: 'Accept…' }).click();
  await detail(page).getByRole('checkbox', { name: ACK }).check();
  await detail(page).getByRole('button', { name: 'Accept work' }).click();
  await expect(detail(page).getByRole('alert')).toContainText('The evidence changed after you opened this review, so nothing was decided.');
  await expect(detail(page).getByRole('button', { name: 'Accept…' })).toBeDisabled();
  await expect(badge(page)).toHaveText('Awaiting your review');
  await detail(page).getByRole('button', { name: 'Review again' }).click();
  await detail(page).getByRole('checkbox', { name: ACK }).check();
  await detail(page).getByRole('button', { name: 'Accept work' }).click();
  await expect(badge(page)).toHaveText('Accepted');
  await sectionTab(page, 'Roster').click();
  await selectBot(page, 'Atlas');
  await expect(card(page, 'XP')).toContainText('200 XP from accepted work');
});

test('E-7 a version conflict reloads the item and the second try succeeds', async ({ page }) => {
  await openWork(page, 'work-conflict');
  await selectWork(page, 'Summarize the support backlog');
  await detail(page).getByRole('button', { name: 'Submit for review' }).click();
  await expect(detail(page).getByRole('alert')).toContainText('This work item changed somewhere else. It was reloaded; review it and try again.');
  await expect(badge(page)).toHaveText('Open');
  await detail(page).getByRole('button', { name: 'Submit for review' }).click();
  await expect(badge(page)).toHaveText('Awaiting your review');
});

test('E-8 a level is traceable to its ledger entries, the policy and the level table', async ({ page }) => {
  await openRoster(page, 'work');
  await selectBot(page, 'Atlas');
  await expect(card(page, 'Accepted work')).toContainText('2');
  await expect(card(page, 'XP')).toContainText('150 XP from accepted work');
  await expect(card(page, 'Level')).toContainText('Level 2');
  await expect(card(page, 'Level')).toContainText('50 of 150 XP toward level 3');
  await expect(card(page, 'Level')).toContainText('Level reflects accepted work, not ability or current condition.');
  await page.getByRole('tab', { name: 'Progression' }).click();
  const entries = botDetail(page).getByRole('list', { name: 'XP entries, newest first' }).getByRole('listitem');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText('+100 XP');
  await expect(entries.nth(1)).toContainText('+50 XP');
  await expect(botDetail(page).getByText('Policy xp-policy-1 · Level table levels-1')).toBeVisible();

  await selectBot(page, 'Brindle');
  await page.getByRole('tab', { name: 'Progression' }).click();
  const brindle = botDetail(page).getByRole('list', { name: 'XP entries, newest first' }).getByRole('listitem');
  await expect(brindle).toHaveCount(3);
  await expect(brindle.nth(0)).toContainText('-100 XP');
  await expect(brindle.nth(0)).toContainText('Correction (reopened)');
  await expect(brindle.nth(1)).toContainText('+100 XP');
  await expect(card(page, 'XP')).toContainText('50 XP from accepted work');
});

for (const [scenario, words] of [
  ['work-failure', 'Could not load. It retries automatically.'],
  ['work-offline', 'Could not load. It retries automatically.'],
  ['work-unsupported', 'Not supported by this backend'],
] as const) {
  test(`E-9 ${scenario} leaves the roster usable and never shows 0 XP`, async ({ page }) => {
    await openRoster(page, scenario);
    await selectBot(page, 'Atlas');
    await expect(card(page, 'XP')).toContainText(words);
    expect((await card(page, 'XP').textContent()) ?? '').not.toMatch(/\d/);
    expect((await card(page, 'Level').textContent()) ?? '').not.toMatch(/\d/);
    await sectionTab(page, 'Work').click();
    await expect(page.getByRole('tabpanel', { name: 'Work' })).toContainText(scenario === 'work-unsupported' ? 'Work tracking is not supported here' : 'Could not load work items');
    await sectionTab(page, 'Roster').click();
    await expect(rosterList(page).getByRole('listitem')).toHaveCount(7);
  });
}

test('E-10 with reduced motion requested, nothing animates in Work or Progression', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openWork(page, 'work');
  await selectWork(page, 'Migrate the nightly report');
  await expect(detail(page).getByRole('heading', { level: 2, name: 'Migrate the nightly report' })).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await sectionTab(page, 'Roster').click();
  await selectBot(page, 'Atlas');
  await page.getByRole('tab', { name: 'Progression' }).click();
  await expect(botDetail(page).getByRole('list', { name: 'XP entries, newest first' })).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const transition = await page.locator('.sa-xp-bar > span').first().evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(transition).toBe('0s');
});

test('E-11 the longest titles and notes never widen a 320 px page beyond what the roster needs', async ({ page }) => {
  const pageWidth = () => page.evaluate(() => document.documentElement.scrollWidth);
  await page.setViewportSize({ width: 320, height: 700 });
  await openRoster(page, 'default');
  const baseline = await pageWidth();
  await openWork(page, 'work-long');
  await workList(page).getByRole('button').first().click();
  await expect(detail(page).getByRole('heading', { level: 2 })).toBeVisible();
  expect(await pageWidth()).toBeLessThanOrEqual(baseline);
});

test('E-12 the Work stylesheet is scoped and leaves the host page alone', async ({ page }) => {
  await page.goto('./?scenario=work');
  await expect(rosterList(page)).toBeVisible();
  await expect(page.locator('style[data-specter-arena-work]')).toHaveCount(1);
  await expect(page.locator('style[data-specter-arena-specters]')).toHaveCount(1);
  await expect(page.locator('style[data-specter-arena]')).toHaveCount(1);
  const style = () => {
    const computed = getComputedStyle(document.body);
    return { fontFamily: computed.fontFamily, backgroundColor: computed.backgroundColor };
  };
  const own = await page.evaluate(style);
  const control = await page.context().newPage();
  await control.goto('about:blank');
  const blank = await control.evaluate(style);
  expect(own).toEqual(blank);
});

test('E-13 no section says idle, healthy or available, and none calls an ended attempt a result', async ({ page }) => {
  await openRoster(page, 'work');
  await selectBot(page, 'Atlas');
  const root = page.locator('.specter-arena-root');
  const scan = async () => {
    const text = (await root.textContent()) ?? '';
    expect(text).not.toMatch(FORBIDDEN);
    expect(text).not.toMatch(RESULT_WORDS);
  };
  await scan();
  await sectionTab(page, 'Specters').click();
  await scan();
  await sectionTab(page, 'Work').click();
  for (const title of ['Migrate the nightly report', 'Reconcile the Q3 invoices', 'Reconcile petty cash', 'Clean up stale tickets']) {
    await selectWork(page, title);
    await expect(detail(page).getByRole('heading', { level: 2, name: title })).toBeVisible();
    await scan();
  }
});

test('E-14 older pages add the missing rows without duplicates', async ({ page }) => {
  await openWork(page, 'work-many');
  const rows = workList(page).getByRole('listitem');
  await expect(rows).toHaveCount(25);
  await page.getByRole('button', { name: 'Load older work items' }).click();
  await expect(rows).toHaveCount(30);
  expect(new Set(await rows.locator('strong').allTextContents()).size).toBe(30);

  await sectionTab(page, 'Roster').click();
  await selectBot(page, 'Atlas');
  await page.getByRole('tab', { name: 'Progression' }).click();
  const entries = botDetail(page).getByRole('list', { name: 'XP entries, newest first' }).getByRole('listitem');
  await expect(entries).toHaveCount(50);
  await page.getByRole('button', { name: 'Load older entries' }).click();
  await expect(entries).toHaveCount(60);
  expect(new Set(await entries.locator('.sa-work-ledger__title').allTextContents()).size).toBe(60);
});
