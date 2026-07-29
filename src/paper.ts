/**
 * The paper: a newsroom you pay for, and stories that grow it.
 *
 * A turn is a day. Wages leave every morning whether anybody files or not.
 * Routine copy covers them, so a paper that does nothing survives for a while
 * and then does not, because circulation decays and the payroll does not.
 * Stories are what make it grow.
 *
 * Everything here is pure. `main.ts` drives these functions from the DOM and
 * `scripts/simulate.ts` drives the same ones from an array, which is the only
 * reason the calibration table in the issue can be trusted: the numbers come
 * out of this file rather than out of a second model that agrees with it by
 * hand. Four calibrations were wrong in one day before that rule existed, each
 * one a simulation of part of the system reported as a measurement of all of it.
 */

import type { Playable } from './feed';

export interface Source {
  readonly id: string;
  steps: number;
}

export interface Investigation {
  readonly slug: string;
  readonly readyOn: number;
}

export interface Bill {
  readonly slug: string;
  readonly lever: string;
  readonly dueOn: number;
}

export interface LedgerLine {
  readonly day: number;
  readonly text: string;
  readonly pence: number;
}

export interface PaperState {
  day: number;
  cashPence: number;
  copies: number;
  readonly pricePence: number;
  reporters: number;
  sources: Source[];
  leads: string[];
  running: Investigation[];
  available: string[];
  published: string[];
  bills: Bill[];
  /** Newest first. */
  ledger: LedgerLine[];
  over: boolean;
}

export type Action =
  | { kind: 'publish'; slug: string }
  | { kind: 'cultivate'; sourceId: string }
  | { kind: 'hire' }
  | { kind: 'fire' };

export interface StartOptions {
  reporters?: number;
  cashPence?: number;
}

export const START_CASH_PENCE = 150_000;
export const START_COPIES = 20_000;
export const START_REPORTERS = 3;
export const WAGE_PENCE_PER_DAY = 3_000;

/**
 * What a copy costs, flat.
 *
 * Campaigns are decoupled from the centuries (Markus, 2026-07-29): a run is not
 * set in a decade and does not price itself from one. The episodes still carry
 * their real years, because they are real cases, but the year is what a story
 * IS rather than what the paper charges. The 2p is the 1920s figure the price
 * table used to supply, kept so the calibration below did not have to move.
 */
export const COVER_PRICE_PENCE = 2;
export const MARGIN_SHARE = 0.25;
export const IDLE_DECAY = 0.005;
export const PUBLISH_GROWTH = 0.07;
export const COPIES_FLOOR = 2_000;
export const COPIES_CEILING = 80_000;
export const SOURCE_STEP_PENCE = 2_500;
export const SOURCE_STEPS_TO_LEAD = 4;
export const INVESTIGATION_DAYS = 6;
export const HIRE_COST_PENCE = 5_000;

/** Carried over from the ledger that shipped on 2026-07-28. */
export const ACCESS_FACTOR = 0.96;
export const MONEY_COST_MULTIPLE = 0.75;
export const LAW_COST_MULTIPLE = 2;

/**
 * The yardstick a money or law bill is priced against.
 *
 * Deliberately fixed rather than current circulation: a court cannot be paid
 * off by losing readers, and a paper that has already been hurt is not spared
 * the next one.
 */
export const BILL_BASIS_COPIES = 20_000;

export const STARTING_SOURCES = ['council', 'courts', 'the-lobby'] as const;

/** The levers the economy knows how to charge for. */
export const LEVERS = ['access', 'money', 'law'] as const;

/**
 * One day's takings at the standard print run, which is what a bill is measured in.
 *
 * `MARGIN_SHARE` belongs here and was missing from the first draft. Without it
 * this returned the gross cover value of the print run rather than what the
 * paper actually keeps, making every bill four times its intended size — a law
 * bill came to eight days of revenue and no campaign could survive one. The
 * simulator found it on its first run.
 */
export function billBasisPence(): number {
  return Math.round(BILL_BASIS_COPIES * COVER_PRICE_PENCE * MARGIN_SHARE);
}

export type PoolIssue =
  | { code: 'unknown-lever'; slug: string; lever: string }
  | { code: 'duplicate-slug'; slug: string; count: number };

/**
 * What stops a pool being playable. Empty means nothing does.
 *
 * Reduced to the two checks that still bite now the dealer is gone: the economy
 * reads `lever` and `assertPlayFeed` accepts any non-empty string, and a save
 * naming an episode by slug needs slugs to be unique.
 */
export function validatePool(pool: readonly Playable[]): PoolIssue[] {
  const issues: PoolIssue[] = [];

  for (const episode of pool) {
    if (!(LEVERS as readonly string[]).includes(episode.lever)) {
      issues.push({ code: 'unknown-lever', slug: episode.slug, lever: episode.lever });
    }
  }

  const counts = new Map<string, number>();
  for (const episode of pool) counts.set(episode.slug, (counts.get(episode.slug) ?? 0) + 1);
  for (const [slug, count] of counts) {
    if (count > 1) issues.push({ code: 'duplicate-slug', slug, count });
  }

  return issues;
}

/**
 * A new paper.
 *
 * Throws on impossible openings rather than limping: this is construction, not
 * play, and a campaign that starts with no reporters or no cash is a caller
 * mistake rather than a state the game should render.
 */
export function startPaper(options: StartOptions = {}): PaperState {
  const reporters = options.reporters ?? START_REPORTERS;
  const cashPence = options.cashPence ?? START_CASH_PENCE;

  if (!Number.isInteger(reporters) || reporters < 1) {
    throw new RangeError(`a paper needs at least one reporter, got ${reporters}`);
  }
  if (!Number.isFinite(cashPence) || cashPence < 0) {
    throw new RangeError(`a paper cannot open in debt, got ${cashPence}`);
  }
  return {
    day: 1,
    cashPence,
    copies: START_COPIES,
    pricePence: COVER_PRICE_PENCE,
    reporters,
    sources: STARTING_SOURCES.map((id) => ({ id, steps: 0 })),
    leads: [],
    running: [],
    available: [],
    published: [],
    bills: [],
    ledger: [],
    over: false,
  };
}

const clamp = (copies: number): number =>
  Math.min(Math.max(copies, COPIES_FLOOR), COPIES_CEILING);

/**
 * One day.
 *
 * Ten steps in a fixed order, and the order is load-bearing: wages before
 * sales, publishing before the paper is priced, bills after it has sold. The
 * whole of the arithmetic lives here so the DOM and the simulator cannot
 * disagree about it.
 */
export function playDay(
  state: PaperState,
  pool: readonly Playable[],
  actions: readonly Action[] = [],
): PaperState {
  const next: PaperState = {
    ...state,
    sources: state.sources.map((s) => ({ ...s })),
    leads: [...state.leads],
    running: [...state.running],
    available: [...state.available],
    published: [...state.published],
    bills: [...state.bills],
    ledger: [...state.ledger],
  };

  const say = (text: string, pence = 0) => {
    next.ledger.unshift({ day: next.day, text, pence });
  };

  // A closed paper runs nothing. Not even wages: there is nobody to pay.
  if (next.over) {
    if (next.ledger[0]?.text !== 'The paper has closed.') say('The paper has closed.');
    return next;
  }

  const bySlug = new Map(pool.map((e) => [e.slug, e]));

  // 1. Wages.
  next.cashPence -= next.reporters * WAGE_PENCE_PER_DAY;
  say('Wages', -next.reporters * WAGE_PENCE_PER_DAY);

  // 2. Hire and fire, in the order they were asked for.
  for (const action of actions) {
    if (action.kind === 'hire') {
      if (next.cashPence < HIRE_COST_PENCE) {
        say('Cannot afford the wage.');
        continue;
      }
      next.cashPence -= HIRE_COST_PENCE;
      next.reporters += 1;
      say('Hired a reporter', -HIRE_COST_PENCE);
    } else if (action.kind === 'fire') {
      if (next.reporters <= 1) {
        say('Somebody has to write it.');
        continue;
      }
      // Free reporters go first. With nobody free, the newest investigation is
      // cancelled and its lead goes back to the front of the queue, so the work
      // is not lost, only the hand doing it.
      const free = next.reporters - next.running.length;
      if (free <= 0) {
        let latest = 0;
        for (let i = 1; i < next.running.length; i += 1) {
          if (next.running[i].readyOn >= next.running[latest].readyOn) latest = i;
        }
        const [cancelled] = next.running.splice(latest, 1);
        next.leads.unshift(cancelled.slug);
      }
      next.reporters -= 1;
      say('Let a reporter go');
    }
  }

  // 3. Cultivation. Each accepted one occupies a reporter for the day.
  let cultivatedToday = 0;
  const workedThisDay = new Set<string>();
  for (const action of actions) {
    if (action.kind !== 'cultivate') continue;

    const source = next.sources.find((s) => s.id === action.sourceId);
    if (source === undefined) {
      say('No such source.');
      continue;
    }
    if (workedThisDay.has(source.id)) {
      say('That source has had its day.');
      continue;
    }
    if (next.reporters - next.running.length - cultivatedToday <= 0) {
      say('Nobody spare to work it.');
      continue;
    }
    if (next.cashPence < SOURCE_STEP_PENCE) {
      say('Cannot afford it.');
      continue;
    }

    workedThisDay.add(source.id);
    cultivatedToday += 1;
    next.cashPence -= SOURCE_STEP_PENCE;
    source.steps += 1;
    say(`Cultivated ${source.id}`, -SOURCE_STEP_PENCE);

    if (source.steps >= SOURCE_STEPS_TO_LEAD) {
      source.steps = 0;
      const slug = nextUnusedSlug(next, pool);
      if (slug === null) {
        say('No story in it.');
      } else {
        next.leads.push(slug);
        say(`A lead from ${source.id}`);
      }
    }
  }

  // 4. Assignment. Nobody sits idle while a lead waits.
  for (;;) {
    const free = next.reporters - next.running.length - cultivatedToday;
    if (free <= 0 || next.leads.length === 0) break;
    const slug = next.leads.shift()!;
    next.running.push({ slug, readyOn: next.day + INVESTIGATION_DAYS });
  }

  // 5. Maturity.
  const matured = next.running.filter((i) => i.readyOn === next.day);
  next.running = next.running.filter((i) => i.readyOn !== next.day);
  for (const investigation of matured) {
    next.available.push(investigation.slug);
    say(`${investigation.slug} is ready`);
  }

  // 6. Publishing. One story leads the paper.
  let publishedToday: string | null = null;
  for (const action of actions) {
    if (action.kind !== 'publish') continue;
    if (publishedToday !== null) {
      say('Only one story can lead.');
      continue;
    }
    const at = next.available.indexOf(action.slug);
    if (at === -1) {
      say('That story is not ready.');
      continue;
    }
    next.available.splice(at, 1);
    next.published.push(action.slug);
    publishedToday = action.slug;

    const episode = bySlug.get(action.slug);
    if (episode !== undefined) {
      next.bills.push({
        slug: action.slug,
        lever: episode.lever,
        dueOn: next.day + episode.print.issues,
      });
    }
    say(`Published ${action.slug}`);
  }

  for (const action of actions) {
    if (action.kind !== 'publish' && action.kind !== 'cultivate' && action.kind !== 'hire' && action.kind !== 'fire') {
      say('Not something the paper does.');
    }
  }

  next.copies *= publishedToday !== null ? 1 + PUBLISH_GROWTH : 1 - IDLE_DECAY;

  // 7. Clamp.
  next.copies = clamp(next.copies);

  // 8. Sales.
  const takings = Math.round(next.copies * next.pricePence * MARGIN_SHARE);
  next.cashPence += takings;
  say('Sales', takings);

  // 9. Bills. The entry that lands today is the one earned days ago, by which
  // time the decision that caused it is off the screen.
  const due = next.bills.filter((b) => b.dueOn === next.day);
  next.bills = next.bills.filter((b) => b.dueOn !== next.day);
  for (const bill of due) {
    switch (bill.lever) {
      case 'access':
        next.copies *= ACCESS_FACTOR;
        say(`The bill for ${bill.slug}`);
        break;
      case 'money': {
        const cost = Math.round(MONEY_COST_MULTIPLE * billBasisPence());
        next.cashPence -= cost;
        say(`The bill for ${bill.slug}`, -cost);
        break;
      }
      case 'law': {
        const cost = Math.round(LAW_COST_MULTIPLE * billBasisPence());
        next.cashPence -= cost;
        say(`The bill for ${bill.slug}`, -cost);
        break;
      }
      default:
        say(`No charge for ${bill.slug}.`);
    }
  }
  next.copies = clamp(next.copies);

  // 10. End check.
  if (next.cashPence < 0) {
    next.over = true;
    say('The paper has closed.');
  }

  return next;
}

/**
 * The next episode nobody has been sent after.
 *
 * Lowest slug by code point, never `localeCompare`: the order decides which
 * story a campaign gets, so it has to be the same everywhere and forever.
 */
function nextUnusedSlug(state: PaperState, pool: readonly Playable[]): string | null {
  const used = new Set<string>([
    ...state.leads,
    ...state.running.map((i) => i.slug),
    ...state.available,
    ...state.published,
  ]);
  let lowest: string | null = null;
  for (const episode of pool) {
    if (used.has(episode.slug)) continue;
    if (lowest === null || episode.slug < lowest) lowest = episode.slug;
  }
  return lowest;
}

/**
 * A whole campaign, one state per played day.
 *
 * Index 0 is the state after day 1; the opening state is `startPaper` and is
 * not in the array. Stops on the day the paper closes.
 */
export function runCampaign(
  pool: readonly Playable[],
  days: readonly (readonly Action[])[],
  options: StartOptions = {},
): PaperState[] {
  const states: PaperState[] = [];
  let state = startPaper(options);

  for (const actions of days) {
    state = playDay(state, pool, actions);
    states.push(state);
    if (state.over) break;
    state = { ...state, day: state.day + 1 };
  }

  return states;
}
