import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The built game must not carry the answer.
 *
 * `/play.json` already strips `outcome`, so this cannot fail through the feed.
 * It can fail through the game's own words: the page the code came from
 * described the site's export in prose, and that sentence contained the one
 * occurrence of the word in the whole file. It was dropped during the move,
 * and this is what keeps it dropped.
 *
 * Runs against `dist/`, so `npm run build` has to have happened. The CI order
 * (`build` then `test`) guarantees it; locally, `npm run build` first.
 */

const DIST = join(process.cwd(), 'dist');

function filesUnder(dir: string, extensions: string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...filesUnder(path, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      found.push(path);
    }
  }
  return found;
}

describe('built output', () => {
  it('emits an entry point and its assets', () => {
    expect(filesUnder(DIST, ['.html']).length).toBeGreaterThan(0);
    expect(filesUnder(DIST, ['.js']).length).toBeGreaterThan(0);
    expect(filesUnder(DIST, ['.css']).length).toBeGreaterThan(0);
  });

  it('never publishes the answer as data', () => {
    for (const file of filesUnder(DIST, ['.html', '.js', '.css'])) {
      expect(readFileSync(file, 'utf-8'), file).not.toContain('"outcome"');
    }
  });

  it('does not even mention the answer in the script', () => {
    for (const file of filesUnder(DIST, ['.js'])) {
      expect(readFileSync(file, 'utf-8').toLowerCase(), file).not.toContain('outcome');
    }
  });

  it('emits no sourcemaps, which would smuggle the source text back in', () => {
    expect(filesUnder(DIST, ['.map'])).toEqual([]);
  });
});

/*
 * The id contract, asserted against what shipped.
 *
 * `render()` in `main.ts` addresses every one of these by id and writes into it.
 * A dropped id is not a visual regression, it is a null dereference on first
 * paint: `#game` never un-hides and the page reads as "the game did not load".
 * The restructure that made the page a broadsheet moved most of these, so this
 * is the check that the move did not lose one.
 *
 * The full list, not a sample. A sample would pass while the one id nobody
 * thought about went missing.
 */
describe('the broadsheet id contract', () => {
  const ids = [
    'paper',
    'mast',
    'mast-name',
    'dateline',
    'account',
    'cash',
    'copies',
    'price',
    'reporters',
    'day',
    'step-tomorrow',
    'tomorrow',
    'tomorrow-empty',
    'tomorrow-slots',
    'fold',
    'desk',
    'desk-eyebrow',
    'step-available',
    'available',
    'available-empty',
    'step-sources',
    'sources',
    'step-staff',
    'hire',
    'fire',
    'step-buy',
    'wire',
    'buy-stringer',
    'planned',
    'clear-plan',
    'book',
    'ledger',
    'ledger-empty',
    'printbar',
    'next-day',
    'over',
    'over-heading',
    'over-text',
    'again',
  ];

  it('ships every id render() writes into', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf-8');
    const missing = ids.filter((id) => !html.includes(`id="${id}"`));
    expect(missing).toEqual([]);
  });

  it('keeps the masthead and the fold in the served markup', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf-8');
    // Static markup, so the integration layer can see them. The two strings
    // inside the masthead are written at runtime and are asserted in the e2e
    // suite instead — this file reads files, it does not run a browser.
    expect(html).toContain('<header id="mast">');
    expect(html).toContain('<p id="fold">The desk</p>');
  });

  it('keeps exactly one h1, and it is the masthead', () => {
    // Comments stripped first. The file explains in prose that the old heading
    // is gone, and that sentence names the tag — counting raw text found two
    // `<h1>` and failed on a page that has exactly one. A test that reads
    // markup has to read markup, not the commentary around it.
    const html = readFileSync(join(DIST, 'index.html'), 'utf-8').replace(/<!--[\s\S]*?-->/g, '');
    expect(html.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
    expect(html).toContain('<h1 id="mast-name">');
  });
});
