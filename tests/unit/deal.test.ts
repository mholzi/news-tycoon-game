import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type Playable, type PlayFeed } from '../../src/feed';
import {
  CAMPAIGN_LENGTH,
  deal,
  DealError,
  MAX_DEALABLE_DELAY,
  MAX_QUIET_RUN,
  MAX_TAIL,
  MIN_DECADES,
  newSeed,
  validatePool,
} from '../../src/deal';

const pool36 = (): Playable[] =>
  assertPlayFeed(
    JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/pool-36.json'), 'utf-8')) as PlayFeed,
  ).episodes.map(toPlayable);

const realPool = (): Playable[] =>
  assertPlayFeed(
    JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/play.json'), 'utf-8')) as PlayFeed,
  ).episodes.map(toPlayable);

/**
 * A synthetic episode. Only the fields the dealer reads are meaningful; the
 * prose is there so the value is a real `Playable` rather than a cast.
 */
function episode(slug: string, year: number, print: number, hold: number): Playable {
  return {
    slug,
    title: slug,
    year,
    place: 'Nowhere',
    lever: 'access',
    desk: 'A situation.',
    voices: [
      { who: 'a', says: 'x', trust: 'y', doubt: 'z' },
      { who: 'b', says: 'x', trust: 'y', doubt: 'z' },
    ],
    unverifiable: 'Something.',
    print: { now: 'now', later: 'later', issues: print },
    hold: { now: 'now', later: 'later', issues: hold },
  };
}

/** `count` episodes spread one per decade from 1920, with the given delays. */
const spread = (count: number, print = 5, hold = 4): Playable[] =>
  Array.from({ length: count }, (_, i) => episode(`ep-${i}`, 1920 + i * 10, print, hold));

describe('validatePool', () => {
  it('passes the 36-episode fixture', () => {
    expect(validatePool(pool36())).toEqual([]);
  });

  it('reports a pool too small to fill a campaign', () => {
    expect(validatePool(spread(11))).toContainEqual({
      code: 'too-small',
      have: 11,
      need: CAMPAIGN_LENGTH,
    });
  });

  it('reports a pool that does not span enough decades', () => {
    const cramped = Array.from({ length: 12 }, (_, i) => episode(`ep-${i}`, 1961 + (i % 3), 5, 4));
    expect(validatePool(cramped)).toContainEqual({
      code: 'too-few-decades',
      have: 1,
      need: MIN_DECADES,
    });
  });

  it('reports a decade holding more than a third of the pool', () => {
    // 13 of 36 in the 1960s: one over the threshold.
    const lumpy = [
      ...Array.from({ length: 13 }, (_, i) => episode(`sixties-${i}`, 1960 + (i % 10), 5, 4)),
      ...Array.from({ length: 23 }, (_, i) => episode(`rest-${i}`, 1920 + (i % 4) * 10, 5, 4)),
    ];
    expect(validatePool(lumpy)).toContainEqual({
      code: 'decade-dominates',
      decade: 1960,
      have: 13,
      max: 12,
    });
  });

  it('does not report a decade holding exactly a third', () => {
    const even = [
      ...Array.from({ length: 12 }, (_, i) => episode(`a-${i}`, 1960 + (i % 10), 5, 4)),
      ...Array.from({ length: 12 }, (_, i) => episode(`b-${i}`, 1970 + (i % 10), 5, 4)),
      ...Array.from({ length: 12 }, (_, i) => episode(`c-${i}`, 1980 + (i % 10), 5, 4)),
    ];
    expect(validatePool(even).filter((i) => i.code === 'decade-dominates')).toEqual([]);
  });

  it('reports an episode no slot could ever pay for', () => {
    const pool = [...spread(11), episode('too-slow', 2020, 30, 40)];
    expect(validatePool(pool)).toContainEqual({
      code: 'undealable-episode',
      slug: 'too-slow',
      minDelay: 30,
      max: MAX_DEALABLE_DELAY,
    });
  });

  /**
   * The feed only checks that `year` is a number, so a fractional or negative
   * one reaches the dealer, which throws on it. Reporting it here too means the
   * author-facing list covers every way a pool can fail to produce a campaign.
   */
  it('reports a year the feed let through but the dealer will refuse', () => {
    const pool = spread(12);
    pool[3] = episode('fractional', 1984.5, 5, 4);
    pool[7] = episode('negative', -20, 5, 4);

    expect(validatePool(pool)).toEqual([
      { code: 'invalid-year', slug: 'fractional', year: 1984.5 },
      { code: 'invalid-year', slug: 'negative', year: -20 },
    ]);
  });

  /**
   * The feed requires a slug to exist and stops there. Two episodes can carry
   * the same one, and a save that names an episode by slug would then point at
   * two of them.
   */
  it('reports a slug used by more than one episode', () => {
    const pool = spread(12);
    pool[4] = episode('twice', 1970, 5, 4);
    pool[9] = episode('twice', 2010, 5, 4);

    expect(validatePool(pool)).toEqual([{ code: 'duplicate-slug', slug: 'twice', count: 2 }]);
  });

  it('says nothing about slugs in a pool where every one is distinct', () => {
    expect(validatePool(pool36()).filter((i) => i.code === 'duplicate-slug')).toEqual([]);
  });

  it('says nothing about years in a pool whose years are all whole', () => {
    expect(validatePool(pool36()).filter((i) => i.code === 'invalid-year')).toEqual([]);
  });

  it('leaves an episode at exactly the dealable ceiling alone', () => {
    const pool = [...spread(11), episode('just-inside', 2020, MAX_DEALABLE_DELAY, 40)];
    expect(validatePool(pool).filter((i) => i.code === 'undealable-episode')).toEqual([]);
  });
});

describe('deal', () => {
  it('returns exactly a campaign from the 36-episode pool', () => {
    const campaign = deal(pool36(), 'deal-seed-0');
    expect(campaign.episodes).toHaveLength(CAMPAIGN_LENGTH);
    expect(campaign.degraded).toBe(false);
    expect(campaign.seed).toBe('deal-seed-0');
    expect(campaign.attempt).toBeGreaterThanOrEqual(0);
  });

  it('is identical on repeat calls with the same seed', () => {
    const pool = pool36();
    const first = deal(pool, 'repeat');
    for (let i = 0; i < 50; i += 1) {
      expect(deal(pool, 'repeat')).toEqual(first);
    }
  });

  it('carries the original seed, not the per-attempt derivation', () => {
    const campaign = deal(pool36(), 'deal-seed-7');
    expect(campaign.seed).toBe('deal-seed-7');
    expect(deal(pool36(), campaign.seed).episodes).toEqual(campaign.episodes);
  });

  it('ignores the order the feed happened to arrive in', () => {
    const pool = pool36();
    const reversed = pool.slice().reverse();
    expect(deal(reversed, 'order').episodes).toEqual(deal(pool, 'order').episodes);
  });

  it('deals in ascending year', () => {
    for (let n = 0; n < 25; n += 1) {
      const years = deal(pool36(), `chrono-${n}`).episodes.map((e) => e.year);
      expect(years).toEqual(years.slice().sort((a, b) => a - b));
    }
  });

  /**
   * By code point, not by locale. The bucket sort inside `pickSpread` decides
   * which episodes a seed picks, so the comparator is part of the deal's
   * identity, and `localeCompare` is implementation-defined. These four strings
   * are the case where the two orders visibly disagree.
   */
  it('orders slugs by code point, which no runtime locale can change', () => {
    const pool = [
      episode('AB', 1950, 5, 4),
      episode('ab', 1950, 5, 4),
      episode('aB', 1950, 5, 4),
      episode('a-b', 1950, 5, 4),
    ];
    const sorted = deal(pool, 'tie').episodes.map((e) => e.slug);

    expect(sorted).toEqual(['AB', 'a-b', 'aB', 'ab']);
    // The order localeCompare would have produced, kept here so the difference
    // is a documented fact rather than a claim in a comment.
    expect(sorted).not.toEqual(['a-b', 'ab', 'aB', 'AB']);
  });

  it('breaks a tie on the same year by slug, so the order is total', () => {
    const pool = [
      ...spread(10),
      episode('zulu', 2020, 5, 4),
      episode('alpha', 2020, 5, 4),
    ];
    const episodes = deal(pool, 'ties').episodes;
    const sameYear = episodes.filter((e) => e.year === 2020).map((e) => e.slug);
    expect(sameYear).toEqual(['alpha', 'zulu']);
  });

  it('spans the decades rather than clustering', () => {
    for (let n = 0; n < 25; n += 1) {
      const decades = new Set(
        deal(pool36(), `spread-${n}`).episodes.map((e) => Math.floor(e.year / 10) * 10),
      );
      expect(decades.size).toBeGreaterThanOrEqual(MIN_DECADES);
    }
  });

  it('settles every bill in time, whatever the player chooses', () => {
    for (let n = 0; n < 25; n += 1) {
      const episodes = deal(pool36(), `pacing-${n}`).episodes;
      const n0 = episodes.length;

      for (let mask = 0; mask < 1 << n0; mask += 1) {
        const settlements = episodes.map((e, i) =>
          i + 1 + ((mask >> i) & 1 ? e.hold.issues : e.print.issues),
        );
        const latest = Math.max(...settlements);
        expect(latest - n0).toBeLessThanOrEqual(MAX_TAIL);

        const occupied = new Set(settlements);
        let run = 0;
        for (let issue = n0 + 1; issue <= latest; issue += 1) {
          run = occupied.has(issue) ? 0 : run + 1;
          expect(run).toBeLessThanOrEqual(MAX_QUIET_RUN);
        }
      }
    }
  });
});

describe('deal, when the pool cannot support a campaign', () => {
  it('refuses an empty pool by name', () => {
    expect(() => deal([], 'x')).toThrow(DealError);
    try {
      deal([], 'x');
    } catch (error) {
      expect((error as DealError).failure).toEqual({ code: 'pool-empty' });
      expect((error as DealError).message).toBe('cannot deal a campaign from an empty pool');
    }
  });

  it('refuses a year that is not a whole year', () => {
    const pool = [...spread(11), episode('fractional', 1955.5, 5, 4)];
    try {
      deal(pool, 'x');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DealError).failure).toEqual({
        code: 'invalid-year',
        slug: 'fractional',
        year: 1955.5,
      });
    }
  });

  it('gives up by name when no draw can satisfy the pacing rule', () => {
    // Every episode owes 25 issues, which is legal in the pool and unpayable
    // inside a 12-issue campaign wherever it lands.
    const stubborn = Array.from({ length: 20 }, (_, i) =>
      episode(`slow-${i}`, 1920 + i * 5, 25, 25),
    );
    expect(validatePool(stubborn).filter((i) => i.code === 'undealable-episode')).toEqual([]);
    try {
      deal(stubborn, 'stubborn');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as DealError).failure).toEqual({ code: 'no-satisfying-deal', attempts: 32 });
      expect((error as DealError).message).toBe(
        'no deal satisfied the pacing rule in 32 attempts',
      );
    }
  });
});

describe('deal, on a pool too small to draw from', () => {
  it('plays the two real episodes whole, which is what the live feed serves', () => {
    const campaign = deal(realPool(), 'live');
    expect(campaign.degraded).toBe(true);
    expect(campaign.episodes).toHaveLength(2);
    expect(campaign.episodes.map((e) => e.year)).toEqual([1984, 2015]);
  });

  it('plays a single episode', () => {
    const campaign = deal(spread(1), 'one');
    expect(campaign.degraded).toBe(true);
    expect(campaign.episodes).toHaveLength(1);
  });

  it('plays eleven whole, and twelve is where dealing starts', () => {
    expect(deal(spread(11), 'eleven').degraded).toBe(true);
    expect(deal(spread(12), 'twelve').degraded).toBe(false);
  });

  it('applies no pacing rule, so a slow episode still plays', () => {
    const campaign = deal([episode('slow', 1930, 40, 40)], 'slow');
    expect(campaign.degraded).toBe(true);
    expect(campaign.episodes).toHaveLength(1);
  });
});

describe('newSeed', () => {
  it('takes the seed from the query string when there is one', () => {
    expect(newSeed('?seed=abc123')).toBe('abc123');
    expect(newSeed('?other=1&seed=xyz')).toBe('xyz');
  });

  it('generates one when the query string has none or an empty one', () => {
    expect(newSeed('?seed=')).not.toBe('');
    expect(newSeed('')).toMatch(/^[0-9a-f-]{32,36}$/);
  });

  it('generates a different seed each time', () => {
    expect(new Set([newSeed(), newSeed(), newSeed()]).size).toBe(3);
  });

  /**
   * `randomUUID` needs a secure context, so a page served over plain HTTP has
   * `crypto` but not that method. The fallback is the reason the game still
   * deals there instead of throwing on load.
   */
  it('falls back to random bytes when randomUUID is missing', () => {
    const real = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: real.getRandomValues.bind(real) },
    });
    try {
      const seed = newSeed();
      expect(seed).toMatch(/^[0-9a-f]{32}$/);
      expect(newSeed()).not.toBe(seed);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real });
    }
  });

  /**
   * Loud rather than quiet. Falling back to `Math.random()` here would leave a
   * campaign that plays but can never be rebuilt from its seed, and nothing on
   * screen would say so.
   */
  it('refuses to invent a seed when there is no crypto at all', () => {
    const real = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      expect(() => newSeed()).toThrow('cannot generate a campaign seed: no crypto available');
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real });
    }
  });
});
