/**
 * The owner's account, in numbers.
 *
 * The other account is a list of consequences with no total, deliberately. This
 * one is a total, equally deliberately, and the two are not convertible: there
 * is no rate anywhere in this file that turns a record entry into money, and
 * none that turns money into a record entry.
 *
 * Revenue is copies sold in a week times the price of a copy. There is no
 * advertising, no subscriptions, no staff costs. Everything a decision does to
 * the money, it does by moving one of those two numbers, or by charging a bill
 * against what has been taken so far.
 *
 * The load-bearing rule is what is NOT here: holding a story queues no
 * financial lever at all. A week you held something reads exactly like a week
 * there was nothing to hold. That is the argument the game exists to make, and
 * `settle` in `main.ts` (mirrored by the bill-draining block at the top of
 * `runLedger` below) is where it would be easiest to accidentally undo.
 */

import { decadeOf, LEVERS } from './deal';
import type { Playable } from './feed';

export interface Ledger {
  /** Baseline weekly sale. A float; never rounded in state, rounded only for display. */
  copies: number;
  /** Cover price of the current decade, in whole pence. */
  pricePence: number;
  /** Cumulative takings in pence. May go negative. Never clamped. */
  takingsPence: number;
}

export interface DecadePrices {
  cheap: number;
  standard: number;
  dear: number;
}

export type PriceChoice = 'cheap' | 'standard' | 'dear';
export type IssueAction = 'print' | 'hold';

export const START_COPIES = 20_000;

/** What running a story does to that week's sale. One issue only, never stored in `copies`. */
export const PRINT_LIFT = 1.35;

/** What an access bill does to the baseline sale, for good. */
export const ACCESS_FACTOR = 0.96;

/** Money and law bills, as multiples of one issue's takings at the era's standard price. */
export const MONEY_COST_MULTIPLE = 0.75;
export const LAW_COST_MULTIPLE = 2;

export const PRICE_MULTIPLIER: Record<PriceChoice, number> = {
  cheap: 1.15,
  standard: 1,
  dear: 0.85,
};

/**
 * Cover prices per decade, in whole pence.
 *
 * CALIBRATION, NOT RESEARCH. These twelve rows are plausible for a London daily
 * and no source was consulted for any of them. Everything else in this project
 * cites where it came from; this does not, and must never be presented as if it
 * did. Sourcing them is a separate job.
 *
 * Three explicit prices rather than a multiplier on one, so there is no rounding
 * mode to argue about and no decade where "cheap" and "standard" collapse onto
 * the same penny.
 */
export const PRICE_TABLE: Record<number, DecadePrices> = {
  1920: { cheap: 1, standard: 2, dear: 3 },
  1930: { cheap: 1, standard: 2, dear: 3 },
  1940: { cheap: 2, standard: 3, dear: 5 },
  1950: { cheap: 2, standard: 4, dear: 6 },
  1960: { cheap: 4, standard: 6, dear: 9 },
  1970: { cheap: 6, standard: 10, dear: 15 },
  1980: { cheap: 12, standard: 20, dear: 30 },
  1990: { cheap: 25, standard: 40, dear: 60 },
  2000: { cheap: 30, standard: 50, dear: 75 },
  2010: { cheap: 60, standard: 100, dear: 150 },
  2020: { cheap: 120, standard: 200, dear: 300 },
  2030: { cheap: 180, standard: 300, dear: 450 },
};

// Derived, not restated. A 2040 row added to the table above would otherwise
// stay silently unreachable behind a clamp nobody remembered to widen.
const DECADES = Object.keys(PRICE_TABLE).map(Number);
const FIRST_DECADE = Math.min(...DECADES);
const LAST_DECADE = Math.max(...DECADES);

/**
 * A decade outside the table is reachable, so it is handled rather than asserted away.
 *
 * `feed.ts` checks only that `year` is a number and `deal.ts` rejects only
 * non-integers and negatives, so a feed can hand us 1850 and the campaign has to
 * keep playing. `warned` carries the set of decades already reported, so a bad
 * decade costs one line in the console per campaign and not one per lookup.
 */
export function pricesFor(decade: number, warned: Set<number>): DecadePrices {
  // `Number.isFinite` first: NaN survives `Math.min(Math.max(NaN, …), …)` as NaN,
  // and `PRICE_TABLE[NaN]` is undefined, which would throw one line later inside
  // `startLedger` — before the first frame of a campaign.
  const usable = Number.isFinite(decade) ? decade : FIRST_DECADE;
  const clamped = Math.min(Math.max(usable, FIRST_DECADE), LAST_DECADE);
  if (clamped !== decade && !warned.has(decade)) {
    warned.add(decade);
    console.warn('ledger:', `decade ${decade} is outside the price table, using ${clamped}`);
  }
  return PRICE_TABLE[clamped] ?? PRICE_TABLE[FIRST_DECADE];
}

/** One issue's takings at the era's standard price, which is what a bill is measured in. */
export function eraIssuePence(decade: number, warned: Set<number>): number {
  return START_COPIES * pricesFor(decade, warned).standard;
}

export function startLedger(firstDecade: number, warned: Set<number>): Ledger {
  return {
    copies: START_COPIES,
    pricePence: pricesFor(firstDecade, warned).standard,
    takingsPence: 0,
  };
}

/**
 * A new decade arrives. The standard price applies whether or not anyone chooses.
 *
 * Called before the desk appears, so a player who ignores the menu is on the
 * standard price of the decade they are now in, never on a price carried over
 * from the last one.
 */
export function enterDecade(ledger: Ledger, decade: number, warned: Set<number>): void {
  ledger.pricePence = pricesFor(decade, warned).standard;
}

/** A price is chosen. The multiplier hits `copies` once, here, and never again. */
export function choosePrice(
  ledger: Ledger,
  decade: number,
  choice: PriceChoice,
  warned: Set<number>,
): void {
  ledger.pricePence = pricesFor(decade, warned)[choice];
  ledger.copies *= PRICE_MULTIPLIER[choice];
}

/**
 * A bill lands.
 *
 * `lever` is null for a held story, which is the whole point: there is nothing
 * to charge. An unrecognised lever cannot stop a campaign, so it warns and moves
 * nothing here; the load-time complaint that an author actually reads is the
 * `unknown-lever` issue `validatePool` now reports. `warnedLevers` dedupes, the
 * same way `warned` does for decades: a mismatched vocabulary would otherwise
 * warn once per bill for the whole campaign.
 */
export function applyBill(
  ledger: Ledger,
  lever: string | null,
  landingDecade: number,
  warned: Set<number>,
  warnedLevers: Set<string> = new Set(),
): void {
  if (lever === null) return;

  switch (lever) {
    case 'access':
      ledger.copies *= ACCESS_FACTOR;
      return;
    case 'money':
      ledger.takingsPence -= Math.round(
        MONEY_COST_MULTIPLE * eraIssuePence(landingDecade, warned),
      );
      return;
    case 'law':
      ledger.takingsPence -= Math.round(LAW_COST_MULTIPLE * eraIssuePence(landingDecade, warned));
      return;
    default:
      if (!warnedLevers.has(lever)) {
        warnedLevers.add(lever);
        console.warn(
          'ledger:',
          `unknown lever ${lever}, no financial effect (known: ${LEVERS.join(', ')})`,
        );
      }
  }
}

/**
 * The week's takings, added once, when the issue's outcome is fixed.
 *
 * The lift is applied here and nowhere else. It never enters `copies`, which is
 * what "lifts that issue's sale and nothing else" has to mean if a good week is
 * not to become a permanent circulation gain.
 */
export function accrue(ledger: Ledger, printed: boolean): void {
  const lift = printed ? PRINT_LIFT : 1;
  ledger.takingsPence += Math.round(ledger.copies * lift * ledger.pricePence);
}

interface Owed {
  dueAt: number;
  lever: string | null;
}

/**
 * A whole campaign, replayed without a DOM.
 *
 * The issue loop here mirrors `main.ts` exactly, including that issue 1 never
 * passes through `advance()` and that the issue on which the last bill settles
 * still sells papers. `actions[i]` is the decision on the i-th EPISODE; quiet
 * issues take no decision and fall out of the pending queue on their own, which
 * is how the game derives them too.
 *
 * A `null` in `choices` is a prompt the player ignored, which the menu allows.
 */
export function runLedger(
  episodes: readonly Playable[],
  choices: readonly (PriceChoice | null)[],
  actions: readonly IssueAction[],
): Ledger {
  if (episodes.length === 0) throw new RangeError('runLedger needs at least one episode');
  if (actions.length < episodes.length) {
    throw new RangeError(`runLedger needs ${episodes.length} actions, got ${actions.length}`);
  }

  const warned = new Set<number>();
  const warnedLevers = new Set<string>();
  const ledger = startLedger(decadeOf(episodes[0].year), warned);
  let pending: Owed[] = [];
  let index = 0;
  let issue = 1;
  let lastDecade: number | null = null;
  let prompts = 0;

  for (;;) {
    // `lastDecade` is null only before the first episode is shown, and the first
    // pass always has one. Handled rather than asserted, so this path and
    // `main.ts`'s agree about what is reachable.
    const currentDecade = index < episodes.length ? decadeOf(episodes[index].year) : lastDecade;
    const due = pending.filter((p) => p.dueAt <= issue);
    pending = pending.filter((p) => p.dueAt > issue);
    if (currentDecade !== null) {
      for (const owed of due) {
        applyBill(ledger, owed.lever, currentDecade, warned, warnedLevers);
      }
    }

    if (index < episodes.length) {
      const episode = episodes[index];
      const decade = decadeOf(episode.year);
      if (decade !== lastDecade) {
        enterDecade(ledger, decade, warned);
        if (prompts >= choices.length) {
          throw new RangeError(`runLedger needs at least ${prompts + 1} price choices`);
        }
        const choice = choices[prompts];
        prompts += 1;
        if (choice !== null) choosePrice(ledger, decade, choice, warned);
        lastDecade = decade;
      }

      const printed = actions[index] === 'print';
      pending.push({
        dueAt: issue + episode[printed ? 'print' : 'hold'].issues,
        lever: printed ? episode.lever : null,
      });
      accrue(ledger, printed);
      index += 1;
    } else {
      accrue(ledger, false);
      if (pending.length === 0) return ledger;
    }

    issue += 1;
  }
}

/** How many price prompts a campaign fires, which is one per distinct decade in deal order. */
export function promptCount(episodes: readonly Playable[]): number {
  let count = 0;
  let last: number | null = null;
  for (const episode of episodes) {
    const decade = decadeOf(episode.year);
    if (decade !== last) {
      count += 1;
      last = decade;
    }
  }
  return count;
}

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
});
const copiesFormat = new Intl.NumberFormat('en-GB');

/**
 * An explicit locale, so the output does not follow whatever the runner's default
 * happens to be. It is not a guarantee: a `small-icu` Node build has no en-GB
 * data and falls back, which would break these strings and the assertions on
 * them. The CI image ships full ICU, so this is a known dependency rather than a
 * solved problem.
 */
export const formatCopies = (copies: number): string => copiesFormat.format(Math.round(copies));
export const formatPrice = (pence: number): string => `${pence}p`;
export const formatTakings = (pence: number): string => gbp.format(pence / 100);
