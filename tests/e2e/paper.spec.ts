import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type PlayFeed } from '../../src/feed';
import { formatCopies, formatTakings } from '../../src/ledger';
import { runCampaign, type Action } from '../../src/paper';
import { TIP_EVERY_DAYS } from '../../src/sources';
import { makeSave } from '../fixtures/make-save';

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

  // The same render hides the desk and with it the button just clicked, so
  // without the focus move focus lands on <body> and a screen reader announces
  // nothing at all. Asserted on both endings: the panel is shared, the focus
  // move is not conditional on which one it is.
  await expect(page.locator('#over-heading')).toBeFocused();
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
  await expect(page.locator('#over-heading')).toBeFocused();
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
  // The book lives in the finance panel now, which is closed until the cash
  // figure on the masthead is clicked.
  await page.locator('#finance-toggle').click();
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

test('starting again moves focus onto the desk', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  for (let i = 0; i < 8; i += 1) await page.locator('#hire').click();
  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('#over').isVisible()) break;
    await page.locator('#next-day').click();
  }
  await expect(page.locator('#over')).toBeVisible();

  // Restarting hides #over and with it the button just clicked. Without the
  // focus move that leaves focus on <body> and a screen reader says nothing
  // about the paper that just opened — the ending's bug, in reverse.
  await page.locator('#again').click();
  await expect(page.locator('#desk')).toBeVisible();
  await expect(page.locator('#desk-eyebrow')).toBeFocused();
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
  await page.locator('#finance-toggle').click();
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

/*
 * A campaign survives a reload — news-tycoon-game#15.
 *
 * These four are the ones that prove the feature, because they exercise the
 * real `localStorage` in a real browser. The unit tests cover the shape logic
 * with a stub; nothing there can tell you a reload actually works.
 */

test('a campaign in progress survives a reload', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  for (let i = 0; i < 5; i += 1) await page.locator('#next-day').click();

  const day = await page.locator('#day').textContent();
  const cash = await page.locator('#cash').textContent();
  const before = await page.evaluate(() => localStorage.getItem('news-tycoon:campaign'));

  await page.reload();

  await expect(page.locator('#day')).toHaveText(day ?? '');
  await expect(page.locator('#cash')).toHaveText(cash ?? '');

  // The rendered strings agree; this asserts the whole state does, which is
  // what the acceptance criterion actually asks for.
  const after = await page.evaluate(() => localStorage.getItem('news-tycoon:campaign'));
  expect(JSON.parse(after ?? '{}').state).toEqual(JSON.parse(before ?? '{}').state);
});

test('an ending is still there after a reload', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  // Same route to bankruptcy as the closing test above: hire past what the
  // opening print run carries, then stand still.
  for (let i = 0; i < 8; i += 1) await page.locator('#hire').click();
  await page.locator('#next-day').click();
  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('#over').isVisible()) break;
    await page.locator('#next-day').click();
  }
  await expect(page.locator('#over')).toBeVisible();
  const heading = await page.locator('#over-heading').textContent();
  const text = await page.locator('#over-text').textContent();

  await page.reload();

  // Reaching an ending is the point of a campaign. Losing it to a closed tab
  // would be a worse feeling than losing an unfinished run.
  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#over-heading')).toHaveText(heading ?? '');
  await expect(page.locator('#over-text')).toHaveText(text ?? '');
});

test('starting again leaves a day-one campaign behind, not the old one', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  for (let i = 0; i < 8; i += 1) await page.locator('#hire').click();
  await page.locator('#next-day').click();
  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('#over').isVisible()) break;
    await page.locator('#next-day').click();
  }
  await page.locator('#again').click();
  await page.reload();

  await expect(page.locator('#day')).toHaveText('Day 1');
  const stored = await page.evaluate(() => localStorage.getItem('news-tycoon:campaign'));
  expect(JSON.parse(stored ?? '{}').state.day).toBe(1);
});

test('the game plays through to an ending with storage switched off', async ({ page }) => {
  const complaints: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    // Only ours. `main.ts` warns about pool issues and logs boot failures, and
    // a browser emits its own noise; neither is this feature's business.
    if (message.location().url.includes('save')) complaints.push(message.text());
  });

  // Safari private browsing and a browser with site data switched off both
  // behave like this. The game has to survive it, because failing to remember
  // is not a reason to fail to run.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage disabled');
      },
    });
  });
  await serveFeed(page);
  await page.goto('/');

  for (let i = 0; i < 8; i += 1) await page.locator('#hire').click();
  await page.locator('#next-day').click();
  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('#over').isVisible()) break;
    await page.locator('#next-day').click();
  }

  await expect(page.locator('#over')).toBeVisible();
  expect(complaints).toEqual([]);
});

test('a queued plan is not carried across a reload', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');

  const day = await page.locator('#day').textContent();
  await page.locator('#hire').click();
  await page.locator('#wire').click();

  await page.reload();

  // One day's uncommitted intent, cheap to retype. Saving it would mean saving
  // state `playDay` never validated.
  await expect(page.locator('#day')).toHaveText(day ?? '');
  await expect(page.locator('#planned')).toContainText('Nothing planned');
});

/*
 * The paper as a paper.
 *
 * What the broadsheet layout claims that a list did not: there is a masthead,
 * it says the issue is unprinted, the lead outranks the inside visually, and
 * the whole thing gets out of the way when the campaign ends.
 */

test('the masthead names the paper and says the issue is not printed yet', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  await expect(page.locator('#mast-name')).toHaveText('News Tycoon');
  await expect(page.locator('#dateline')).toHaveText('No. 1 · in preparation · 2p a copy');
  // The one thing the dateline must never do. The page above the fold is an
  // issue being assembled; a date would claim it had gone out.
  await expect(page.locator('#dateline')).not.toContainText(
    /\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
  );
});

test('tomorrow sits above the fold and the desk below it', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  // `account` and `book` are gone: the cash figure moved onto the masthead and
  // everything else that was in those two panels is now `#finance`, which opens
  // from it. The order still has to put the issue above the fold and the desk
  // below it, which is what this test is really for.
  const order = await page.evaluate(() => {
    const ids = ['mast', 'finance', 'step-tomorrow', 'fold', 'desk', 'printbar'];
    return ids.filter((id) => document.getElementById(id) !== null);
  });
  expect(order).toEqual(['mast', 'finance', 'step-tomorrow', 'fold', 'desk', 'printbar']);

  // The panel is closed until asked for, and the figure that opens it is on the
  // masthead.
  await expect(page.locator('#finance')).toBeHidden();
  await expect(page.locator('#mast #finance-toggle')).toBeVisible();

  // `#next-day` must be outside `#desk`: on a phone the print bar is sticky,
  // and a sticky element left inside the desk would never be on screen at the
  // top of the page.
  const inDesk = await page.evaluate(
    () => document.getElementById('desk')?.contains(document.getElementById('next-day')) ?? true,
  );
  expect(inDesk).toBe(false);
});

/*
 * The money is one figure until you ask for the rest.
 *
 * What an owner looks at constantly is what is in hand; what they look at
 * rarely is how it got there. So the masthead carries the cash and the panel
 * behind it carries the copies, the price, the newsroom and the book. The
 * `aria-expanded` half is asserted because the panel and the control are one
 * fact written in two places, and a screen reader reads the one this test would
 * otherwise let drift.
 */
test('the cash figure on the masthead opens and closes finance', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  const toggle = page.locator('#finance-toggle');
  const finance = page.locator('#finance');

  await expect(page.locator('#cash')).toHaveText('£1,500.00');
  await expect(finance).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(finance).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Everything that used to sit on the page permanently is in here.
  await expect(page.locator('#finance #copies')).toBeVisible();
  await expect(page.locator('#finance #price')).toBeVisible();
  await expect(page.locator('#finance #reporters')).toBeVisible();
  await expect(page.locator('#finance #ledger')).toBeAttached();

  await toggle.click();
  await expect(finance).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('the lead is set larger than the inside, and both keep their remove button', async ({
  page,
}) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  const publish = page.locator('#available .voice.publish');
  await publish.nth(0).click();
  await publish.nth(0).click();

  const slots = page.locator('#tomorrow .tomorrow-slot');
  await expect(slots).toHaveCount(2);
  await expect(slots.nth(0)).toHaveAttribute('data-role', 'lead');
  await expect(slots.nth(1)).toHaveAttribute('data-role', 'inside');

  // Markus' call: every story keeps a way out that is not "clear the whole plan".
  await expect(slots.nth(0).locator('.remove')).toBeVisible();
  await expect(slots.nth(1).locator('.remove')).toBeVisible();

  const sizes = await page.evaluate(() => {
    const say = (role: string) =>
      Number.parseFloat(
        getComputedStyle(
          document.querySelector(`#tomorrow .tomorrow-slot[data-role='${role}'] .voice-says`)!,
        ).fontSize,
      );
    return { lead: say('lead'), inside: say('inside') };
  });
  expect(sizes.lead).toBeGreaterThanOrEqual(sizes.inside * 1.6);
});

test('an empty issue shows the empty line and no slots', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  await expect(page.locator('#tomorrow-empty')).toBeVisible();
  await expect(page.locator('#tomorrow .tomorrow-slot')).toHaveCount(0);
});

test('the ending takes the whole paper off the page, not just the desk', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  // The same drive the closing test above uses: hire past what the opening
  // print run can carry, then stand still. Printing empty papers alone does not
  // close a paper inside a sensible budget, which is what the first version of
  // this test got wrong.
  for (let i = 0; i < 8; i += 1) await page.locator('#hire').click();
  await page.locator('#next-day').click();

  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('#over').isVisible()) break;
    await page.locator('#next-day').click();
  }

  await expect(page.locator('#over')).toBeVisible();

  /*
   * Asserted as a property, not as a list.
   *
   * The list version of this test passed while a live "Print it" sat above the
   * ending panel for a day: `#printbar` had been moved out of `#desk` and the
   * list still named the three elements its author remembered. A list of
   * elements is a memory test for whoever wrote it.
   *
   * What is actually true is simpler and cannot rot: when the paper has closed,
   * the only thing you can press is "Start again".
   */
  const live = await page.evaluate(() =>
    [...document.querySelectorAll('#game button')]
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => b.id || (b.textContent ?? '').trim().slice(0, 30)),
  );
  expect(live).toEqual(['again']);
});

/*
 * A campaign that was saved before the broadsheet landed still opens.
 *
 * The layout changed and the state did not: no new fields, no migration. These
 * three seed `localStorage` the way `save.ts` writes it and check the figures
 * the page renders. The expected strings are here rather than in the fixtures —
 * a fixture that carries its own answer cannot fail, and `load()` discards a
 * malformed blob silently, so the test would pass while asserting a fresh
 * campaign it never meant to look at.
 */
for (const campaign of [
  {
    what: 'a fresh campaign',
    overrides: { cashPence: 50_000, copies: 1_000, day: 1 },
    cash: '£500.00',
    copies: '1,000',
    day: 'Day 1',
    dateline: 'No. 1 · in preparation · 2p a copy',
  },
  {
    what: 'a campaign mid-run',
    overrides: { cashPence: 41_200, copies: 8_400, day: 12 },
    cash: '£412.00',
    copies: '8,400',
    day: 'Day 12',
    dateline: 'No. 12 · in preparation · 2p a copy',
  },
]) {
  test(`${campaign.what} saved before this change still opens`, async ({ page }) => {
    await serveFeed(page);
    await page.goto('/');
    await expect(page.locator('#game')).toBeVisible();

    await page.evaluate(
      ([key, blob]) => window.localStorage.setItem(key, blob),
      ['news-tycoon:campaign', makeSave(campaign.overrides)] as const,
    );
    await page.reload();
    await expect(page.locator('#game')).toBeVisible();

    await expect(page.locator('#cash')).toHaveText(campaign.cash);
    await expect(page.locator('#copies')).toHaveText(campaign.copies);
    await expect(page.locator('#day')).toHaveText(campaign.day);
    await expect(page.locator('#dateline')).toHaveText(campaign.dateline);
  });
}

test('an ended campaign saved before this change opens on its ending', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  await page.evaluate(
    ([key, blob]) => window.localStorage.setItem(key, blob),
    ['news-tycoon:campaign', makeSave({ cashPence: 0, copies: 400, day: 31, over: true })] as const,
  );
  await page.reload();
  await expect(page.locator('#game')).toBeVisible();

  await expect(page.locator('#over')).toBeVisible();
  await expect(page.locator('#mast')).toBeHidden();
  await expect(page.locator('#step-tomorrow')).toBeHidden();
  await expect(page.locator('#fold')).toBeHidden();
  await expect(page.locator('#desk')).toBeHidden();
});

/*
 * The broadsheet in the dark.
 *
 * `tokens.css` has carried a dark palette since the game left the site, but
 * nothing asserted that the new page furniture uses it. The masthead and the
 * fold are the two elements drawn with the heaviest rules, so they are where an
 * unthemed colour would be most obvious and most easily missed by an author
 * whose own machine is set to light.
 */
test.describe('dark theme', () => {
  test.use({ colorScheme: 'dark' });

  test('the masthead and the fold are drawn against the dark ground', async ({ page }) => {
    await serveFeed(page);
    await page.goto('/');
    await expect(page.locator('#game')).toBeVisible();

    const paint = await page.evaluate(() => {
      const style = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return {
        ground: style('#paper').backgroundColor || getComputedStyle(document.body).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        name: style('#mast-name').color,
        foldRule: style('#fold').borderTopColor,
        foldText: style('#fold').color,
      };
    });

    // The page is dark, and the two elements are not painted in the ground
    // colour — which is what an unthemed hard-coded value would look like.
    expect(paint.body).toBe('rgb(18, 19, 23)');
    expect(paint.name).not.toBe(paint.body);
    expect(paint.foldRule).not.toBe(paint.body);
    expect(paint.foldText).not.toBe(paint.body);
  });
});

/*
 * The desk reads as two groups, not four peers.
 *
 * What can reach tomorrow's page sits apart from what pays off some other day,
 * because that split is the one the game's economy turns on: a story now, or a
 * source that becomes a story in six days.
 */
test('the desk splits into today and later, in that order', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  const shape = await page.evaluate(() => {
    const el = (id: string) => document.getElementById(id)!;
    const kids = (id: string) =>
      [...el(id).children].map((c) => c.id || c.className).filter(Boolean);
    const before = (a: string, b: string) =>
      !!(el(a).compareDocumentPosition(el(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      today: kids('today'),
      later: kids('later'),
      todayBeforeLater: before('today', 'later'),
      laterBeforePlanned: before('later', 'planned'),
      labelledBy: el('later').getAttribute('aria-labelledby'),
      // The eyebrow is the focus target after Start again. It must still be the
      // first thing in the desk, or that focus move lands somewhere else.
      firstInDesk: el('desk').firstElementChild?.id,
    };
  });

  expect(shape.today).toEqual(['step-available']);
  expect(shape.later).toEqual(['later-label', 'step-sources', 'step-staff', 'step-buy']);
  expect(shape.todayBeforeLater).toBe(true);
  expect(shape.laterBeforePlanned).toBe(true);
  expect(shape.labelledBy).toBe('later-label');
  expect(shape.firstInDesk).toBe('desk-eyebrow');
});

test('later lays out in two columns on a desktop', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });

  const layout = await page.evaluate(() => {
    const tracks = getComputedStyle(document.getElementById('later')!).gridTemplateColumns;
    const sources = document.getElementById('step-sources')!.getBoundingClientRect();
    const staff = document.getElementById('step-staff')!.getBoundingClientRect();
    return { tracks, sameRow: Math.abs(sources.top - staff.top) };
  });

  expect(layout.tracks.trim().split(/\s+/)).toHaveLength(2);
  expect(layout.sameRow).toBeLessThanOrEqual(2);
});

/*
 * A story is one object across its three lives.
 *
 * The reference is what says so. It is derived from the id rather than stored,
 * which is exactly why it has to be asserted end to end: nothing but the screen
 * proves the desk, the front page and the book agree.
 */
test('a story carries the same reference onto the front page', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  const card = page.locator('#available .article').first();
  const onDesk = await card.locator('.voice-ref').textContent();
  expect(onDesk).toMatch(/^№ \d{3}$/);

  await card.locator('.voice.publish').click();

  const onPage = await page.locator('#tomorrow .tomorrow-slot .voice-ref').first().textContent();
  expect(onPage).toBe(onDesk);
});

/*
 * Rough stock, and the line it must not cross.
 *
 * `main.ts` carries the rule: nothing may betray whether an unchecked tip is
 * true. The texture says unverified — which the card already says in words —
 * and must never say wrong. So this asserts the texture is present and that it
 * is drawn in the quiet token, not the accent.
 */
test('an unchecked tip is printed on rougher paper, on the desk and on the page', async ({
  page,
}) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  // Walk until a tip is on the desk. Tips arrive on a fixed cadence.
  const tip = page.locator("#available .article[data-unverified='true']").first();
  for (let day = 0; day < 30; day += 1) {
    if ((await tip.count()) > 0) break;
    await page.locator('#next-day').click();
  }
  await expect(tip).toHaveCount(1);

  const stock = await tip.locator('.voice').evaluate((el) => {
    const s = getComputedStyle(el);
    return { image: s.backgroundImage, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() };
  });
  expect(stock.image).not.toBe('none');
  // The one thing it must not do: read as a warning. A warning would be a hint.
  expect(stock.image).not.toContain(stock.accent);

  // A checked story beside it has none of that.
  const checked = page.locator("#available .article[data-unverified='false'] .voice").first();
  if ((await checked.count()) > 0) {
    expect(await checked.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  }

  // And it follows the story onto the page, which is the point of the treatment.
  await tip.locator('.voice.publish').click();
  const slot = page.locator("#tomorrow .tomorrow-slot[data-unverified='true']").first();
  await expect(slot).toHaveCount(1);
  expect(await slot.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toBe('none');
});

/*
 * Three ways the game now marks a change it used to make silently.
 */

test('the book says what each movement left you holding', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();
  for (let i = 0; i < 3; i += 1) await page.locator('#next-day').click();
  await page.locator('#finance-toggle').click();

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#ledger li')].map((li) => ({
      from: li.querySelector('.record-from')?.textContent ?? '',
      balance: li.querySelector('.record-balance')?.textContent ?? '',
    })),
  );
  expect(rows.length).toBeGreaterThan(2);
  // Every row, not most of them.
  expect(rows.filter((r) => r.balance === '')).toEqual([]);

  // The newest row is what the masthead says you have.
  await expect(page.locator('#cash')).toHaveText(rows[0].balance);

  // And the column descends by each movement. Rows with no amount moved nothing.
  const money = (s: string) => Number(s.replace(/[^0-9.-]/g, ''));
  for (let i = 0; i < rows.length - 1; i += 1) {
    const amount = rows[i].from.includes('·') ? money(rows[i].from.split('·')[1]) : 0;
    expect(money(rows[i].balance) - money(rows[i + 1].balance)).toBeCloseTo(amount, 2);
  }
});

test('cash says how much it moved, and only when it moves', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  // Nothing to compare against on the first screen.
  await expect(page.locator('#cash-delta')).toBeHidden();

  // Re-renders that do not touch money must not invent one.
  await page.locator('#hire').click();
  await page.locator('#finance-toggle').click();
  await page.locator('#finance-toggle').click();
  await expect(page.locator('#cash-delta')).toBeHidden();

  await page.locator('#next-day').click();
  await expect(page.locator('#cash-delta')).toBeVisible();
  await expect(page.locator('#cash-delta')).toHaveText(/^[+-]£[\d,]+\.\d{2}$/);
});

test('the ending is set as the last edition', async ({ page }) => {
  await serveFeed(page);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  for (let i = 0; i < 8; i += 1) await page.locator('#hire').click();
  await page.locator('#next-day').click();
  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('#over').isVisible()) break;
    await page.locator('#next-day').click();
  }

  await expect(page.locator('#over-mast-name')).toHaveText('News Tycoon');
  // The issue that closed the paper, and it does not claim to be in preparation.
  await expect(page.locator('#over-dateline')).toHaveText(/^No\. \d+ · closed$/);
  await expect(page.locator('#over-dateline')).not.toContainText('in preparation');
});
