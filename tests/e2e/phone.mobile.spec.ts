import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, type PlayFeed } from '../../src/feed';

/**
 * The paper on a phone.
 *
 * This file exists because of what rendering the layout at 375px showed that
 * describing it had not: masthead, account and front page together fill a
 * screen, so "Print it" was two scrolls away every single day. The fix is a
 * pinned account and a pinned print bar. These tests are what stops that
 * regressing into a page you have to scroll twice to play.
 *
 * Runs only in the `mobile` project. `playwright.config.ts` keeps the two
 * projects disjoint by `testMatch`, so the 28 desktop tests are not re-run here
 * against a phone contract they were never written for.
 */

const FEED_URL = 'https://news-tycoon.vercel.app/play.json';
const FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/pool-36.json'), 'utf-8'),
) as PlayFeed;

async function openGame(page: Page): Promise<void> {
  await page.route(FEED_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(assertPlayFeed(FIXTURE)),
    }),
  );
  await page.goto('/');
  // The archive is fetched, so nothing is on screen at literal first paint.
  // Everything below means "once the game is up", not "before it loads".
  await expect(page.locator('#game')).toBeVisible();
}

test('the account and Print it are both on screen without scrolling', async ({ page }) => {
  await openGame(page);

  // The whole point. Before the pinned bars these sat above and below a full
  // screen of masthead and front page.
  await expect(page.locator('#cash')).toBeInViewport();
  await expect(page.locator('#next-day')).toBeInViewport();
});

test('the print bar stays put once the page is scrolled', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  // Sticky, not fixed: it must still be there at the bottom of the scroll, and
  // it must not have floated over the last line on the way.
  await expect(page.locator('#next-day')).toBeInViewport();
  await expect(page.locator('#cash')).toBeInViewport();
});

test('every control a thumb can reach is at least 44px tall', async ({ page }) => {
  await openGame(page);

  const buttons = page.locator('button:visible');
  const count = await buttons.count();
  // Guard: an empty list would pass this test by checking nothing.
  expect(count).toBeGreaterThan(3);

  const short: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const box = await button.boundingBox();
    const label = (await button.textContent())?.trim().slice(0, 40) ?? '(no label)';
    if (box && box.height < 44) short.push(`${label} — ${Math.round(box.height)}px`);
  }
  expect(short).toEqual([]);
});

/*
 * "Sentence" needs a definition, and the honest one excludes three things.
 *
 * The floor is for prose a player reads. It is not for `.visually-hidden`
 * labels, which no sighted reader sees at all and which `offsetParent` does not
 * report as hidden because clipping leaves them in the layout. And it is not
 * for the dateline or the fold: both are mono, uppercase and letter-spaced,
 * which is what a dateline and a fold rule are in every newspaper ever set.
 * Pushing them to 16px would not make them more legible, it would make the
 * masthead wider than a 320px screen.
 *
 * Stated rather than quietly filtered, because a test that narrows its own
 * population until it passes is worth nothing.
 */
test('every sentence is at least 16px', async ({ page }) => {
  await openGame(page);

  const small = await page.evaluate(() => {
    const isLabel = (el: Element) =>
      el.classList.contains('visually-hidden') || el.id === 'dateline' || el.id === 'fold';
    return [...document.querySelectorAll('p, li')]
      .filter((el) => (el as HTMLElement).offsetParent !== null && !isLabel(el))
      .map((el) => ({
        text: (el.textContent ?? '').trim().slice(0, 40),
        size: Number.parseFloat(getComputedStyle(el).fontSize),
      }))
      .filter((entry) => entry.size < 16)
      .map((entry) => `${entry.text} — ${entry.size}px`);
  });
  expect(small).toEqual([]);
});

for (const width of [320, 375]) {
  test(`the page does not scroll sideways at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await openGame(page);

    // Measured with something in tomorrow's issue: an empty front page has no
    // long headline in it and would pass this vacuously.
    await page.locator('#available .voice.publish').first().click();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}

/*
 * The masthead is the first thing on the screen.
 *
 * It was not. An introduction written for the loading state stayed on the page
 * after the game arrived and took the top half of the first screen, so a player
 * opened a newspaper and read an essay about the newspaper. Screenshots found
 * it; no assertion did, because every element it should have caught was
 * technically in the viewport.
 *
 * This is the guard. Not "the text is gone" — that would pass the moment
 * someone reworded it — but "the masthead is what you see first", which is the
 * property that actually matters.
 */
test('the paper opens on the masthead, not on an explanation', async ({ page }) => {
  await openGame(page);

  await expect(page.locator('#mast-name')).toBeInViewport();
  await expect(page.locator('#dateline')).toBeInViewport();

  // And it is near the top rather than merely on screen: nothing taller than a
  // small margin sits above it.
  const top = await page.locator('#mast').evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeLessThan(120);
});
