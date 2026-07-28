import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type PlayFeed } from '../../src/feed';
import { CAMPAIGN_LENGTH, deal } from '../../src/deal';

/**
 * The dealer, through the browser.
 *
 * The seed arrives as `?seed=`, not as a test hook. Playwright drives
 * `npm run preview`, which serves the production build, so anything gated on
 * `import.meta.env.DEV` would be dead code by the time it got here. Reading the
 * query string works in the build that ships, and a reproducible campaign URL
 * is worth having for its own sake.
 *
 * The feed is stubbed by intercepting the request, the way `game.spec.ts`
 * already does. `VITE_FEED_URL` is inlined at build time and would do nothing
 * from a test run.
 */

const FEED_URL = 'https://news-tycoon.vercel.app/play.json';
const SEED = 'e2e-fixed-seed';

const poolFeed = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/pool-36.json'), 'utf-8'),
) as PlayFeed;

const pool = assertPlayFeed(poolFeed).episodes.map(toPlayable);

/** The campaign the browser must produce, computed here from the same inputs. */
const expected = deal(pool, SEED);

/**
 * A seed that opens on a different episode, found rather than guessed.
 *
 * Campaigns are played in date order, so two different campaigns often still
 * start on the same episode: whichever came out of the earliest decade. An
 * assertion that two seeds differ has to compare something that actually
 * differs, and hard-coding a second seed would make this test a hostage to the
 * fixture.
 */
const OTHER_SEED = (() => {
  for (let n = 0; n < 200; n += 1) {
    const seed = `e2e-other-${n}`;
    if (deal(pool, seed).episodes[0].slug !== expected.episodes[0].slug) return seed;
  }
  throw new Error('no seed opened on a different episode, which the unit sweep says is impossible');
})();

async function servePool(page: Page): Promise<void> {
  await page.route(FEED_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(poolFeed),
    }),
  );
}

test('a seeded campaign is 12 of the 36, in date order', async ({ page }) => {
  await servePool(page);
  await page.goto(`/?seed=${SEED}`);
  await expect(page.locator('#game')).toBeVisible();

  expect(expected.episodes).toHaveLength(CAMPAIGN_LENGTH);
  expect(expected.degraded).toBe(false);

  // The first desk on screen is the first episode of the dealt campaign, which
  // is the earliest by year, not the first in the feed.
  await expect(page.locator('#desk')).toHaveText(expected.episodes[0].desk);
  await expect(page.locator('#issue-where')).toContainText(String(expected.episodes[0].year));
});

test('the same seed deals the same campaign twice', async ({ page }) => {
  await servePool(page);

  await page.goto(`/?seed=${SEED}`);
  await expect(page.locator('#game')).toBeVisible();
  // textContent, not innerText: the header is uppercased in CSS, and innerText
  // returns what the transform rendered while toHaveText compares the DOM text.
  const first = await page.locator('#issue-where').textContent();

  await page.goto(`/?seed=${SEED}`);
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#issue-where')).toHaveText(first ?? '');
});

test('a different seed deals a different campaign', async ({ page }) => {
  await servePool(page);

  await page.goto(`/?seed=${SEED}`);
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#desk')).toHaveText(expected.episodes[0].desk);

  await page.goto(`/?seed=${OTHER_SEED}`);
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#desk')).toHaveText(deal(pool, OTHER_SEED).episodes[0].desk);

  // And the two really are different episodes, which is what OTHER_SEED was
  // chosen for.
  expect(deal(pool, OTHER_SEED).episodes[0].slug).not.toBe(expected.episodes[0].slug);
});

test('a full seeded run: 12 episodes, the quiet issues, and the done screen reports 12', async ({
  page,
}) => {
  test.slow();
  await servePool(page);
  await page.goto(`/?seed=${SEED}`);
  await expect(page.locator('#game')).toBeVisible();

  for (let i = 0; i < CAMPAIGN_LENGTH; i += 1) {
    await expect(page.locator('#issue-no')).toHaveText(`Issue ${i + 1}`);
    await expect(page.locator('#desk')).toHaveText(expected.episodes[i].desk);
    await page.locator('#voices button').first().click();
    await page.locator('#do-print').click();
    await expect(page.locator('#result-now')).toHaveText(expected.episodes[i].print.now);
    await page.locator('#next').click();
  }

  // Everything owed still has to arrive, and the tail is what the pacing rule
  // bounds. The guard is generous; the assertion is that it ends at all.
  for (let guard = 0; guard < 60; guard += 1) {
    if (await page.locator('#done').isVisible()) break;
    await page.locator('#quiet-next').click();
  }

  await expect(page.locator('#done')).toBeVisible();
  await expect(page.locator('#printed')).toHaveText(String(CAMPAIGN_LENGTH));

  // The count is the dealt campaign, not the pool it came from.
  await expect(page.locator('#done-text')).toContainText(`of ${CAMPAIGN_LENGTH}`);
  await expect(page.locator('#done-text')).not.toContainText('of 36');

  // Every bill arrived, one per decision.
  await expect(page.locator('#record li')).toHaveCount(CAMPAIGN_LENGTH);
});

test('the two-episode feed still plays, which is what production serves today', async ({
  page,
}) => {
  const live = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/play.json'), 'utf-8'),
  ) as PlayFeed;

  await page.route(FEED_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(live),
    }),
  );

  await page.goto('/');

  // The degraded path: too small to deal from, so it is played whole. Shipping
  // the dealer must not take the published game to its empty state.
  await expect(page.locator('#game')).toBeVisible();
  await expect(page.locator('#empty')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#issue-no')).toHaveText('Issue 1');
});
