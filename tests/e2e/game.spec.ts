import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Everything here stubs the feed except the contract test at the bottom.
 *
 * A test that hits production is a test that fails when production is down,
 * for reasons that have nothing to do with the change under review. The one
 * that does hit it is tagged and allowed to fail the step without failing the
 * build, because what it watches for is real: the site quietly changing the
 * shape the game depends on.
 */

const FEED_URL = 'https://news-tycoon.vercel.app/play.json';

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/play.json'), 'utf-8'),
) as {
  version: number;
  count: number;
  episodes: {
    slug: string;
    place: string;
    year: number;
    decision: {
      desk: string;
      voices: { who: string }[];
      print: { now: string; later: string; issues: number };
      hold: { later: string; issues: number };
    };
  }[];
};

async function serveFeed(page: Page, body: unknown): Promise<void> {
  await page.route(FEED_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(body),
    }),
  );
}

test('the game fetches its archive over the network', async ({ page }) => {
  let called = false;
  await page.route(FEED_URL, (route) => {
    called = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(fixture),
    });
  });

  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  // The point of the whole issue: the data arrives over the wire rather than
  // being compiled into the page.
  expect(called).toBe(true);
});

test('the decision is flattened, so the desk actually has something on it', async ({ page }) => {
  await serveFeed(page, fixture);
  await page.goto('/');

  // The feed nests `decision`; the game reads `desk` at the top level. Remove
  // the spread in `toPlayable` and this is the test that goes red — the page
  // still builds and still renders, with every field empty.
  await expect(page.locator('#desk')).toHaveText(fixture.episodes[0].decision.desk);
});

test('a full run: two episodes printed, and both bills land in the record', async ({ page }) => {
  await serveFeed(page, fixture);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  // Print both. Episode one is played at issue 1 and its bill falls due at
  // issue 1 + print.issues; episode two at issue 2, due at 2 + print.issues.
  for (let i = 0; i < fixture.episodes.length; i += 1) {
    await expect(page.locator('#issue-no')).toHaveText(`Issue ${i + 1}`);
    await page.locator('#voices button').first().click();
    await page.locator('#do-print').click();
    await expect(page.locator('#result-now')).toHaveText(fixture.episodes[i].decision.print.now);
    await page.locator('#next').click();
  }

  // The archive is out of episodes but the paper keeps coming out. Click
  // through the quiet issues until the last bill has arrived.
  const lastDue = Math.max(
    ...fixture.episodes.map((e, i) => i + 1 + e.decision.print.issues),
  );
  for (let guard = 0; guard < lastDue + 5; guard += 1) {
    if (await page.locator('#done').isVisible()) break;
    await page.locator('#quiet-next').click();
  }

  await expect(page.locator('#done')).toBeVisible();
  await expect(page.locator('#printed')).toHaveText(String(fixture.episodes.length));
  await expect(page.locator('#record li')).toHaveCount(fixture.episodes.length);
  await expect(page.locator('#record-empty')).toBeHidden();
});

test('no consequence is shown before it is chosen, and none lands in its own issue', async ({
  page,
}) => {
  // The whole argument in one test, and the reason it is worth this much code.
  //
  // Both futures are in the payload, because a static feed has nowhere else to
  // put them. Asserting that the panels are hidden is not enough: the text
  // could leak anywhere on the page and every panel assertion would still
  // pass. So this reads the rendered body and checks the strings themselves,
  // then runs the campaign out and checks they do eventually arrive. A version
  // of this guarded the site page before the move; it is the strongest thing
  // that came across and it deserved to come across intact.
  await serveFeed(page, fixture);
  await page.goto('/');
  await expect(page.locator('#game')).toBeVisible();

  const laters = fixture.episodes.flatMap((e) => [e.decision.print.later, e.decision.hold.later]);
  expect(laters.length).toBeGreaterThan(0);

  const bodyHasAnyLater = async () => {
    const text = await page.locator('body').innerText();
    return laters.some((later) => text.includes(later));
  };

  // Nothing on arrival.
  expect(await bodyHasAnyLater()).toBe(false);
  await expect(page.locator('#step-print')).toBeHidden();
  await expect(page.locator('#step-result')).toBeHidden();

  // Nothing after choosing a voice, and nothing in the issue you decide in.
  await page.locator('#voices button').first().click();
  await expect(page.locator('#step-print')).toBeVisible();
  expect(await bodyHasAnyLater()).toBe(false);
  await page.locator('#do-print').click();
  await expect(page.locator('#step-result')).toBeVisible();
  expect(await bodyHasAnyLater()).toBe(false);

  // Run the campaign out, and confirm the bills do arrive in the end.
  for (let guard = 0; guard < 60; guard += 1) {
    if (await page.locator('#done').isVisible()) break;
    if (await page.locator('#step-print').isVisible()) {
      await page.locator('#do-hold').click();
    } else if (await page.locator('#next').isVisible()) {
      await page.locator('#next').click();
    } else if (await page.locator('#quiet-next').isVisible()) {
      await page.locator('#quiet-next').click();
    } else {
      await page.locator('#voices button').first().click();
    }
  }

  await expect(page.locator('#done')).toBeVisible();
  await expect(page.locator('#record li')).not.toHaveCount(0);
  expect(await bodyHasAnyLater()).toBe(true);
});

test('the second account never shows a total', async ({ page }) => {
  await serveFeed(page, fixture);
  await page.goto('/');

  // A number there would be a price, and a price is the one thing the mechanic
  // says does not exist. This is the assertion that would fail if someone
  // "improved" it by scoring the record.
  const other = page.locator('.ledger.other');
  await expect(other).toBeVisible();
  await expect(other.locator('.ledger-figure')).toHaveCount(0);
});

test('an empty archive is a state, not a failure', async ({ page }) => {
  await serveFeed(page, { version: 1, count: 0, episodes: [] });
  await page.goto('/');

  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#empty')).toContainText('Nothing to play yet.');
  await expect(page.locator('#game')).toBeHidden();
  await expect(page.locator('#error')).toBeHidden();
});

for (const failure of ['500', 'aborted', 'malformed'] as const) {
  test(`a ${failure} feed says so on the page instead of rendering nothing`, async ({ page }) => {
    await page.route(FEED_URL, (route) => {
      if (failure === '500') return route.fulfill({ status: 500, body: 'nope' });
      if (failure === 'aborted') return route.abort('failed');
      return route.fulfill({ status: 200, contentType: 'application/json', body: 'not json' });
    });

    await page.goto('/');
    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error')).toContainText('The archive could not be loaded.');
    await expect(page.locator('#game')).toBeHidden();
    await expect(page.locator('#empty')).toBeHidden();
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the copied tokens resolve in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await serveFeed(page, fixture);
    await page.goto('/');

    const token = (name: string) =>
      page.evaluate(
        (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
        name,
      );

    // Custom properties rather than element colours: which element uses which
    // token is a styling detail this move must not depend on, but the values
    // themselves are a copy of the site's and a drift should be loud.
    const expected =
      scheme === 'light'
        ? { '--ink': '#17191e', '--raised': '#ffffff', '--rule': '#e3e1dc', '--accent': '#8c2f39', '--ground': '#fbfaf8' }
        : { '--ink': '#e9e7e3', '--raised': '#191b20', '--rule': '#2c2f36', '--accent': '#d98089', '--ground': '#121317' };

    for (const [name, value] of Object.entries(expected)) {
      expect(await token(name), name).toBe(value);
    }
    expect(await token('--mono')).toContain('ui-monospace');
  });
}

test('@network the live feed still honours the contract', async ({ request }) => {
  test.slow();
  const response = await request.get(FEED_URL, { timeout: 30_000 });
  expect(response.status()).toBe(200);

  const body = (await response.json()) as { version: number; count: number; episodes: unknown[] };
  expect(body.version).toBe(1);
  // Deliberately not a fixed count: the archive grows, and that is not a break.
  expect(body.count).toBe(body.episodes.length);
});
