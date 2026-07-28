/**
 * Builds `tests/fixtures/pool-36.json`.
 *
 * Committed rather than run in the test, so the fixture is a file someone can
 * read and diff. The statistical assertions in `tests/integration/deal-sweep.test.ts`
 * are properties of this exact input, and a fixture generated on the fly would
 * make a failure there impossible to tell from a fixture that quietly changed.
 *
 * Run: `npx tsx scripts/make-pool-fixture.ts`
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Three episodes in the thin decades, four in the rest. 36 in total. */
const HISTOGRAM: Record<number, number> = {
  1920: 3,
  1930: 3,
  1940: 3,
  1950: 4,
  1960: 4,
  1970: 4,
  1980: 4,
  1990: 4,
  2000: 4,
  2010: 3,
};

/** Offsets inside a decade. A three-episode decade uses the first three. */
const OFFSETS = [0, 3, 6, 9];

const LEVERS = ['access', 'money', 'law'] as const;

const episodes = Object.keys(HISTOGRAM)
  .map(Number)
  .sort((a, b) => a - b)
  .flatMap((decade) =>
    Array.from({ length: HISTOGRAM[decade] }, (_, i) => decade + OFFSETS[i]),
  )
  .map((year, n) => ({
    slug: `fixture-${year}-${n}`,
    title: `Fixture episode ${n}, ${year}`,
    url: `https://example.invalid/blog/fixture-${year}-${n}/`,
    year,
    place: 'Placeholder',
    lever: LEVERS[n % LEVERS.length],
    decision: {
      desk: `A placeholder situation on the desk in ${year}.`,
      voices: [
        {
          who: 'first source',
          says: 'A placeholder account of what happened.',
          trust: 'A placeholder reason to believe it.',
          doubt: 'A placeholder reason not to.',
        },
        {
          who: 'second source',
          says: 'A different placeholder account.',
          trust: 'A placeholder reason to believe this one.',
          doubt: 'A placeholder reason not to.',
        },
      ],
      unverifiable: 'A placeholder thing you cannot settle before the deadline.',
      // The band the two real episodes occupy: 4 to 8, and 3 to 6. Wide enough
      // that the pacing rule has something to reject, narrow enough that most
      // seeds deal.
      print: {
        now: 'A placeholder immediate result of printing.',
        later: 'A placeholder delayed cost of printing.',
        issues: 4 + (n % 5),
      },
      hold: {
        now: 'A placeholder immediate result of holding.',
        later: 'A placeholder delayed cost of holding.',
        issues: 3 + (n % 4),
      },
    },
  }));

const feed = { version: 1, count: episodes.length, episodes };

writeFileSync(
  join(process.cwd(), 'tests/fixtures/pool-36.json'),
  `${JSON.stringify(feed, null, 2)}\n`,
  'utf-8',
);

console.log(`wrote ${episodes.length} episodes across ${Object.keys(HISTOGRAM).length} decades`);
