import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ locale: 'en-US', timezoneId: 'UTC' });

const FORBIDDEN = /\b(idle|healthy|available)\b/i;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const sectionTab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Sections' }).getByRole('tab', { name });
const dialog = (page: Page) => page.locator('dialog[open]');
const showcase = (page: Page) => page.getByRole('region', { name: 'Specter showcase' });
const rosterList = (page: Page) => page.getByRole('list', { name: 'Bots' });
const writes = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __specterFixtureCalls?: { method: string; path: string }[] }).__specterFixtureCalls ?? []).filter((call) => call.method !== 'GET'));

/** The Arena is the landing tab, so a scenario opens on it; this goes on to the tab asked for. */
async function open(page: Page, scenario: string, tab: 'Roster' | 'Specters' | 'Arena' = 'Roster') {
  await page.goto(`./?scenario=${scenario}`);
  await expect(sectionTab(page, tab)).toBeVisible();
  await sectionTab(page, tab).click();
}

async function violations(page: Page, include = '.specter-arena-root') {
  const result = await new AxeBuilder({ page }).include(include).withTags(WCAG_TAGS).analyze();
  return result.violations.map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(' ')) }));
}

test.describe('the walkthrough', () => {
  test('opens by itself over the Arena, and a keyboard-only user assigns, skips, randomizes and finishes', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./?scenario=specters-unassigned');
    await expect(dialog(page)).toBeVisible();
    await expect(sectionTab(page, 'Arena')).toHaveAttribute('aria-selected', 'true');
    const heading = dialog(page).getByRole('heading', { level: 2 });
    await expect(heading).toHaveText('Choose a Specter for Dune');
    await expect(heading).toBeFocused();
    await expect(dialog(page).getByText('Step 1 of 4')).toBeVisible();
    await expect(dialog(page).getByText('A bot keeps its Specter once assigned.')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('radio', { name: /^Rattle/ })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(dialog(page).getByRole('radio', { name: /^Ember/ })).toBeChecked();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', { name: 'Assign Ember' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveText('Choose a Specter for Ember');
    await expect(dialog(page).getByText('Step 2 of 4')).toBeVisible();

    await dialog(page).getByRole('button', { name: 'Skip for now' }).focus();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveText('Choose a Specter for Fenn');
    await dialog(page).getByRole('button', { name: 'Randomize all unassigned' }).focus();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveText('Specters assigned');
    await expect(dialog(page).getByRole('status')).toHaveText('4 assigned, 0 skipped');
    await expect(dialog(page).getByRole('button', { name: 'Done' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toHaveCount(0);
    expect(errors).toEqual([]);

    const posted = (await writes(page)).map((call) => call.path.split('/').slice(-2).join('/'));
    expect(posted).toHaveLength(4);
    expect(posted.every((tail) => tail.endsWith('/hero'))).toBe(true);
  });

  test('keeps focus out of the page behind it, and Escape closes it and remembers the bots, so a reload does not reopen it', async ({ page }) => {
    await page.goto('./?scenario=specters-unassigned');
    await expect(dialog(page)).toBeVisible();
    for (let press = 0; press < 14; press += 1) {
      await page.keyboard.press('Tab');
      // A native modal dialog makes the page behind it inert. Past its last control, focus leaves for the browser's own controls (activeElement is then the body).
      const inside = await page.evaluate(() => document.activeElement === document.body || document.activeElement?.closest('dialog') !== null);
      expect(inside, `Tab ${press}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    const stored = await page.evaluate(() => window.localStorage.getItem('specter-arena:onboarding:v1'));
    expect(JSON.parse(stored ?? 'null')).toMatchObject({ v: 1 });
    expect(stored ?? '').not.toMatch(/Dune|Ember|Fenn/);
    await page.reload();
    await expect(sectionTab(page, 'Arena')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(dialog(page)).toHaveCount(0);
    await sectionTab(page, 'Specters').click();
    await expect(page.getByRole('button', { name: 'Assign Specters (4)' })).toBeVisible();
    await page.getByRole('button', { name: 'Assign Specters (4)' }).click();
    await expect(dialog(page).getByText('Step 1 of 4')).toBeVisible();
  });

  test('"Randomize all unassigned" on the first step gives every bot a different hero, and the Roster shows them', async ({ page }) => {
    await page.goto('./?scenario=specters-all-unassigned');
    await expect(dialog(page).getByText('Step 1 of 7')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Randomize all unassigned' }).click();
    await expect(dialog(page).getByRole('status')).toHaveText('7 assigned, 0 skipped');
    await dialog(page).getByRole('button', { name: 'Done' }).click();
    await sectionTab(page, 'Roster').click();
    const lines = await rosterList(page).locator('.sa-row__specter').allTextContents();
    expect(lines).toHaveLength(7);
    expect(new Set(lines).size).toBe(7);
    await expect(rosterList(page).getByText('No Specter yet')).toHaveCount(0);
  });

  test('says why when the backend refuses, and stays on the step', async ({ page }) => {
    await page.goto('./?scenario=specters-assign-fail');
    await dialog(page).getByRole('button', { name: /^Assign / }).click();
    await expect(dialog(page).getByRole('alert')).toHaveText("The app's database is unavailable. Nothing was changed.");
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText('Choose a Specter for Dune');
    await dialog(page).getByRole('button', { name: 'Randomize all unassigned' }).click();
    await expect(dialog(page).getByRole('status')).toHaveText('0 assigned, 0 skipped, 4 could not be assigned');
  });

  test('has no axe violation on a step or on the summary, and the focused hero and buttons show an outline with forced colors', async ({ page }) => {
    await page.goto('./?scenario=specters-unassigned');
    await expect(dialog(page)).toBeVisible();
    expect(await violations(page), 'step').toEqual([]);
    expect(await violations(page, 'dialog'), 'step, dialog only').toEqual([]);
    await dialog(page).getByRole('button', { name: 'Randomize all unassigned' }).click();
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText('Specters assigned');
    expect(await violations(page), 'summary').toEqual([]);

    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('./?scenario=specters-all-unassigned');
    const radio = dialog(page).getByRole('radio').first();
    await expect(dialog(page).getByRole('heading', { level: 2 })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(radio).toBeFocused();
    const outline = await radio.locator('xpath=ancestor::label[1]').evaluate((node) => ({ style: getComputedStyle(node).outlineStyle, width: getComputedStyle(node).outlineWidth }));
    expect(outline.style).not.toBe('none');
    expect(outline.width).not.toBe('0px');
    const skip = dialog(page).getByRole('button', { name: 'Skip for now' });
    await skip.focus();
    expect((await skip.evaluate((node) => getComputedStyle(node).outlineStyle))).not.toBe('none');
  });

  test('at 390 px the dialog fits and the page does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('./?scenario=specters-unassigned');
    await expect(dialog(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const box = await dialog(page).boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    await expect(dialog(page).getByRole('button', { name: 'Close' })).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Close' }).scrollIntoViewIfNeeded();
    expect(await violations(page), 'at 390').toEqual([]);
  });

  test('is never opened by the scenarios that have no unassigned bot', async ({ page }) => {
    for (const scenario of ['default', 'specters', 'arena', 'specters-none']) {
      await page.goto(`./?scenario=${scenario}`);
      await expect(sectionTab(page, 'Arena')).toBeVisible();
      await page.waitForTimeout(300);
      await expect(dialog(page), scenario).toHaveCount(0);
    }
  });
});

test.describe('the Roster and the bot detail', () => {
  test('rows show the hero or "No Specter yet" with Assign, and Assign opens the walkthrough on that bot', async ({ page }) => {
    await page.goto('./?scenario=specters-unassigned');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await sectionTab(page, 'Roster').click();
    await expect(rosterList(page).getByText('Specter: Vell', { exact: true })).toBeVisible();
    await expect(rosterList(page).getByText('No Specter yet')).toHaveCount(4);
    await expect(rosterList(page).getByRole('button', { name: /^Assign a Specter to/ })).toHaveCount(4);
    await rosterList(page).getByRole('button', { name: 'Assign a Specter to Fenn' }).click();
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText('Choose a Specter for Fenn');
    await dialog(page).getByRole('button', { name: /^Assign / }).click();
    await expect(dialog(page).getByText('Step 2 of 4')).toBeVisible();
  });

  test('the Specter tab of a bot offers Assign when it has none, and the hero, avatar and XP when it has one', async ({ page }) => {
    await page.goto('./?scenario=specters-unassigned');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await sectionTab(page, 'Roster').click();
    await rosterList(page).getByRole('button', { name: /^Dune/ }).click();
    await page.getByRole('tab', { name: 'Specter', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'No Specter yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Assign a Specter', exact: true }).click();
    await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText('Choose a Specter for Dune');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await rosterList(page).getByRole('button', { name: /^Atlas/ }).click();
    await page.getByRole('tab', { name: 'Specter', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Vell' })).toBeVisible();
    await expect(page.getByText('Calm and a little formal.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change avatar' })).toBeVisible();
  });

  test('a keyboard-only journey changes the avatar from the bot detail and lands on the hero heading', async ({ page }) => {
    await open(page, 'specters');
    await rosterList(page).getByRole('button', { name: /^Atlas/ }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('tab', { name: 'Specter', exact: true }).focus();
    await page.keyboard.press('Enter');
    const change = page.getByRole('button', { name: 'Change avatar' });
    await change.focus();
    await page.keyboard.press('Enter');
    const gallery = page.getByRole('radiogroup', { name: 'Portraits' });
    await expect(gallery).toBeVisible();
    await gallery.getByRole('radio', { name: /Tide portrait/ }).check();
    await page.getByRole('button', { name: 'Apply' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Vell' })).toBeFocused();
    await expect(gallery).toHaveCount(0);
    await expect(page.locator('.sa-portrait--lg img.sa-portrait__img')).toBeVisible();
  });

  test('the avatar picker applies a bundled portrait, resets to the hero portrait and explains a bad upload', async ({ page }) => {
    await open(page, 'specters');
    await rosterList(page).getByRole('button', { name: /^Atlas/ }).click();
    await page.getByRole('tab', { name: 'Specter', exact: true }).click();
    await page.getByRole('button', { name: 'Change avatar' }).click();
    const gallery = page.getByRole('radiogroup', { name: 'Portraits' });
    await expect(gallery.getByRole('radio')).toHaveCount(12);
    await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await gallery.getByRole('radio', { name: /Teal|Tide portrait/ }).first().check();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(gallery).toHaveCount(0);
    await expect(page.locator('.sa-portrait--lg img.sa-portrait__img')).toBeVisible();
    await page.getByRole('button', { name: 'Change avatar' }).click();
    await page.getByRole('radio', { name: /Use the hero portrait/ }).check();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Vell' })).toBeFocused();
    await page.getByRole('button', { name: 'Change avatar' }).click();
    await page.getByLabel(/^Upload a PNG/).setInputFiles({ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('this is not a png') });
    await expect(page.getByRole('alert')).toHaveText('That file is not a valid PNG image the app can use.');
  });

  test('no control edits the hero name or personality', async ({ page }) => {
    await open(page, 'specters');
    await rosterList(page).getByRole('button', { name: /^Atlas/ }).click();
    await page.getByRole('tab', { name: 'Specter', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Specter' });
    await expect(panel.getByRole('button')).toHaveText(['Change avatar']);
    await expect(panel.locator('input[type=text], textarea')).toHaveCount(0);
    await expect(panel).toContainText('Calm and a little formal.');
  });

  test('every bot row shows its hero name after the bot name, and never idle, healthy or available', async ({ page }) => {
    await open(page, 'specters');
    for (const hero of ['Vell', 'Stitch', 'Reeve', 'Rattle', 'Ember', 'Shard', 'Poly']) await expect(rosterList(page).getByText(`Specter: ${hero}`, { exact: true })).toBeVisible();
    await expect(rosterList(page).locator('img.sa-portrait__img')).toHaveCount(7);
    const sources = await rosterList(page).locator('img.sa-portrait__img').evaluateAll((images) => images.map((image) => image.getAttribute('src')));
    expect(new Set(sources).size).toBe(7);
    expect((await page.locator('.specter-arena-root').textContent()) ?? '').not.toMatch(FORBIDDEN);
  });

  test('a twelfth bot shows the second hero ordinal', async ({ page }) => {
    await open(page, 'arena-perf-1');
    await expect(rosterList(page).getByText('Specter: Vell II', { exact: true })).toBeVisible();
    await expect(rosterList(page).getByText('Specter: Lume II', { exact: true })).toBeVisible();
  });

  test('a portrait that fails to load falls back to a labelled token', async ({ page }) => {
    await open(page, 'asset-failed');
    await rosterList(page).getByRole('button', { name: /^Atlas/ }).click();
    await page.getByRole('tab', { name: 'Specter', exact: true }).click();
    await expect(page.getByText('Portrait could not be loaded. Showing a placeholder token.')).toBeVisible();
  });
});

test.describe('the showcase', () => {
  test('shows the 11 heroes, the first held one large with its epithet and personality, and the holders flyout opens the Roster on that bot', async ({ page }) => {
    await open(page, 'specters', 'Specters');
    await expect(showcase(page)).toBeVisible();
    await expect(showcase(page).getByRole('radiogroup', { name: 'Heroes' }).getByRole('radio')).toHaveCount(11);
    await expect(showcase(page).getByRole('radio', { name: 'Vell held by 1' })).toBeChecked();
    await expect(showcase(page).getByRole('radio', { name: 'Tide not held yet' })).toBeVisible();
    await expect(showcase(page).getByRole('heading', { level: 3 })).toHaveText('Vell');
    await expect(showcase(page).getByText('The caped one with the golden clasp')).toBeVisible();

    const stage = showcase(page).locator('.sa-showcase__stage');
    const sprite = stage.locator('img.sa-hero__img');
    await expect(sprite).toBeVisible();
    expect(await sprite.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(512);
    const box = await sprite.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(280);
    expect(box?.height).toBeGreaterThanOrEqual(280);
    await expect(stage.locator('[data-animation]')).toHaveAttribute('data-animation', 'idle');

    const toggle = showcase(page).getByRole('button', { name: 'Bots with this Specter (1)' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await showcase(page).getByRole('button', { name: /^Atlas .*Show in the Roster$/ }).click();
    await expect(sectionTab(page, 'Roster')).toHaveAttribute('aria-selected', 'true');
    const row = rosterList(page).getByRole('button', { name: /^Atlas/ });
    await expect(row).toHaveAttribute('aria-current', 'true');
    await expect(row).toBeFocused();
    await expect(page.getByRole('region', { name: 'Bot detail' }).getByRole('heading', { level: 2, name: 'Atlas' })).toBeVisible();
  });

  test('offers the chosen hero\u2019s avatar pack as a link and calls nothing', async ({ page }) => {
    await open(page, 'specters', 'Specters');
    const link = showcase(page).getByRole('link', { name: 'Download Vell\u2019s avatar pack' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://github.com/burlabs/specter-arena/blob/main/avatar-packs/packs/specters-vell.pack.json');
    await expect(showcase(page).getByText('Use this Specter as your Crew avatar: download its avatar pack, then in Crew open Avatar → Customize → Library → Import.')).toBeVisible();
    await showcase(page).getByRole('radio', { name: /^bur/ }).check();
    await expect(showcase(page).getByRole('link', { name: 'Download bur\u2019s avatar pack' })).toHaveAttribute('href', /specters-bur\.pack\.json$/);
    await expect(showcase(page).locator('.sa-showcase__pack code')).toHaveText(/specters-bur\.pack\.json$/);
    expect(await writes(page)).toEqual([]);
    const requested = await page.evaluate(() => ((window as unknown as { __specterFixtureCalls?: { path: string }[] }).__specterFixtureCalls ?? []).map((call) => call.path));
    expect(requested.filter((path) => path.includes('appearances'))).toEqual([]);
  });

  test('Attack and Cast play once and return to idle, and nothing is written', async ({ page }) => {
    await open(page, 'specters', 'Specters');
    const stage = showcase(page).locator('.sa-showcase__stage');
    const state = stage.locator('[data-animation]');
    await showcase(page).getByRole('button', { name: 'Attack' }).click();
    await expect(state).toHaveAttribute('data-animation', 'attack');
    await expect(stage.locator('.sa-hero__fx')).toHaveCount(1);
    await expect(state).toHaveAttribute('data-animation', 'idle');
    await showcase(page).getByRole('radio', { name: /^Stitch/ }).check();
    await showcase(page).getByRole('button', { name: 'Cast' }).click();
    await expect(state).toHaveAttribute('data-animation', 'cast');
    await expect(state).toHaveAttribute('data-animation', 'idle');
    expect(await writes(page)).toEqual([]);
    expect((await page.locator('.specter-arena-root').textContent()) ?? '').not.toMatch(FORBIDDEN);
  });

  test('with reduced motion Attack and Cast are off with a note, and nothing animates', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'specters', 'Specters');
    await expect(showcase(page).getByRole('button', { name: 'Attack' })).toBeDisabled();
    await expect(showcase(page).getByRole('button', { name: 'Cast' })).toBeDisabled();
    await expect(showcase(page).getByText('Attack and Cast are off because reduced motion is requested.')).toBeVisible();
    await showcase(page).getByRole('radio', { name: /^Stitch/ }).check();
    await showcase(page).getByRole('button', { name: /^Bots with this Specter/ }).click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });

  test('keeps the Assign button for bots with no Specter and drops it when none is left', async ({ page }) => {
    await page.goto('./?scenario=specters-unassigned');
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await sectionTab(page, 'Specters').click();
    await expect(showcase(page).getByRole('radio', { name: 'Vell held by 1' })).toBeChecked();
    await showcase(page).getByRole('button', { name: 'Assign Specters (4)' }).click();
    await dialog(page).getByRole('button', { name: 'Randomize all unassigned' }).click();
    await dialog(page).getByRole('button', { name: 'Done' }).click();
    await expect(showcase(page).getByRole('button', { name: /^Assign Specters/ })).toHaveCount(0);
    await expect(showcase(page).getByRole('radiogroup', { name: 'Heroes' }).getByRole('radio', { name: /not held yet/ })).toHaveCount(4);
  });

  test('at 390 px the showcase stacks, the page does not scroll sideways and the sprite fits', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'specters', 'Specters');
    await expect(showcase(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const sprite = showcase(page).locator('img.sa-hero__img');
    await expect(sprite).toBeVisible();
    const box = await sprite.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(200);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  });

  test('the Specter stylesheet is scoped and leaves the host page alone', async ({ page }) => {
    await open(page, 'specters');
    await expect(rosterList(page)).toBeVisible();
    await expect(page.locator('style[data-specter-arena]')).toHaveCount(1);
    await expect(page.locator('style[data-specter-arena-specters]')).toHaveCount(1);
    const read = () => {
      const style = getComputedStyle(document.body);
      return { fontFamily: style.fontFamily, backgroundColor: style.backgroundColor };
    };
    const own = await page.evaluate(read);
    const control = await page.context().newPage();
    await control.goto('about:blank');
    const blank = await control.evaluate(read);
    expect(own).toEqual(blank);
  });

  test('is read-only to a browse: no write without a click', async ({ page }) => {
    await open(page, 'specters', 'Specters');
    await showcase(page).getByRole('radio', { name: /^Reeve/ }).check();
    await showcase(page).getByRole('button', { name: /^Bots with this Specter/ }).click();
    expect(await writes(page)).toEqual([]);
  });
});
