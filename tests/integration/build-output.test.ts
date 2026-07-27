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
