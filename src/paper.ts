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
import {
  ADVERTORIAL_ID,
  FOLLOW_TRIGGERS,
  STORY_SHELF_DAYS,
  STRINGER_PENCE,
  TIP_CHECK_DAYS,
  PUBLISH_RULES,
  WIRE_PENCE_PER_DAY,
  advertorialStory,
  dayHasPlant,
  dayHasTip,
  followStory,
  investigationStory,
  plantedStory,
  stringerStory,
  tipIsTrue,
  tipStory,
  wireStory,
  type Story,
} from './sources';

export type { Story, StorySource } from './sources';

export interface Source {
  readonly id: string;
  steps: number;
}

export interface Investigation {
  readonly slug: string;
  readonly readyOn: number;
}

export interface Bill {
  readonly id: string;
  readonly lever: string;
  readonly dueOn: number;
}

/** A reporter checking whether a tip stands up. */
export interface Check {
  readonly id: string;
  readonly readyOn: number;
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
  checking: Check[];
  available: Story[];
  /** Stories, not ids: the used-set below has to read `source`. The advertorial
   *  appears once per day it ran, so this counts publications. */
  published: Story[];
  subscribed: boolean;
  bills: Bill[];
  /** Newest first. */
  ledger: LedgerLine[];
  /**
   * The campaign has ended. It does NOT mean the paper closed — it widened when
   * a second ending landed, and it is read as "stop" everywhere, which is why
   * widening it was safe. `won` says which ending it was.
   */
  over: boolean;
  /** Ended by reaching `COPIES_CEILING` rather than by running out of money. */
  won: boolean;
}

export type Action =
  | { kind: 'publish'; id: string }
  | { kind: 'cultivate'; sourceId: string }
  | { kind: 'hire' }
  | { kind: 'fire' }
  | { kind: 'subscribe' }
  | { kind: 'unsubscribe' }
  | { kind: 'buy-stringer' }
  | { kind: 'check'; id: string };

export interface StartOptions {
  reporters?: number;
  cashPence?: number;
}

export const START_CASH_PENCE = 150_000;
export const START_COPIES = 20_000;
export const START_REPORTERS = 3;
export const WAGE_PENCE_PER_DAY = 3_000;

/**
 * The smallest newsroom the rules allow, and the headcount every "can this
 * source keep a paper alive for ever?" bound must be stated against.
 *
 * `fire` used to stop at one, and that made the game unlosable: the advertorial
 * pays a flat fee while wages scale with heads, so a player who shed two
 * reporters banked £30 a day at the circulation floor and never closed. The
 * guard that was supposed to prevent exactly that asserted the bound against
 * `START_REPORTERS`, which is the headcount you begin with rather than the
 * lowest one you can reach — a bound on the wrong number is not a bound.
 *
 * Fixing it here rather than by repricing the advertorial: at a price low
 * enough to be safe at one reporter (under £20) the source is never worth
 * running at any headcount, which deletes the feature instead of bounding it.
 * The deeper shape — a flat payment against a penalty the floor stops
 * charging — is bounded here, not removed; see news-tycoon#31.
 */
export const MIN_REPORTERS = 3;

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

/**
 * What share of the cover price the paper keeps.
 *
 * Swept on the real simulator — edit this line, run `scripts/simulate.ts`, read
 * the table — because at 0.25 a copy earned 0.5p a day against a reporter at
 * 3,000p, so a reporter paid for themselves only at 6,000 copies and the game
 * was very nearly unwinnable:
 *
 * | share | break-even per reporter | rows surviving of 14 | does idle still close? |
 * |---|---|---|---|
 * | 0.25 | 6,000 copies | 1 | yes — day 112 at three reporters |
 * | 0.35 | 4,286 copies | 8 | yes — 228 / 113 / 30 for 3r / 4r / 6r |
 * | 0.50 | 3,000 copies | 9 | only at day 400 — too soft |
 * | 0.75 | 2,000 copies | 13 | **no** at three and four reporters |
 *
 * 0.35 is where several strategies become viable while doing nothing still
 * closes the paper at every staffing. 0.75 was tried and leaves a do-nothing
 * paper alive at three and four reporters, which is the one thing the economy
 * has to keep punishing.
 *
 * **This is not only what a copy earns.** `billBasisPence()` multiplies by it
 * too, so every bill moves with it: the money bill 7,500p to 10,500p, the law
 * bill 20,000p to 28,000p. That coupling is deliberate and the calibration was
 * measured with it in place. Decoupling them would be a second, unmeasured
 * change and every row in `src/runs.ts` would be describing a different game.
 */
export const MARGIN_SHARE = 0.35;
export const IDLE_DECAY = 0.005;
export const PUBLISH_GROWTH = 0.07;

/**
 * What an inside story is worth, as a share of its surplus over 1.
 *
 * An issue is a lead and an inside. The lead brings its growth in full; the first
 * inside story brings a third of whatever it has above 1, the second a ninth, and
 * so on. The exponent starts at 1, not 0 — at 0 the first inside story counts
 * full weight and an all-planted issue reaches 1.103340, above an investigation.
 *
 * A story below 1 therefore brings a NEGATIVE share, which is the whole reason
 * this shape was chosen: filling the inside with wire copy makes the issue worse,
 * and nobody had to price that in. It falls out.
 *
 * **The bound.** The series converges, so an inside of unlimited length has a
 * supremum. That supremum must stay under an investigation's 1.07 or three
 * mediocre stories beat one good one, which is the thing this feature exists to
 * prevent. The worst case is planted at 1.04, not stringer at 1.03, and the
 * crossing is 0.416949 — a first draft of the spec derived 0.75 from stringers
 * alone and was wrong. At 1/3 the all-planted supremum is 1.060904, a margin of
 * 0.009096. Any value in (0, 0.416949) would do; a third is not special.
 *
 * **1.07 is not a ceiling on an issue**, only on issues built from lesser copy.
 * An issue of nothing but investigations reaches 1.107779, and it should: three
 * of them in one paper is a real scoop. It is still the worse play — banking
 * three into one issue is 1.091507 against two idle days, where running them a
 * day apart compounds to 1.225043. The diminishing share is what makes holding
 * stories back a mistake, which is the behaviour wanted.
 */
export const INSIDE_SHARE = 1 / 3;

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

/**
 * What one issue does to circulation.
 *
 * `issue[0]` leads and brings its growth whole; everything after it is the inside
 * and brings `INSIDE_SHARE^k` of its surplus over 1, k counting from 1. An empty
 * issue is a day with no paper, which decays.
 *
 * Exported as a pure function rather than inlined into `playDay` so the bound in
 * `INSIDE_SHARE` can be tested directly, without driving a campaign to reach the
 * states it describes — most of which the publishing rules make unreachable in
 * play anyway.
 */
export function issueGrowth(issue: readonly Story[]): number {
  if (issue.length === 0) return 1 - IDLE_DECAY;
  return issue
    .slice(1)
    .reduce((acc, story, i) => acc * (1 + (story.growth - 1) * INSIDE_SHARE ** (i + 1)), issue[0].growth);
}

export type PoolIssue =
  | { code: 'unknown-lever'; slug: string; lever: string }
  | { code: 'duplicate-slug'; slug: string; count: number }
  | { code: 'reserved-slug'; slug: string };

/**
 * The shapes a generated story's id can take.
 *
 * `available`, `published` and `bills` are all keyed by `Story.id`, and that id
 * is an episode slug for an investigation and `<source>-<day>` for everything
 * else. The two namespaces share one key, so a feed episode called
 * `advertorial` collides with the permanent one: `publish` resolves by
 * `findIndex`, hits whichever entry comes first, and the researched story sits
 * on the desk unpublishable for ever while its slug is consumed and its bill
 * never fires. Nothing about that is visible to the player.
 */
const RESERVED_SLUG = /^(wire|planted|stringer|tip|follow)-\d+$/;

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
    if (episode.slug === ADVERTORIAL_ID || RESERVED_SLUG.test(episode.slug)) {
      issues.push({ code: 'reserved-slug', slug: episode.slug });
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

  // Against MIN_REPORTERS, not 1. `fire` refuses to go below three, so a
  // constructor that accepted two handed callers a state the rules say cannot
  // exist — and the advertorial pays a flat fee against wages that scale with
  // heads, so a one-reporter paper banked £31 a day at the circulation floor
  // and never closed. That is the same unlosable game MIN_REPORTERS was raised
  // to prevent, still reachable through the door the calibration harness uses.
  if (!Number.isInteger(reporters) || reporters < MIN_REPORTERS) {
    throw new RangeError(`a paper needs at least ${MIN_REPORTERS} reporters, got ${reporters}`);
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
    checking: [],
    // The advertorial is there from the first morning and never leaves.
    available: [advertorialStory()],
    published: [],
    subscribed: false,
    bills: [],
    ledger: [],
    over: false,
    won: false,
  };
}

/** What the ledger says on the day a campaign stops, either way. */
export const CLOSED_LINE = 'The paper has closed.';
export const WON_LINE = 'Everyone reads you now.';

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
    checking: [...state.checking],
    available: [...state.available],
    published: [...state.published],
    bills: [...state.bills],
    ledger: [...state.ledger],
  };

  const say = (text: string, pence = 0) => {
    next.ledger.unshift({ day: next.day, text, pence });
  };

  // A finished paper runs nothing. Not even wages: there is nobody to pay.
  //
  // The line has to branch on `won` and the dedupe has to branch with it. A
  // single hardcoded 'The paper has closed.' wrote the losing line into a
  // winning ledger on the first replayed day, and comparing against a line this
  // branch no longer says gives a won paper a duplicate every day after that.
  if (next.over) {
    const ended = next.won ? WON_LINE : CLOSED_LINE;
    if (next.ledger[0]?.text !== ended) say(ended);
    return next;
  }

  const bySlug = new Map(pool.map((e) => [e.slug, e]));

  // 1. Wages.
  next.cashPence -= next.reporters * WAGE_PENCE_PER_DAY;
  say('Wages', -next.reporters * WAGE_PENCE_PER_DAY);

  // The subscription, taken whether or not it can be afforded. Step 10 decides
  // what a negative balance means, exactly as wages already do; the paper never
  // quietly unsubscribes itself.
  if (next.subscribed) {
    next.cashPence -= WIRE_PENCE_PER_DAY;
    say('The wire', -WIRE_PENCE_PER_DAY);
  }

  // 2 to 6. The plan, in the order the player built it.
  //
  // One pass, deliberately. Three passes by kind meant [work courts, let one go]
  // and [let one go, work courts] produced identical days, which is not what the
  // screen promises and not what anybody would expect from a list they wrote.
  let spentToday = 0;
  let boughtToday = false;
  const workedThisDay = new Set<string>();
  const checkedToday = new Set<string>();

  /**
   * Tomorrow's issue. The first entry leads, the rest are the inside, in the
   * order the plan wrote them — which is why plan order is load-bearing here as
   * well as for hire-then-fire.
   */
  const issue: Story[] = [];

  /**
   * Reporters with nothing on today. Read at every gate that spends one, so it
   * is written once — the count of those gates kept going stale, so it is not
   * recorded here any more.
   *
   * A reporter checking a tip is as busy as one on a story, one who worked a
   * source this morning is busy for the rest of the day, and — since the issue
   * grew past one story — so is one who wrote today. `spentToday` covers
   * cultivating and writing together: one budget, because a reporter who files
   * copy does not also spend the day on a source.
   *
   * That single budget is a decision with a price. It reaches the assignment loop
   * below, so printing competes with putting somebody on a lead, and every
   * calibration row moved when it landed. The alternative kept the rows frozen
   * and let three reporters do six jobs a day.
   */
  const free = (): number =>
    next.reporters - next.running.length - next.checking.length - spentToday;

  for (const action of actions) {
    switch (action.kind) {
      case 'hire': {
        if (next.cashPence < HIRE_COST_PENCE) {
          say('Cannot afford the wage.');
          break;
        }
        next.cashPence -= HIRE_COST_PENCE;
        next.reporters += 1;
        say('Hired a reporter', -HIRE_COST_PENCE);
        break;
      }

      case 'fire': {
        if (next.reporters <= MIN_REPORTERS) {
          say(`You cannot put out a daily with fewer than ${MIN_REPORTERS}.`);
          break;
        }
        // Free reporters go first. With nobody free the newest investigation is
        // cancelled and its lead returns to the front of the queue, so the story
        // is not lost, only the hand doing it — and the elapsed days with it,
        // which is why it has to be said out loud rather than left to the
        // player to notice a `running` entry vanish.
        if (free() <= 0) {
          if (next.running.length > 0) {
            let latest = 0;
            for (let i = 1; i < next.running.length; i += 1) {
              if (next.running[i].readyOn >= next.running[latest].readyOn) latest = i;
            }
            const [cancelled] = next.running.splice(latest, 1);
            next.leads.unshift(cancelled.slug);
            say(`Called off the investigation into ${cancelled.slug}.`);
          } else if (next.checking.length > 0) {
            // Only when there is no investigation to give up first. The tip stays
            // on the desk, still unverified: the work is lost, not the story.
            let latest = 0;
            for (let i = 1; i < next.checking.length; i += 1) {
              if (next.checking[i].readyOn >= next.checking[latest].readyOn) latest = i;
            }
            const [cancelled] = next.checking.splice(latest, 1);
            say(`Called off the check on ${cancelled.id}.`);
          }
        }
        next.reporters -= 1;
        say('Let a reporter go');
        break;
      }

      case 'cultivate': {
        const source = next.sources.find((s) => s.id === action.sourceId);
        if (source === undefined) {
          say('No such source.');
          break;
        }
        if (workedThisDay.has(source.id)) {
          say('That source has had its day.');
          break;
        }
        if (free() <= 0) {
          say('Nobody spare to work it.');
          break;
        }
        if (next.cashPence < SOURCE_STEP_PENCE) {
          say('Cannot afford it.');
          break;
        }
        // A source already at the threshold with nothing left in the archive
        // cannot be worked. Charging for it was the old behaviour and it was
        // indefensible: the player paid a reporter's day for a counter that
        // could not move and a lead that could not exist.
        if (source.steps >= SOURCE_STEPS_TO_LEAD && nextUnusedSlug(next, pool) === null) {
          say('No story in it.');
          break;
        }

        workedThisDay.add(source.id);
        spentToday += 1;
        next.cashPence -= SOURCE_STEP_PENCE;
        source.steps += 1;
        say(`Cultivated ${source.id}`, -SOURCE_STEP_PENCE);

        if (source.steps >= SOURCE_STEPS_TO_LEAD) {
          const slug = nextUnusedSlug(next, pool);
          if (slug === null) {
            // Deliberately does NOT reset the steps. Resetting first sold the
            // player progress the archive cannot deliver: the counter cycled 0
            // to 4 for ever while every cycle charged four days of work and
            // produced nothing. Left at the threshold, the source is visibly stuck.
            say('No story in it.');
          } else {
            source.steps = 0;
            next.leads.push(slug);
            say(`A lead from ${source.id}`);
          }
        }
        break;
      }

      case 'subscribe': {
        if (next.subscribed) {
          say('Already on the wire.');
          break;
        }
        if (next.cashPence < WIRE_PENCE_PER_DAY) {
          say('Cannot afford it.');
          break;
        }
        next.subscribed = true;
        say('On the wire');
        break;
      }

      case 'unsubscribe': {
        if (!next.subscribed) {
          say('Not on the wire.');
          break;
        }
        next.subscribed = false;
        say('Off the wire');
        break;
      }

      case 'buy-stringer': {
        if (boughtToday) {
          say('One a day from the stringer.');
          break;
        }
        if (next.cashPence < STRINGER_PENCE) {
          say('Cannot afford it.');
          break;
        }
        boughtToday = true;
        next.cashPence -= STRINGER_PENCE;
        say('Bought a story', -STRINGER_PENCE);
        break;
      }

      case 'check': {
        const tip = next.available.find((s) => s.id === action.id && s.unverified);
        if (tip === undefined) {
          say('Nothing to check.');
          break;
        }
        if (checkedToday.has(action.id) || next.checking.some((c) => c.id === action.id)) {
          say('Already looking into it.');
          break;
        }
        // A tip ages off the desk before a check begun this late could report,
        // and the resolution step then drops that check without a word: a
        // reporter is held for two days, the ledger says nothing, and the
        // player is never told why. Refuse the work instead of losing it.
        if (next.day + TIP_CHECK_DAYS >= tip.offeredOn + STORY_SHELF_DAYS) {
          say('There is no time left in it.');
          break;
        }
        if (free() <= 0) {
          say('Nobody spare to check it.');
          break;
        }
        checkedToday.add(action.id);
        next.checking.push({ id: action.id, readyOn: next.day + TIP_CHECK_DAYS });
        say(`Checking ${action.id}`);
        break;
      }

      // An issue, not a slot. The refusal order below is load-bearing: the
      // lookup runs first because every rule after it reads `story.source`, so a
      // second advertorial on a day with nobody free is refused as a second
      // advertorial, not for want of a reporter.
      case 'publish': {
        const at = next.available.findIndex((s) => s.id === action.id);
        if (at === -1) {
          say('That story is not ready.');
          break;
        }
        const story = next.available[at];
        const rule = PUBLISH_RULES[story.source];

        // Agency copy is the paper's only outside supply, so running it needs the
        // subscription that buys it.
        if (story.source === 'wire' && !next.subscribed) {
          say('The wire is not yours to run.');
          break;
        }
        // By id, not by source: two stringers are two different stories and both
        // belong in one issue. This only ever fires for a standing offer, since
        // a consumed story has already left the desk and fails the lookup above
        // — and the advertorial is the only standing offer that is capped.
        if (rule.oncePerIssue && issue.some((s) => s.id === story.id)) {
          say('The advertiser gets one page.');
          break;
        }
        if (rule.costsReporter) {
          if (free() <= 0) {
            say('Nobody spare to write it.');
            break;
          }
          spentToday += 1;
        }

        // A consumed story leaves the desk; a standing offer does not, which is
        // why `published` carries repeated ids for agency copy on purpose.
        if (rule.consumed) next.available.splice(at, 1);
        next.published.push(story);
        issue.push(story);

        if (story.consequence !== null) {
          next.bills.push({
            id: story.id,
            lever: story.consequence.lever,
            dueOn: next.day + story.consequence.afterDays,
          });
        }
        if (story.paysPence !== 0) next.cashPence += story.paysPence;
        // A tip published mid-check has nothing left to check.
        next.checking = next.checking.filter((c) => c.id !== story.id);
        say(`Published ${story.id}`, story.paysPence);
        break;
      }
    }
  }

  // Assignment. Nobody sits idle while a lead waits.
  for (;;) {
    if (free() <= 0 || next.leads.length === 0) break;
    const slug = next.leads.shift()!;
    next.running.push({ slug, readyOn: next.day + INVESTIGATION_DAYS });
  }

  // Maturity.
  const matured = next.running.filter((i) => i.readyOn <= next.day);
  next.running = next.running.filter((i) => i.readyOn > next.day);
  for (const investigation of matured) {
    const episode = bySlug.get(investigation.slug);
    if (episode === undefined) {
      // Unreachable while the pool a campaign started with is the pool it ends
      // with: leads only ever come from `nextUnusedSlug`, which reads the same
      // pool. Said out loud anyway, because the alternative was announcing a
      // story that never reached the desk and losing six reporter-days in
      // silence — the ledger claiming the opposite of what happened.
      say(`${investigation.slug} came to nothing.`);
      continue;
    }
    next.available.push(investigationStory(episode, next.day, 1 + PUBLISH_GROWTH));
    say(`${investigation.slug} is ready`);
  }

  // Checks resolve with them. A tip that stands up keeps its place and its age;
  // one that does not is taken off the desk rather than left as a trap.
  const checked = next.checking.filter((c) => c.readyOn <= next.day);
  next.checking = next.checking.filter((c) => c.readyOn > next.day);
  for (const check of checked) {
    const at = next.available.findIndex((s) => s.id === check.id);
    if (at === -1) continue;
    if (tipIsTrue(check.id)) {
      next.available[at] = { ...next.available[at], unverified: false };
      say(`${check.id} stands up`);
    } else {
      next.available.splice(at, 1);
      say('Nothing in it after all.');
    }
  }

  // The whole issue decides the day's circulation, not one story and not a
  // constant: an advertorial costs readers, a false tip costs more, wire copy
  // barely holds, and an inside padded with any of them drags the lead down.
  next.copies *= issueGrowth(issue);

  // 7. Clamp.
  next.copies = clamp(next.copies);

  // 8. Sales.
  const takings = Math.round(next.copies * next.pricePence * MARGIN_SHARE);
  next.cashPence += takings;
  say('Sales', takings);

  // 9. Bills. The entry that lands today is the one earned days ago, by which
  // time the decision that caused it is off the screen.
  // `<=` rather than `===`: exact matching stranded a bill for ever if a caller
  // ever advanced the day by more than one, and it is identical under a step of
  // one. The same reasoning covers maturity above.
  const due = next.bills.filter((b) => b.dueOn <= next.day);
  next.bills = next.bills.filter((b) => b.dueOn > next.day);
  for (const bill of due) {
    switch (bill.lever) {
      case 'access':
        next.copies *= ACCESS_FACTOR;
        say(`The bill for ${bill.id}`);
        break;
      case 'money': {
        const cost = Math.round(MONEY_COST_MULTIPLE * billBasisPence());
        next.cashPence -= cost;
        say(`The bill for ${bill.id}`, -cost);
        break;
      }
      case 'law': {
        const cost = Math.round(LAW_COST_MULTIPLE * billBasisPence());
        next.cashPence -= cost;
        say(`The bill for ${bill.id}`, -cost);
        break;
      }
      default:
        say(`No charge for ${bill.id}.`);
    }
  }
  next.copies = clamp(next.copies);

  // 10. End check. Two endings now, and going broke takes precedence: you
  // cannot win a paper you cannot pay for.
  if (next.cashPence < 0) {
    next.over = true;
    say(CLOSED_LINE);
  }

  // Reaching the ceiling ends the campaign, and you have won.
  //
  // The `!next.over` guard is what makes the precedence hold, not the position
  // of this block. The cash check above sets `over` and falls through without
  // returning, so a day that both broke the paper and reached the ceiling would
  // otherwise be recorded as a win. Before the arrivals block, so a finished
  // paper does not generate a desk nobody will see.
  //
  // This is why the ceiling stopped being a safe harbour rather than being made
  // unsafe. At 80,000 copies a paper takes 56,000p a day against 9,000p of
  // wages and nothing can reach it — and the two measured attempts to make it
  // reachable both failed, one of them for a reason that is arithmetic rather
  // than tuning: growth is only worth having if a reporter costs less than the
  // circulation they cover, and if that holds then a staffed paper is profitable
  // at every scale. "Growth pays" and "no safe harbour" contradict each other.
  // Ending the campaign on arrival needs neither to give.
  if (!next.over && next.copies >= COPIES_CEILING) {
    next.over = true;
    next.won = true;
    say(WON_LINE);
    return next;
  }

  // Arrivals, only if there is still a paper to put them in.
  //
  // They land at the end of the day into tomorrow's desk, because the caller
  // passes today's actions in before any of this runs: a story generated here
  // could not have been named by them.
  if (!next.over) {
    // Old news first, so a story cannot age out and arm a follow-up in the same
    // breath. Investigations and the advertorial never age.
    const kept: Story[] = [];
    for (const story of next.available) {
      const ages = story.source !== 'advertorial' && story.source !== 'investigation';
      if (ages && next.day - story.offeredOn >= STORY_SHELF_DAYS) {
        say(`${story.id} is old news.`);
      } else {
        kept.push(story);
      }
    }
    next.available = kept;

    // What sat unrun decides whether anybody follows it up, read before tonight's
    // arrivals so a plant cannot arm the follow-up that shares its evening.
    const armsFollow =
      next.available.some((s) => FOLLOW_TRIGGERS.includes(s.source)) &&
      !next.available.some((s) => s.source === 'follow');

    // Yesterday's wire item goes whether or not a new one replaces it: nobody
    // leads with wire copy two days running.
    next.available = next.available.filter((s) => s.source !== 'wire');
    if (next.subscribed) {
      next.available.push(wireStory(next.day));
      say('A wire item');
    }
    if (dayHasPlant(next.day)) {
      next.available.push(plantedStory(next.day));
      say('A story is planted');
    }
    if (boughtToday) {
      next.available.push(stringerStory(next.day));
      say('A story arrives from the stringer');
    }
    if (dayHasTip(next.day)) {
      next.available.push(tipStory(next.day));
      say('A tip arrives');
    }
    if (armsFollow) {
      next.available.push(followStory(next.day));
      say('Somebody else ran it');
    }
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
    ...state.available.filter((s) => s.source === 'investigation').map((s) => s.id),
    ...state.published.filter((s) => s.source === 'investigation').map((s) => s.id),
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
