import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type Playable, type PlayFeed } from '../../src/feed';
import { CAMPAIGN_LENGTH, deal, DealError, validatePool } from '../../src/deal';

/**
 * The statistical claims, over a fixed seed list.
 *
 * The seeds are `deal-seed-0` to `deal-seed-999` and they are generated here,
 * never drawn. A suite whose whole subject is determinism cannot itself flake
 * on a rerun, and a random seed list would do exactly that: green today, red
 * tomorrow, with no commit in between to blame.
 *
 * These assertions are properties of `tests/fixtures/pool-36.json` as much as
 * of the algorithm. Change the fixture and the numbers move.
 */

const SEEDS = Array.from({ length: 1000 }, (_, n) => `deal-seed-${n}`);

const pool: Playable[] = assertPlayFeed(
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/pool-36.json'), 'utf-8')) as PlayFeed,
).episodes.map(toPlayable);

interface Outcome {
  seed: string;
  slugs: string[] | null;
}

const outcomes: Outcome[] = SEEDS.map((seed) => {
  try {
    const campaign = deal(pool, seed);
    return { seed, slugs: campaign.episodes.map((e) => e.slug) };
  } catch (error) {
    if (error instanceof DealError && error.failure.code === 'no-satisfying-deal') {
      return { seed, slugs: null };
    }
    throw error;
  }
});

const dealt = outcomes.filter((o): o is Outcome & { slugs: string[] } => o.slugs !== null);

describe('the 36-episode pool over 1000 fixed seeds', () => {
  it('is a pool with nothing wrong with it', () => {
    expect(validatePool(pool)).toEqual([]);
    expect(pool).toHaveLength(36);
  });

  it('deals for at least 900 of them, and the current fixture manages all 1000', () => {
    expect(dealt.length).toBeGreaterThanOrEqual(900);
    // Recorded rather than merely bounded: if a change drops this from 1000 the
    // diff should have to say so out loud.
    expect(dealt.length).toBe(1000);
  });

  it('never returns a campaign of the wrong size', () => {
    for (const outcome of dealt) {
      expect(outcome.slugs).toHaveLength(CAMPAIGN_LENGTH);
    }
  });

  it('never repeats an episode inside one campaign', () => {
    for (const outcome of dealt) {
      expect(new Set(outcome.slugs).size).toBe(CAMPAIGN_LENGTH);
    }
  });

  /**
   * Consecutive pairs, skipping any pair where a seed did not deal.
   *
   * Skipped rather than counted as a failure: a seed that legitimately threw
   * says nothing about how much two campaigns overlap, and folding it in would
   * make this assertion measure two things at once.
   */
  it('gives two players mostly different campaigns', () => {
    let pairs = 0;
    let within = 0;

    for (let i = 0; i + 1 < outcomes.length; i += 1) {
      const a = outcomes[i].slugs;
      const b = outcomes[i + 1].slugs;
      if (a === null || b === null) continue;

      pairs += 1;
      const seen = new Set(a);
      if (b.filter((slug) => seen.has(slug)).length <= 8) within += 1;
    }

    expect(pairs).toBeGreaterThan(950);
    expect(within / pairs).toBeGreaterThanOrEqual(0.95);
  });

  it('draws on the whole pool rather than favouring a few episodes', () => {
    const used = new Set(dealt.flatMap((o) => o.slugs));
    expect(used.size).toBe(pool.length);
  });
});
