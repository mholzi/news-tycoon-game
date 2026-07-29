/**
 * Seven ways to fill a paper.
 *
 * One story used to arrive one way: cultivate a source for four reporter-days,
 * then tie a reporter up for six more. Everything else was an ordinary day with
 * a button on it.
 *
 * These six are not variations on that. **Each spends a different resource** —
 * a subscription, independence, cash, a gamble, credibility, or almost nothing
 * — and a source that does not take from a different pocket is a reskin of one
 * that already exists.
 *
 * **Only investigations need the archive.** Everything here is generated and
 * deliberately forgettable, which is what stops the game's appetite for content
 * being limited by how fast real cases can be researched. Thirty-six episodes
 * are the spine; the rest is chaff, which is also what a real paper is.
 *
 * **No generated story names a real person or cites anything.** Headlines come
 * from `HEADLINE_WORDS` and nowhere else. The archive is the only thing in this
 * game that asserts anything about the world, and it does that with sources.
 * This is not a balance decision and is not to be traded for texture.
 */

import type { Playable } from './feed';

export type StorySource =
  | 'investigation'
  | 'wire'
  | 'planted'
  | 'stringer'
  | 'tip'
  | 'advertorial'
  | 'follow';

export interface Story {
  /** Episode slug for an investigation, `<source>-<day>` for the rest, `advertorial` fixed. */
  readonly id: string;
  readonly source: StorySource;
  readonly headline: string;
  /** The multiplier applied to `copies` on the day it runs. */
  readonly growth: number;
  readonly consequence: { readonly lever: string; readonly afterDays: number } | null;
  /** Credited on the day it runs. Non-zero for the advertorial only. */
  readonly paysPence: number;
  /** True only for a tip nobody has checked. */
  readonly unverified: boolean;
  /** The day it entered `available`. Placed at the end of day n, publishable from n + 1. */
  readonly offeredOn: number;
}

/**
 * Chosen by running the simulator, not by reasoning about them.
 *
 * The issue is explicit that these are inputs a human picks while campaign
 * outcomes are outputs a machine measures, and that this project keeps being
 * hurt by confusing the two: five calibrations were asserted and wrong in
 * eighteen hours.
 *
 * Every value sits inside the bound the issue gives it, and the bounds turned
 * out not to be enough on their own. `ADVERTORIAL_PENCE` satisfied its stated
 * inequality at £70 and still produced a paper that never closed, because the
 * bound only describes the endgame at the circulation floor and says nothing
 * about the surplus banked on the way down. That was found by running it, which
 * is the only reason it was found at all.
 */
export const WIRE_PENCE_PER_DAY = 800;
export const WIRE_GROWTH = 0.998;
export const PLANT_EVERY_DAYS = 17;
export const PLANT_GROWTH = 1.04;
export const PLANT_DELAY_DAYS = 20;
export const STRINGER_PENCE = 15_000;
export const STRINGER_GROWTH = 1.03;
export const STRINGER_DELAY_DAYS = 9;
export const TIP_EVERY_DAYS = 11;
export const TIP_CHECK_DAYS = 2;
export const TIP_TRUE_PERCENT = 55;
export const TIP_TRUE_GROWTH = STRINGER_GROWTH;
export const TIP_FALSE_GROWTH = 0.95;
export const TIP_FALSE_DELAY_DAYS = 5;
export const ADVERTORIAL_PENCE = 5_000;
export const ADVERTORIAL_GROWTH = 0.975;
export const FOLLOW_GROWTH = 0.996;

/** How long a story stays on the desk. Investigations and the advertorial are exempt. */
export const STORY_SHELF_DAYS = 12;

/** The id of the one permanent story. */
export const ADVERTORIAL_ID = 'advertorial';

/**
 * The whole vocabulary of generated copy.
 *
 * Roles and departments, never a person. Three phrases, one from each list, in
 * this order. `tests/unit/sources.test.ts` asserts that every generated headline
 * parses back into exactly these three positions, so a name cannot be smuggled
 * in later without a test going red.
 */
export const HEADLINE_WORDS = {
  who: [
    'The council',
    'A committee',
    'The ministry',
    'A department',
    'The inspectorate',
    'A contractor',
    'The board',
    'A tribunal',
  ],
  what: ['delays', 'defends', 'reviews', 'denies', 'confirms', 'abandons', 'restates', 'buries'],
  which: [
    'the estimate',
    'the appointment',
    'the contract',
    'the report',
    'the deadline',
    'the figures',
    'the guidance',
    'the inquiry',
  ],
} as const;

/**
 * FNV-1a, 32-bit, spelled out rather than imported.
 *
 * The exact bytes decide which tips are true and which headline a story gets,
 * so an implementation that differed would be a different game. `charCodeAt`
 * rather than UTF-8 bytes, `Math.imul` rather than `*`, and one `>>> 0` at the
 * end. Ids are ASCII, so the first choice cannot bite in practice.
 */
export function fnv1a(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic: the same id always yields the same headline. */
export function headlineFor(id: string): string {
  const h = fnv1a(id);
  const pick = <T>(xs: readonly T[], shift: number): T => xs[(h >>> shift) % xs.length];
  return [
    pick(HEADLINE_WORDS.who, 0),
    pick(HEADLINE_WORDS.what, 8),
    pick(HEADLINE_WORDS.which, 16),
  ].join(' ');
}

/**
 * Arrivals are cadences, not chances.
 *
 * `src/rng.ts` was deleted when the model stopped being random, and that
 * stands. Every calibration figure depends on the same inputs producing the
 * same campaign; reintroducing chance would put those figures out of reach.
 */
export const dayHasPlant = (day: number): boolean => day % PLANT_EVERY_DAYS === 0;
export const dayHasTip = (day: number): boolean => day % TIP_EVERY_DAYS === 0;

/** A tip's truth is fixed by its identity and nothing else. */
export const tipIsTrue = (id: string): boolean => fnv1a(id) % 100 < TIP_TRUE_PERCENT;

const generated = (
  id: string,
  source: StorySource,
  offeredOn: number,
  rest: Partial<Story> = {},
): Story => ({
  id,
  source,
  headline: headlineFor(id),
  growth: 1,
  consequence: null,
  paysPence: 0,
  unverified: false,
  offeredOn,
  ...rest,
});

export const wireStory = (day: number): Story =>
  generated(`wire-${day}`, 'wire', day, { growth: WIRE_GROWTH });

export const plantedStory = (day: number): Story =>
  generated(`planted-${day}`, 'planted', day, {
    growth: PLANT_GROWTH,
    consequence: { lever: 'access', afterDays: PLANT_DELAY_DAYS },
  });

export const stringerStory = (day: number): Story =>
  generated(`stringer-${day}`, 'stringer', day, {
    growth: STRINGER_GROWTH,
    consequence: { lever: 'money', afterDays: STRINGER_DELAY_DAYS },
  });

/**
 * A tip, which is a gamble until somebody checks it.
 *
 * `growth` and `consequence` already encode the answer, so the view must never
 * read them for a story with `unverified: true`. That rule is asserted in the
 * browser tests rather than left to good intentions.
 */
export const tipStory = (day: number): Story => {
  const id = `tip-${day}`;
  const true_ = tipIsTrue(id);
  return generated(id, 'tip', day, {
    unverified: true,
    growth: true_ ? TIP_TRUE_GROWTH : TIP_FALSE_GROWTH,
    consequence: true_ ? null : { lever: 'law', afterDays: TIP_FALSE_DELAY_DAYS },
  });
};

export const followStory = (day: number): Story =>
  generated(`follow-${day}`, 'follow', day, { growth: FOLLOW_GROWTH });

/** The one permanent story. Offered on day 0 so it is there from the first morning. */
export const advertorialStory = (): Story =>
  generated(ADVERTORIAL_ID, 'advertorial', 0, {
    growth: ADVERTORIAL_GROWTH,
    paysPence: ADVERTORIAL_PENCE,
  });

/** An investigation that matured. The only story whose headline is researched prose. */
export const investigationStory = (episode: Playable, day: number, growth: number): Story => ({
  id: episode.slug,
  source: 'investigation',
  headline: episode.title,
  growth,
  consequence: { lever: episode.lever, afterDays: episode.print.issues },
  paysPence: 0,
  unverified: false,
  offeredOn: day,
});

/** What arms a follow-up. `follow` is deliberately absent: it must not arm itself. */
export const FOLLOW_TRIGGERS: readonly StorySource[] = ['investigation', 'planted', 'stringer', 'tip'];
