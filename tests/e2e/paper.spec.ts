import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type PlayFeed } from '../../src/feed';
import { formatCopies, formatTakings } from '../../src/ledger';
import { playDay, startPaper, type Action, type PaperState } from '../../src/paper';

/**
 * The paper as a player meets it.
 *
 * The arithmetic is asserted in the unit and integration tests. What is left for
 * here is the part only a browser can answer: that planning a day and printing
 * it lands on the state the model says it should, and that the screen shows
 * what the state holds. The comparison runs against `playDay` rather than
 * against numbers typed in here, so the two paths cannot drift.
 */

const FEED_URL = 'https://news-tycoon.vercel.app/play.json';
const FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/pool-36.json'), 'utf-8'),
) as PlayFeed;
const POOL = assertPlayFeed(FIXTURE).episodes.map(toPlayable);

async function serveFeed(page: Page): Promise<void> {
  await page.route(FEED_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(FIXTURE),
    }),
  );
}

/** The same loop `main.ts` runs when the player presses Print it. */
function model(days: Action[][]): PaperState {
  let state = startPaper();
  for (const actions of days) {
    state = playDay(state, POOL, actions);
    if (state.over) return state;
    state = { ...state, day: state.day + 1 };
  }
  return state;
}

test('the paper opens on its first day', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#cash')).toHaveText('£1,500.00');
  await expect(page.locator('#copies')).toHaveText('20,000');
  await expect(page.locator('#price')).toHaveText('2p');
  await expect(page.locator('#reporters')).toHaveText('3/3');
  await expect(page.locator('#day')).toHaveText('Day 1');
  await expect(page.locator('#sources li')).toHaveCount(3);
});

test('a planned day changes nothing until it is printed', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  await page.locator('.source[data-source="council"] .cultivate').click();
  await expect(page.locator('#planned')).toContainText('work council');
  await expect(page.locator('#day')).toHaveText('Day 1');
  await expect(page.locator('#cash')).toHaveText('£1,500.00');

  await page.locator('#next-day').click();
  await expect(page.locator('#day')).toHaveText('Day 2');
  await expect(page.locator('#planned')).toHaveText('Nothing planned for tomorrow.');
});

test('the screen and the model agree over a worked fortnight', async ({ page }) => {
  const days: Action[][] = Array.from({ length: 14 }, () => [
    { kind: 'cultivate', sourceId: 'council' },
  ]);
  const expected = model(days);

  await serveFeed(page);
  await page.goto('/');

  for (let i = 0; i < days.length; i += 1) {
    await page.locator('.source[data-source="council"] .cultivate').click();
    await page.locator('#next-day').click();
  }

  await expect(page.locator('#cash')).toHaveText(formatTakings(expected.cashPence));
  await expect(page.locator('#copies')).toHaveText(formatCopies(expected.copies));
  await expect(page.locator('#reporters')).toHaveText(
    `${expected.reporters - expected.running.length}/${expected.reporters}`,
  );
});

test('a story that matures waits on the desk until it is run', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  // Four days on a source, six for the reporter, and then it is there.
  for (let i = 0; i < 4; i += 1) {
    await page.locator('.source[data-source="council"] .cultivate').click();
    await page.locator('#next-day').click();
  }
  for (let i = 0; i < 6; i += 1) await page.locator('#next-day').click();

  await expect(page.locator('#available .article')).toHaveCount(1);
  for (let i = 0; i < 3; i += 1) await page.locator('#next-day').click();
  await expect(page.locator('#available .article')).toHaveCount(1);
});

test('a paper that cannot pay its wages closes', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  // Hire past what the opening print run can carry, then stand still.
  for (let i = 0; i < 8; i += 1) await page.locator('#hire').click();
  await page.locator('#next-day').click();

  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('#over').isVisible()) break;
    await page.locator('#next-day').click();
  }

  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#desk')).toBeHidden();
});
