import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type PlayFeed } from '../../src/feed';
import { formatCopies, formatTakings } from '../../src/ledger';
import { runCampaign, type Action } from '../../src/paper';
import { TIP_EVERY_DAYS } from '../../src/sources';

/**
 * The paper as a player meets it.
 *
 * The arithmetic is asserted in the unit and integration tests. What is left for
 * here is the part only a browser can answer: that planning a day and printing
 * it lands on the state the model says it should, and that the screen shows
 * what the state holds. The comparison runs against `runCampaign` rather than
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
  const expected = runCampaign(POOL, days).at(-1)!;

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

  // The advertorial is permanent, so count only what was worked for.
  const investigations = page.locator('#available .article[data-source="investigation"]');
  await expect(investigations).toHaveCount(1);
  for (let i = 0; i < 3; i += 1) await page.locator('#next-day').click();
  await expect(investigations).toHaveCount(1);
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
  // Both endings share the panel, so the losing one has to say which it is.
  await expect(page.locator('#over-heading')).toHaveText('The paper has closed');
  await expect(page.locator('#over-text')).toContainText('nothing came back');
});

test('a paper that everybody reads wins, and the panel says so', async ({ page }) => {
  // Sixty-seven days of buying, publishing and printing is about 200 real
  // interactions, which does not fit the default 30 seconds. Raised rather than
  // shortened: reaching the ceiling is the whole assertion, and a budget that
  // stopped early would assert nothing.
  test.setTimeout(180_000);
  await serveFeed(page);
  await page.goto('/');

  // Buy from the stringer every morning and lead with what arrived last night.
  // The same line the `runCampaign` unit test drives, which reaches the ceiling
  // on day 67 — not the `mixed-blind` calibration row, because picking "the best
  // thing on the desk" through the DOM would mean re-deriving the growth order
  // in the browser, and a test that reimplements the policy it is checking is
  // not evidence about the screen. The budget is 100 days against a win on 67.
  const stringer = page.locator('.article[data-source="stringer"] .publish');
  for (let day = 0; day < 100; day += 1) {
    if (await page.locator('#over').isVisible()) break;
    await page.locator('#buy-stringer').click();
    if ((await stringer.count()) > 0) await stringer.first().click();
    await page.locator('#next-day').click();
  }

  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#desk')).toBeHidden();
  await expect(page.locator('#over-heading')).toHaveText('Everyone reads you now');
  await expect(page.locator('#over-text')).toContainText('80,000 copies a day');
});

test('an empty archive is a state, not a failure', async ({ page }) => {
  await page.route(FEED_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ version: 1, count: 0, episodes: [] }),
    }),
  );
  await page.goto('/');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#game')).toBeHidden();
});

for (const [name, fulfil] of [
  ['a 500', (route: import('@playwright/test').Route) => route.fulfill({ status: 500, body: 'no' })],
  ['an aborted request', (route: import('@playwright/test').Route) => route.abort()],
  [
    'a malformed body',
    (route: import('@playwright/test').Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{' }),
  ],
] as const) {
  test(`${name} feed says so on the page instead of rendering nothing`, async ({ page }) => {
    await page.route(FEED_URL, fulfil);
    await page.goto('/');
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#game')).toBeHidden();
  });
}

test('a pool the economy cannot charge for is refused, not played', async ({ page }) => {
  // An unknown lever charges nothing. Played anyway, the game becomes unlosable
  // and the only trace is a console line no player reads.
  const renamed = {
    ...FIXTURE,
    episodes: FIXTURE.episodes.map((e) => ({ ...e, lever: 'scandal' })),
  };
  await page.route(FEED_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(renamed),
    }),
  );
  await page.goto('/');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#game')).toBeHidden();
});

test('a story can be run, and the book records it', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  for (let i = 0; i < 4; i += 1) {
    await page.locator('.source[data-source="council"] .cultivate').click();
    await page.locator('#next-day').click();
  }
  for (let i = 0; i < 6; i += 1) await page.locator('#next-day').click();

  const before = await page.locator('#copies').textContent();
  await page.locator('#available .article[data-source="investigation"] .publish').click();
  await page.locator('#next-day').click();

  await expect(page.locator('#available .article[data-source="investigation"]')).toHaveCount(0);
  await expect(page.locator('#copies')).not.toHaveText(before ?? '');
  // Not the first line any more: arrivals are the last thing a day does, so the
  // newest entry is usually a story turning up rather than the money.
  await expect(page.locator('#ledger li').filter({ hasText: 'Sales' }).first()).toBeVisible();
  await expect(page.locator('#ledger li').filter({ hasText: 'Published' }).first()).toBeVisible();
});

test('a plan can be changed before it is printed', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  // Clearing is a real button, and only offered when there is something to
  // clear. It used to be a click handler on the paragraph: mouse-only, no
  // focus, no role, and one mis-tap discarded a whole multi-action day.
  await expect(page.locator('#clear-plan')).toBeHidden();
  await page.locator('#hire').click();
  await expect(page.locator('#planned')).toContainText('hire a reporter');

  await expect(page.locator('#clear-plan')).toBeVisible();
  await page.locator('#clear-plan').focus();
  await expect(page.locator('#clear-plan')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#planned')).toHaveText('Nothing planned for tomorrow.');
  await expect(page.locator('#clear-plan')).toBeHidden();

  await page.locator('#next-day').click();
  await expect(page.locator('#reporters')).toHaveText('3/3');
});

test('the wire button says what the plan will leave behind', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  // The label used to read from committed state only, so it contradicted the
  // click that had just queued a change.
  await expect(page.locator('#wire')).toContainText('Take the wire');
  await page.locator('#wire').click();
  await expect(page.locator('#wire')).toContainText('Drop the wire');
  await expect(page.locator('#planned')).toContainText('take the wire');

  // A second press cancels the first instead of queueing a duplicate the model
  // answers with "Already on the wire."
  await page.locator('#wire').click();
  await expect(page.locator('#wire')).toContainText('Take the wire');
  await expect(page.locator('#planned')).toHaveText('Nothing planned for tomorrow.');
});

test('the free-reporter figure counts what the rules will accept', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  await expect(page.locator('#reporters')).toHaveText('3/3');
  // Working a source spends a reporter for the day, and the figure has to say
  // so before Print it rather than after.
  await page.locator('.source[data-source="council"] .cultivate').click();
  await expect(page.locator('#reporters')).toHaveText('2/3');
  await page.locator('.source[data-source="courts"] .cultivate').click();
  await expect(page.locator('#reporters')).toHaveText('1/3');

  // A second go at a source already worked is refused and costs nothing, so it
  // must not be charged here either.
  await page.locator('.source[data-source="council"] .cultivate').click();
  await expect(page.locator('#reporters')).toHaveText('1/3');

  // A queued hire is a hand the plan will have.
  await page.locator('#hire').click();
  await expect(page.locator('#reporters')).toHaveText('2/4');
  // And a queued fire is one it will not.
  await page.locator('#fire').click();
  await expect(page.locator('#reporters')).toHaveText('1/3');
});

test('queueing one story twice costs one reporter, not two', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  // The publish button appends on every tap and nothing dedupes it, so this is
  // one misclick away. `playDay` runs the story once and refuses the repeat for
  // nothing; the screen has to agree, or it locks out work the rules allow.
  await expect(page.locator('#reporters')).toHaveText('3/3');
  const advertorial = page.locator('#available .article[data-source="advertorial"] .publish');
  await advertorial.click();
  await expect(page.locator('#reporters')).toHaveText('2/3');

  await advertorial.click();
  await advertorial.click();
  await expect(page.locator('#tomorrow .tomorrow-slot')).toHaveCount(3);
  // Three slots queued, one reporter spent: the advertiser gets one page.
  await expect(page.locator('#reporters')).toHaveText('2/3');
  await expect(page.locator('#tomorrow-slots')).toHaveText('2');
});

test('an issue is built as a lead and an inside, and can be taken apart again', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  // Day 1: take the wire and buy a story, so day 2 opens with three things on
  // the desk — the advertorial, the stringer, and a wire item.
  await expect(page.locator('#tomorrow-empty')).toBeVisible();
  await page.locator('#wire').click();
  await page.locator('#buy-stringer').click();
  await page.locator('#next-day').click();

  const stringer = page.locator('#available .article[data-source="stringer"] .publish');
  const advertorial = page.locator('#available .article[data-source="advertorial"] .publish');
  const wire = page.locator('#available .article[data-source="wire"] .publish');
  await expect(stringer).toHaveCount(1);

  // Three reporters, none working a source. The stringer leads, the advertorial
  // and the wire item go inside. Only the first two cost a reporter.
  await stringer.click();
  await advertorial.click();
  await wire.click();

  await expect(page.locator('#tomorrow-empty')).toBeHidden();
  await expect(page.locator('#tomorrow .tomorrow-slot')).toHaveCount(3);
  await expect(page.locator('#tomorrow .tomorrow-slot').first()).toHaveAttribute('data-role', 'lead');
  await expect(page.locator('#tomorrow .tomorrow-slot').nth(1)).toHaveAttribute('data-role', 'inside');
  await expect(page.locator('#tomorrow-slots')).toHaveText('1');

  // Take the middle one out by its own button, not by id.
  await page.locator('#tomorrow .tomorrow-slot').nth(1).locator('.remove').click();
  await expect(page.locator('#tomorrow .tomorrow-slot')).toHaveCount(2);
  await expect(page.locator('#tomorrow-slots')).toHaveText('2');

  await page.locator('#next-day').click();
  await expect(page.locator('#tomorrow-empty')).toBeVisible();
});

test('a tip already under check is not offered again the next morning', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  for (let i = 0; i < TIP_EVERY_DAYS + 2; i += 1) {
    if ((await page.locator('#available .article[data-source="tip"]').count()) > 0) break;
    await page.locator('#next-day').click();
  }
  const tip = page.locator('#available .article[data-source="tip"]').first();
  await expect(tip.locator('.check')).toBeEnabled();

  await tip.locator('.check').click();
  await page.locator('#next-day').click();

  // The tip is still unverified while the reporter is on it, so the card is
  // still there — but the button must not invite work already in hand.
  await expect(tip).toHaveCount(1);
  await expect(tip.locator('.check')).toBeDisabled();
});

test('starting again puts the paper back where it began', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  for (let i = 0; i < 8; i += 1) await page.locator('#hire').click();
  await page.locator('#next-day').click();
  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('#over').isVisible()) break;
    await page.locator('#next-day').click();
  }
  await expect(page.locator('#over')).toBeVisible();

  await page.locator('#again').click();
  await expect(page.locator('#cash')).toHaveText('£1,500.00');
  await expect(page.locator('#reporters')).toHaveText('3/3');
  await expect(page.locator('#day')).toHaveText('Day 1');
  await expect(page.locator('#desk')).toBeVisible();
});

test('the wire changes an ordinary day', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  await expect(page.locator('#available .article[data-source="wire"]')).toHaveCount(0);
  await page.locator('#wire').click();
  await page.locator('#next-day').click();
  await expect(page.locator('#available .article[data-source="wire"]')).toHaveCount(1);

  // And it keeps costing, one item at a time.
  await page.locator('#next-day').click();
  await expect(page.locator('#available .article[data-source="wire"]')).toHaveCount(1);
  await expect(page.locator('#ledger li').filter({ hasText: 'The wire' }).first()).toBeVisible();
});

test('a bought story arrives the next morning', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  await page.locator('#buy-stringer').click();
  await page.locator('#next-day').click();
  await expect(page.locator('#available .article[data-source="stringer"]')).toHaveCount(1);
});

test('an unchecked tip gives nothing away', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  // Walk to the first tip. Bound derived from the cadence, not written out: at
  // a bare 12 a raised TIP_EVERY_DAYS failed on the count assertion below and
  // said nothing about which of the two had actually moved.
  for (let i = 0; i < TIP_EVERY_DAYS + 2; i += 1) {
    if ((await page.locator('#available .article[data-source="tip"]').count()) > 0) break;
    await page.locator('#next-day').click();
  }
  const tip = page.locator('#available .article[data-source="tip"]').first();
  await expect(tip).toHaveCount(1);

  // The label says only that it is unchecked. Nothing about whether it stands up.
  await expect(tip.locator('.voice-who')).toHaveText('unchecked');
  await expect(tip.locator('.check')).toBeVisible();

  // The plan names the story the way the desk does, not by its internal id —
  // the same rule `lead with …` already followed.
  const headline = (await tip.locator('.voice-says').textContent()) ?? '';
  expect(headline).not.toBe('');
  await tip.locator('.check').click();
  await expect(page.locator('#planned')).toContainText(`check ${headline}`);
  await expect(page.locator('#planned')).not.toContainText('tip-');
  await page.locator('#next-day').click();
  await expect(page.locator('#reporters')).toHaveText('2/3');
});
