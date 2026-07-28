import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The dealer must stay a pure function of its arguments.
 *
 * A single `Math.random()` or `Date.now()` in either file would make a saved
 * campaign unrebuildable, and it would do it quietly: everything would still
 * play, just never the same way twice. This reads the two source files rather
 * than the bundle, because a match in `dist/` cannot be attributed to a module
 * and would go red for something an unrelated file did.
 */

const FORBIDDEN = [
  { pattern: /\bMath\.random\s*\(/, why: 'Math.random' },
  { pattern: /\bDate\.now\s*\(/, why: 'Date.now' },
  { pattern: /\bnew Date\s*\(/, why: 'new Date' },
  { pattern: /\bperformance\.now\s*\(/, why: 'performance.now' },
];

/**
 * Comments come out first.
 *
 * Both files explain at length why they do not call `Math.random()`, and a
 * plain grep reads that explanation as the violation it warns about. Naming the
 * forbidden thing in prose is how the constraint stays understood, so the
 * scanner is what has to give way.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe.each(['src/deal.ts', 'src/rng.ts'])('%s', (file) => {
  const code = withoutComments(readFileSync(join(process.cwd(), file), 'utf-8'));

  it.each(FORBIDDEN)('has no $why in it', ({ pattern }) => {
    expect(code).not.toMatch(pattern);
  });

  it('still sees a violation that is really there', () => {
    expect(withoutComments('// Math.random()\nconst x = Math.random();')).toMatch(
      /\bMath\.random\s*\(/,
    );
  });

  it('does not see one that is only described', () => {
    expect(withoutComments('// never call Math.random() here\nconst x = 1;')).not.toMatch(
      /\bMath\.random\s*\(/,
    );
  });
});
