import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type PlayFeed } from '../../src/feed';
import { formatCopies, formatPrice, formatTakings, runLedger } from '../../src/ledger';

/**
 * The owner's account, as a player actually meets it.
 *
 * The arithmetic is asserted in `tests/unit/ledger.test.ts` and against a
 * hand-computed total in `tests/integration/ledger-campaign.test.ts`. What is
 * left for here is the part only a browser can answer: that the menu appears
 * when a decade turns, that it does not stand between the player and the desk,
 * and that the three figures move when they should and stay put when they
 * should not.
 */

const FEED_URL = 'https://news-tycoon.vercel.app/play.json';

const twelve = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/ledger-campaign.json'), 'utf-8'),
) as unknown;

async function serveFeed(page: Page, body: unknown): Promise<void> {
  await page.route(FEED_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(body),
    }),
  );
}

/** Believe the first voice, then print or hold. */
async function play(page: Page, choice: 'print' | 'hold'): Promise<void> {
  await page.locator('#voices button').first().click();
  await page.locator(choice === 'print' ? '#do-print' : '#do-hold').click();
}

test('the menu opens on issue 1 with the decade prices on the buttons', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  await expect(page.locator('#price-menu')).toBeVisible();
  // 1930 in the table: 1 / 2 / 3.
  await expect(page.locator('#price-cheap')).toHaveText('1p — more readers');
  await expect(page.locator('#price-standard')).toHaveText('2p — as you were');
  await expect(page.locator('#price-dear')).toHaveText('3p — fewer readers');
  await expect(page.locator('#price')).toHaveText('2p');
  await expect(page.locator('#copies')).toHaveText('20,000');
  await expect(page.locator('#takings')).toHaveText('£0.00');
});

test('the menu does not stand between the player and the desk', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  await expect(page.locator('#price-menu')).toBeVisible();
  // Never touching a price button, the desk still works and the standard price
  // applies. This is the property the older end-to-end runs depend on.
  await play(page, 'print');

  await expect(page.locator('#price')).toHaveText('2p');
  await expect(page.locator('#takings')).toHaveText('£540.00'); // 20000 * 1.35 * 2p
  await expect(page.locator('#price-menu')).toBeHidden();
});

test('choosing cheap buys readers and shows it', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  await page.locator('#price-cheap').click();
  await expect(page.locator('#price')).toHaveText('1p');
  await expect(page.locator('#copies')).toHaveText('23,000');
  await expect(page.locator('#price-menu')).toBeHidden();
});

test('holding moves the money exactly as a quiet week would', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  await play(page, 'hold');

  // No lift, no bill, and the sale untouched: 20000 * 2p.
  await expect(page.locator('#takings')).toHaveText('£400.00');
  await expect(page.locator('#copies')).toHaveText('20,000');
  await expect(page.locator('#printed')).toHaveText('0');
});

test('the second decade re-opens the menu and resets the price to its standard', async ({
  page,
}) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  // Three episodes in the 1930s, then the 1960s.
  for (let i = 0; i < 3; i += 1) {
    await play(page, 'hold');
    await page.locator('#next').click();
  }

  await expect(page.locator('#price-menu')).toBeVisible();
  await expect(page.locator('#price')).toHaveText('6p');
  await expect(page.locator('#price-standard')).toHaveText('6p — as you were');
});

test('a printed access story is still bleeding copies three issues later', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  await play(page, 'print');
  await expect(page.locator('#copies')).toHaveText('20,000');

  for (let i = 0; i < 3; i += 1) {
    await page.locator('#next').click();
    await play(page, 'hold');
  }

  // The bill from issue 1 landed on issue 4: 20000 * 0.96.
  await expect(page.locator('#copies')).toHaveText('19,200');
});

test('a law bill names the decision that caused it, issues after the fact', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  // Issue 3 is the 1937 law episode; its bill falls due on issue 6.
  for (let i = 0; i < 2; i += 1) {
    await play(page, 'hold');
    await page.locator('#next').click();
  }
  await play(page, 'print');
  for (let i = 0; i < 3; i += 1) {
    await page.locator('#next').click();
    await play(page, 'hold');
  }

  await expect(page.locator('#ledger-note')).toHaveText(
    'The bill for London 1937 came out of the takings.',
  );
});

/**
 * The one that stops the two loops drifting.
 *
 * `runLedger` is a second copy of the issue loop, kept for tests. Without an
 * assertion that the shipped loop lands on the same numbers, moving `accrue`
 * out of `decide()` or dropping the quiet-issue accrual would leave every other
 * test in this file green while the figure the player reads is wrong.
 */
test('a whole campaign ends on the number the pure path computes', async ({ page }) => {
  const episodes = assertPlayFeed(twelve as PlayFeed).episodes.map(toPlayable);
  const expected = runLedger(
    episodes,
    Array.from({ length: 4 }, () => 'standard' as const),
    Array.from({ length: 12 }, () => 'hold' as const),
  );

  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  for (let guard = 0; guard < 80; guard += 1) {
    if (await page.locator('#done').isVisible()) break;
    if (await page.locator('#step-print').isVisible()) await page.locator('#do-hold').click();
    else if (await page.locator('#next').isVisible()) await page.locator('#next').click();
    else if (await page.locator('#quiet-next').isVisible()) await page.locator('#quiet-next').click();
    else await page.locator('#voices button').first().click();
  }

  await expect(page.locator('#done')).toBeVisible();
  await expect(page.locator('#takings')).toHaveText(formatTakings(expected.takingsPence));
  await expect(page.locator('#copies')).toHaveText(formatCopies(expected.copies));
  await expect(page.locator('#price')).toHaveText(formatPrice(expected.pricePence));
});

test('a price arriving after the week is sold changes nothing', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  await play(page, 'print');
  await expect(page.locator('#takings')).toHaveText('£540.00');

  // The menu is hidden, not removed, so a click can still be dispatched at it.
  await page.locator('#price-cheap').dispatchEvent('click');

  await expect(page.locator('#price')).toHaveText('2p');
  await expect(page.locator('#copies')).toHaveText('20,000');
  await expect(page.locator('#takings')).toHaveText('£540.00');
});

test('a second price in the same decade is refused, not applied twice', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  await page.locator('#price-cheap').click();
  await expect(page.locator('#copies')).toHaveText('23,000');

  await page.locator('#price-cheap').dispatchEvent('click');
  await expect(page.locator('#copies')).toHaveText('23,000');
});

test('starting again resets the owner account, not just the record', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  await page.locator('#price-cheap').click();
  await play(page, 'print');
  await expect(page.locator('#takings')).not.toHaveText('£0.00');

  for (let guard = 0; guard < 80; guard += 1) {
    if (await page.locator('#done').isVisible()) break;
    if (await page.locator('#step-print').isVisible()) await page.locator('#do-hold').click();
    else if (await page.locator('#next').isVisible()) await page.locator('#next').click();
    else if (await page.locator('#quiet-next').isVisible()) await page.locator('#quiet-next').click();
    else await page.locator('#voices button').first().click();
  }
  await page.locator('#again').click();

  await expect(page.locator('#takings')).toHaveText('£0.00');
  await expect(page.locator('#copies')).toHaveText('20,000');
  await expect(page.locator('#price')).toHaveText('2p');
  await expect(page.locator('#ledger-note')).toHaveText('');
  await expect(page.locator('#price-menu')).toBeVisible();
});

test('the bill line clears once the issue that carried it has passed', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  for (let i = 0; i < 2; i += 1) {
    await play(page, 'hold');
    await page.locator('#next').click();
  }
  await play(page, 'print');
  for (let i = 0; i < 3; i += 1) {
    await page.locator('#next').click();
    await play(page, 'hold');
  }
  await expect(page.locator('#ledger-note')).toHaveText(
    'The bill for London 1937 came out of the takings.',
  );

  await page.locator('#next').click();
  await expect(page.locator('#ledger-note')).toHaveText('');
});

/**
 * The drift test that actually exercises the machinery.
 *
 * The all-hold run above proves the loops agree when every pending item carries
 * `lever: null` and no price is ever chosen — which is to say, when almost
 * nothing happens. This one prints every story and takes a price at the first
 * boundary, so bills land, access compounds into later weeks, and the chosen
 * price multiplies a sale the pure path also has to get right.
 */
test('a printed campaign with a chosen price ends where the pure path says', async ({ page }) => {
  const episodes = assertPlayFeed(twelve as PlayFeed).episodes.map(toPlayable);
  const expected = runLedger(
    episodes,
    ['cheap', 'standard', 'standard', 'standard'],
    Array.from({ length: 12 }, () => 'print' as const),
  );

  await serveFeed(page, twelve);
  await page.goto('/?seed=1');
  await page.locator('#price-cheap').click();

  for (let guard = 0; guard < 80; guard += 1) {
    if (await page.locator('#done').isVisible()) break;
    if (await page.locator('#step-print').isVisible()) await page.locator('#do-print').click();
    else if (await page.locator('#next').isVisible()) await page.locator('#next').click();
    else if (await page.locator('#quiet-next').isVisible()) await page.locator('#quiet-next').click();
    else await page.locator('#voices button').first().click();
  }

  await expect(page.locator('#done')).toBeVisible();
  await expect(page.locator('#takings')).toHaveText(formatTakings(expected.takingsPence));
  await expect(page.locator('#copies')).toHaveText(formatCopies(expected.copies));
});

test('an ignored menu still closes that decade to a later click', async ({ page }) => {
  await serveFeed(page, twelve);
  await page.goto('/?seed=1');

  // Ignore the menu on issue 1, then move to issue 2 of the same decade.
  await play(page, 'hold');
  await page.locator('#next').click();
  await expect(page.locator('#price-menu')).toBeHidden();

  await page.locator('#price-cheap').dispatchEvent('click');

  await expect(page.locator('#copies')).toHaveText('20,000');
  await expect(page.locator('#price')).toHaveText('2p');
});
