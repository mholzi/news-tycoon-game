import type { Playable } from './feed';
import { hashSeed, mulberry32, shuffled } from './rng';

/**
 * Turning a pool of episodes into one campaign.
 *
 * The game used to play the whole feed in array order, which was
 * indistinguishable from a campaign while the feed held two episodes. It stops
 * being one as the pool grows: a player should get 12 episodes spanning the
 * century, and a second run should not be the same 12.
 *
 * Two properties are load-bearing and everything here follows from them.
 *
 * **The deal is a pure function of `(pool, seed)`.** Not because purity is
 * tidy, but because a saved campaign has to be rebuildable from what was
 * written down, and a save that stored "whatever `Math.random()` said" could
 * not be.
 *
 * **The bills have to land inside the campaign.** A delay may be up to 40
 * issues while a campaign is decided over 12, so an episode in an early slot
 * can owe something that arrives at issue 41, long after the game is over. The
 * prototype hit the same bug from the other side: with two episodes the archive
 * ran out at issue 2 while the first bill was due at issue 5, so the delayed
 * cost never arrived at all. `pacingHolds` is that lesson as a checked rule.
 */

/** Episodes decided in one campaign. */
export const CAMPAIGN_LENGTH = 12;

/** Issues that may pass after the last episode before everything has settled. */
export const MAX_TAIL = 14;

/** Consecutive issues with nothing settling. Six in a row reads as broken. */
export const MAX_QUIET_RUN = 5;

/** Re-draws before giving up on a pool. */
export const MAX_ATTEMPTS = 32;

/** Distinct decades a pool needs before it can call itself a century. */
export const MIN_DECADES = 4;

/**
 * The levers the economy knows how to charge for.
 *
 * Declared here rather than in `ledger.ts` because `validatePool` is where a
 * pool is judged, and the import would otherwise run backwards.
 */
export const LEVERS = ['access', 'money', 'law'] as const;

/** Mirrors the site's `consequenceSchema` bound, and `assertConsequence`. */
export const MAX_DELAY = 40;

export interface DealtCampaign {
  /** The original seed. Never the per-attempt derivation. */
  seed: string;
  /** Which attempt succeeded, 0-based. Recorded, not needed to re-derive. */
  attempt: number;
  /** True when the pool was too small to deal and was played whole. */
  degraded: boolean;
  episodes: Playable[];
}

export type DealFailure =
  | { code: 'pool-empty' }
  | { code: 'invalid-year'; slug: string; year: number }
  | { code: 'no-satisfying-deal'; attempts: number };

/**
 * Thrown rather than returned, because there is no partial campaign worth
 * playing. Messages are exact: `src/feed.ts` established that these are
 * asserted in tests, and a message that drifts is a test that stops meaning
 * anything.
 */
export class DealError extends Error {
  override readonly name = 'DealError';
  readonly failure: DealFailure;

  constructor(failure: DealFailure) {
    super(messageFor(failure));
    this.failure = failure;
  }
}

function messageFor(failure: DealFailure): string {
  switch (failure.code) {
    case 'pool-empty':
      return 'cannot deal a campaign from an empty pool';
    case 'invalid-year':
      return `episode ${failure.slug} has a year of ${failure.year}, which is not a whole year`;
    case 'no-satisfying-deal':
      return `no deal satisfied the pacing rule in ${failure.attempts} attempts`;
  }
}

export type PoolIssue =
  | { code: 'too-small'; have: number; need: number }
  | { code: 'too-few-decades'; have: number; need: number }
  | { code: 'decade-dominates'; decade: number; have: number; max: number }
  | { code: 'undealable-episode'; slug: string; minDelay: number; max: number }
  | { code: 'invalid-year'; slug: string; year: number }
  | { code: 'unknown-lever'; slug: string; lever: string }
  | { code: 'duplicate-slug'; slug: string; count: number };

export const decadeOf = (year: number): number => Math.floor(year / 10) * 10;

/**
 * Slug order by code point, deliberately not `localeCompare`.
 *
 * Slug order decides which episodes a seed picks, not just how they are
 * displayed: `pickSpread` sorts each bucket before shuffling it. So this
 * comparator is part of the deal's identity, and `localeCompare` is
 * implementation-defined — its collation depends on the runtime's locale and on
 * how much ICU data the engine was built with. Comparing by code point is the
 * same everywhere, forever, which is what "the same seed deals the same
 * campaign" actually requires.
 *
 * (Measured on Node 24 across en, de, sv and cs, real slugs sort identically
 * either way. The point is the guarantee, not an observed break.)
 */
const bySlug = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The largest delay an episode may carry and still be dealable somewhere.
 *
 * The earliest slot is 1, so the soonest that episode can settle is
 * `1 + minDelay`, giving a tail of `minDelay - (CAMPAIGN_LENGTH - 1)`. Holding
 * that at or under `MAX_TAIL` puts the ceiling at 25 for the current constants.
 */
export const MAX_DEALABLE_DELAY = MAX_TAIL + CAMPAIGN_LENGTH - 1;

/**
 * What stops a pool supporting a campaign. Empty means nothing does.
 *
 * Necessary, not sufficient: a pool can come back clean here and still fail to
 * deal, because dealability depends on which episodes land in which slots, and
 * that is a property of the draw rather than of the pool. `deal` throwing
 * `no-satisfying-deal` on a pool this function passed is expected behaviour,
 * not a contradiction.
 */
export function validatePool(pool: readonly Playable[]): PoolIssue[] {
  const issues: PoolIssue[] = [];

  // The one condition `deal` throws on for a feed that `assertPlayFeed` let
  // through, so it belongs in the author-facing list too: `src/feed.ts` checks
  // `year` is a number and nothing more, which admits 1984.5 and -20.
  for (const episode of pool) {
    if (!Number.isInteger(episode.year) || episode.year < 0) {
      issues.push({ code: 'invalid-year', slug: episode.slug, year: episode.year });
    }
  }

  // The economy reads `lever` and nothing validates it. `assertPlayFeed` accepts
  // any non-empty string, so a feed that renames its levers turns every bill
  // into a no-op and the game quietly stops arguing anything. Before the ledger
  // existed this was cosmetic: the value was only printed in the eyebrow.
  for (const episode of pool) {
    if (!(LEVERS as readonly string[]).includes(episode.lever)) {
      issues.push({ code: 'unknown-lever', slug: episode.slug, lever: episode.lever });
    }
  }

  // Nothing else checks this. `assertPlayFeed` requires a slug to be present and
  // non-empty and stops there, so a feed can repeat one. Today that costs
  // nothing — two episodes sharing a slug simply both play. It stops being free
  // the moment a save refers to an episode by slug, which is what the campaign
  // is re-derived from, and by then the bad pool is already published.
  const slugCounts = new Map<string, number>();
  for (const episode of pool) {
    slugCounts.set(episode.slug, (slugCounts.get(episode.slug) ?? 0) + 1);
  }
  for (const [slug, count] of slugCounts) {
    if (count > 1) issues.push({ code: 'duplicate-slug', slug, count });
  }

  if (pool.length < CAMPAIGN_LENGTH) {
    issues.push({ code: 'too-small', have: pool.length, need: CAMPAIGN_LENGTH });
  }

  const counts = new Map<number, number>();
  for (const episode of pool) {
    const decade = decadeOf(episode.year);
    counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }

  if (counts.size < MIN_DECADES) {
    issues.push({ code: 'too-few-decades', have: counts.size, need: MIN_DECADES });
  }

  // Strictly more than a third. For 36 the threshold is 12, and exactly 12 passes:
  // a pool evenly split three ways is not dominated by any of them.
  const max = Math.floor(pool.length / 3);
  for (const decade of [...counts.keys()].sort((a, b) => a - b)) {
    const have = counts.get(decade)!;
    if (have > max) issues.push({ code: 'decade-dominates', decade, have, max });
  }

  for (const episode of pool) {
    const minDelay = Math.min(episode.print.issues, episode.hold.issues);
    if (minDelay > MAX_DEALABLE_DELAY) {
      issues.push({
        code: 'undealable-episode',
        slug: episode.slug,
        minDelay,
        max: MAX_DEALABLE_DELAY,
      });
    }
  }

  return issues;
}

/** Ascending year, ties by ascending slug so the order is total. */
function chronological(episodes: readonly Playable[]): Playable[] {
  return episodes
    .slice()
    .sort((a, b) => (a.year !== b.year ? a.year - b.year : bySlug(a.slug, b.slug)));
}

/**
 * Does every way of playing this campaign settle in time?
 *
 * A campaign of 12 admits 2^12 = 4096 choice sequences. All of them are
 * checked. Sampling the "worst case" would mean guessing which case that is,
 * and the answer depends on how the delays interleave, which is exactly what
 * varies between deals. 49k operations is cheap enough to be exact instead.
 */
function pacingHolds(episodes: readonly Playable[]): boolean {
  const n = episodes.length;
  const printDelay = episodes.map((e) => e.print.issues);
  const holdDelay = episodes.map((e) => e.hold.issues);

  // One slot per reachable issue. A generation counter avoids clearing it 4096
  // times: a slot counts as occupied only if it was stamped this pass.
  const horizon = n + MAX_DELAY + 2;
  const settledAt = new Int32Array(horizon);
  let generation = 0;

  const sequences = 1 << n;
  for (let mask = 0; mask < sequences; mask += 1) {
    generation += 1;
    let latest = 0;

    for (let i = 0; i < n; i += 1) {
      const delay = (mask >> i) & 1 ? holdDelay[i] : printDelay[i];
      const at = i + 1 + delay;
      if (at >= horizon) return false;
      settledAt[at] = generation;
      if (at > latest) latest = at;
    }

    if (latest - n > MAX_TAIL) return false;

    let run = 0;
    for (let issue = n + 1; issue <= latest; issue += 1) {
      if (settledAt[issue] === generation) {
        run = 0;
        continue;
      }
      run += 1;
      if (run > MAX_QUIET_RUN) return false;
    }
  }

  return true;
}

/**
 * One attempt at a spread of 12 across the decades.
 *
 * Round-robin over decade buckets in ascending order. The last pass is usually
 * partial, and taking it in ascending order too would mean the final pick came
 * from the earliest decade in every campaign — which shows up directly as
 * campaigns overlapping more than they should. So a pass that cannot serve
 * every live bucket takes them in a shuffled order instead.
 */
function pickSpread(pool: readonly Playable[], rand: () => number): Playable[] | null {
  const byDecade = new Map<number, Playable[]>();
  for (const episode of pool) {
    const decade = decadeOf(episode.year);
    const bucket = byDecade.get(decade);
    if (bucket) bucket.push(episode);
    else byDecade.set(decade, [episode]);
  }

  const decades = [...byDecade.keys()].sort((a, b) => a - b);

  // Sorted by slug before shuffling: the feed's own ordering must not reach
  // the campaign, or the same seed would deal differently after a re-publish.
  const buckets = decades.map((decade) =>
    shuffled(
      byDecade.get(decade)!.slice().sort((a, b) => bySlug(a.slug, b.slug)),
      rand,
    ),
  );

  const partialOrder = shuffled(
    buckets.map((_, index) => index),
    rand,
  );

  const cursor = new Array<number>(buckets.length).fill(0);
  const picked: Playable[] = [];

  while (picked.length < CAMPAIGN_LENGTH) {
    const live = buckets.map((_, i) => i).filter((i) => cursor[i] < buckets[i].length);
    if (live.length === 0) return null;

    const remaining = CAMPAIGN_LENGTH - picked.length;
    const liveSet = new Set(live);
    const order = remaining < live.length ? partialOrder.filter((i) => liveSet.has(i)) : live;

    for (const i of order) {
      if (picked.length >= CAMPAIGN_LENGTH) break;
      picked.push(buckets[i][cursor[i]]);
      cursor[i] += 1;
    }
  }

  return picked;
}

/**
 * A campaign from a pool, or a reason there isn't one.
 *
 * The degraded path is the reason this can ship before the pool is written.
 * The live feed serves two episodes today; refusing anything under 12 would
 * have taken the published game to its empty state until all 36 existed. Under
 * `CAMPAIGN_LENGTH` the whole pool is played, in date order, with no pacing
 * rule — which is what the game did before this file existed.
 */
export function deal(pool: readonly Playable[], seed: string): DealtCampaign {
  if (pool.length === 0) throw new DealError({ code: 'pool-empty' });

  for (const episode of pool) {
    if (!Number.isInteger(episode.year) || episode.year < 0) {
      throw new DealError({ code: 'invalid-year', slug: episode.slug, year: episode.year });
    }
  }

  if (pool.length < CAMPAIGN_LENGTH) {
    return { seed, attempt: 0, degraded: true, episodes: chronological(pool) };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const rand = mulberry32(hashSeed(`${seed}#${attempt}`));
    const picked = pickSpread(pool, rand);
    if (picked === null) continue;

    const episodes = chronological(picked);
    if (!pacingHolds(episodes)) continue;

    return { seed, attempt, degraded: false, episodes };
  }

  throw new DealError({ code: 'no-satisfying-deal', attempts: MAX_ATTEMPTS });
}

/**
 * The `?seed=` override, or null when the query string does not ask for one.
 *
 * Exported because two callers need the same answer and must not disagree
 * about it: `newSeed` treats it as the first choice, and `boot()` needs to know
 * whether a seed was *asked for*, since a requested campaign is never retried
 * behind the player's back.
 */
export function seedFromSearch(search: string): string | null {
  const seed = new URLSearchParams(search).get('seed');
  return seed !== null && seed.length > 0 ? seed : null;
}

/**
 * The seed for a fresh campaign.
 *
 * `?seed=` wins when present. It exists for the end-to-end tests, which need a
 * campaign they can predict, and it is deliberately not hidden behind a
 * dev-only flag: the build Playwright drives is the production build, and a
 * shareable campaign URL is worth having anyway.
 *
 * No `Math.random()` fallback. If neither crypto entry point is there, the
 * campaign would stop being reproducible without anyone noticing, and a loud
 * failure is the better trade.
 */
export function newSeed(search = ''): string {
  const fromQuery = seedFromSearch(search);
  if (fromQuery !== null) return fromQuery;

  if (typeof crypto === 'undefined') {
    throw new Error('cannot generate a campaign seed: no crypto available');
  }

  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
