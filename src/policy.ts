/**
 * The policy the calibration is measured under.
 *
 * One copy, because `scripts/simulate.ts` prints a table and
 * `tests/integration/paper-campaign.test.ts` asserts it, and those two used to
 * carry line-for-line duplicates of this loop. A policy that drifts between the
 * thing measuring and the thing asserting is worse than no policy: the table
 * would keep printing while the meaning of it quietly changed.
 */

import type { Playable } from './feed';
import {
  playDay,
  startPaper,
  STARTING_SOURCES,
  type Action,
  type PaperState,
  type StartOptions,
  type Story,
} from './paper';
import { PUBLISH_RULES, STRINGER_PENCE } from './sources';

/**
 * Which sources a calibration policy is allowed to use.
 *
 * Every flag defaults off, and with all of them off the policy behaves exactly
 * as it did before the sources landed — which is what keeps the seven existing
 * calibration rows from moving.
 */
export interface PolicyUses {
  /** Subscribe on day one and stay subscribed. */
  wire?: boolean;
  /** Buy whenever cash allows and none is pending. */
  stringer?: boolean;
  /** Publish the advertorial when nothing better is on the desk. */
  advertorial?: boolean;
  /** Check every tip rather than running it blind. */
  checkTips?: boolean;
  /**
   * Run the things that arrive unasked: plants, tips and follow-ups.
   *
   * Not in the issue, and found while building it. Plants and tips arrive on a
   * cadence whatever the policy wants, so without this flag a "flags-false"
   * policy still published them and the calibration moved — 193 stories instead
   * of 36, and every measured day wrong. Criterion 13 says this feature must not
   * touch the existing economy, so the default has to be off.
   */
  unbidden?: boolean;
  /**
   * Fill the inside as well as the lead.
   *
   * Off by default, and for the same reason `unbidden` is: with it off a policy
   * queues exactly one publish, so the difference between the old rows and the
   * new ones is attributable to the shared reporter budget alone rather than to
   * two changes at once.
   */
  multiStory?: boolean;
}

/**
 * What the policy is willing to run today, best first.
 *
 * Highest growth wins, ties broken by code point so the choice is reproducible.
 *
 * The tip rule is the one worth reading twice. A tip that stands up keeps
 * `source: 'tip'` and only flips `unverified`, so the first version of this
 * filter — `uses.checkTips !== true` on the source alone — excluded the
 * verified ones too. A `checkTips` policy therefore paid two reporter-days per
 * check and then threw every result away: 36 checks, 15 standing up, none ever
 * printed. The row it produced was labelled as the reward for checking and
 * measured not printing tips at all. Filter on the thing the check changes.
 */
function allows(story: Story, uses: PolicyUses): boolean {
  if (story.source === 'advertorial') return uses.advertorial === true;
  if (story.source === 'wire') return uses.wire === true;
  if (story.source === 'stringer') return uses.stringer === true;
  if (story.source === 'planted' || story.source === 'follow') return uses.unbidden === true;
  if (story.source === 'tip') {
    if (uses.unbidden !== true) return false;
    // Checking is what makes it printable; not checking is the gamble.
    return uses.checkTips === true ? story.unverified !== true : true;
  }
  return true;
}

/**
 * A standing offer that may run once in an issue — the advertorial, and nothing
 * else today. Consumed stories are also `oncePerIssue`, but two stringers are
 * two different stories and both belong in one paper, so the test is on the
 * offer being standing rather than on the cap alone.
 */
const isCappedOffer = (story: Story): boolean => {
  const rule = PUBLISH_RULES[story.source];
  return rule.oncePerIssue && !rule.consumed;
};

const bestFirst = (a: Story, b: Story): number =>
  b.growth !== a.growth ? b.growth - a.growth : a.id < b.id ? -1 : 1;

function pickLead(available: readonly Story[], uses: PolicyUses): Story | undefined {
  return available.filter((s) => allows(s, uses)).sort(bestFirst)[0];
}

/**
 * What else goes in, after the lead is chosen.
 *
 * Two rules here are asymmetric with `pickLead` on purpose.
 *
 * **No unverified tips.** `pickLead` will run one blind when `checkTips` is off —
 * that is the `mixed-blind` gamble, and it is deliberate. Sorting the inside by
 * `growth` would be different: it reads the answer the check is supposed to buy.
 * So the lead may gamble and the inside never does.
 *
 * **No agency copy.** It is unlimited and free of reporters, so "append wire
 * until full" has no stopping condition — and under `INSIDE_SHARE` a story below
 * 1 subtracts, so padding with it is self-harm. A calibration policy models a
 * competent player. Wire-padding as a measured strategy needs its own capped row.
 */
function fillInside(
  available: readonly Story[],
  uses: PolicyUses,
  capacity: number,
): Story[] {
  if (uses.multiStory !== true || capacity <= 0) return [];
  return available
    .filter(
      (s) =>
        allows(s, uses) &&
        s.unverified !== true &&
        s.source !== 'wire' &&
        // A capped standing offer belongs to the lead or to nobody. Read from
        // the rules rather than left to `growth > 1` to exclude it: the
        // advertorial is only kept out by being worth 0.975 today, and a tuning
        // pass that lifted it above 1 would have this queueing an illegal issue
        // every day while the table kept printing.
        !isCappedOffer(s) &&
        s.growth > 1,
    )
    .sort(bestFirst)
    .slice(0, capacity);
}

export const CALIBRATION_DAYS = 400;

/**
 * Work `cultivators` reporters on a different source each, every day, and run
 * any story the moment it matures. `playDay` caps publishing at one a day, so a
 * backlog waits.
 *
 * One reporter per source, not `cultivators` reporters on `council`. `playDay`
 * refuses a second go at a source the same day, so the old version silently
 * clamped every value above one to one: `investigations-2c 4r 2c` printed a
 * campaign bit-for-bit identical to `investigations-4 4r 1c`, and the table
 * carried it as a measurement. Capped at the number of sources that exist,
 * because a fourth cultivator would be the same no-op again.
 */
export function playPolicy(
  pool: readonly Playable[],
  cultivators: number,
  options: StartOptions = {},
  days = CALIBRATION_DAYS,
  uses: PolicyUses = {},
): PaperState {
  if (!Number.isInteger(cultivators) || cultivators < 0 || cultivators > STARTING_SOURCES.length) {
    throw new RangeError(
      `cultivators must be 0 to ${STARTING_SOURCES.length}, got ${cultivators}`,
    );
  }

  let state = startPaper(options);

  for (let day = 1; day <= days; day += 1) {
    const actions: Action[] = [];

    if (uses.wire === true && !state.subscribed) actions.push({ kind: 'subscribe' });

    for (let i = 0; i < cultivators; i += 1) {
      actions.push({ kind: 'cultivate', sourceId: STARTING_SOURCES[i] });
    }

    let checksQueued = 0;
    if (uses.checkTips === true) {
      for (const story of state.available) {
        if (story.unverified && !state.checking.some((c) => c.id === story.id)) {
          actions.push({ kind: 'check', id: story.id });
          checksQueued += 1;
        }
      }
    }

    if (
      uses.stringer === true &&
      state.cashPence >= STRINGER_PENCE &&
      !state.available.some((s) => s.source === 'stringer')
    ) {
      actions.push({ kind: 'buy-stringer' });
    }

    const lead = pickLead(state.available, uses);
    if (lead !== undefined) {
      actions.push({ kind: 'publish', id: lead.id });

      // What is left for the inside once this day's other work is paid for.
      // `checksQueued` is not already inside `state.checking` — these actions were
      // built against the start-of-day state and only reach `next.checking` when
      // `playDay` runs, where `free()` then sees them. Leaving the term out
      // over-states capacity for every checking policy, and `playDay` would refuse
      // the surplus rather than the policy never asking.
      // The lead's own charge is read from the rules, not assumed to be one:
      // when nothing else is allowed `pickLead` can return a wire item, which
      // costs no reporter, and a hardcoded `- 1` understated the inside by one.
      const capacity =
        state.reporters -
        state.running.length -
        state.checking.length -
        cultivators -
        checksQueued -
        (PUBLISH_RULES[lead.source].costsReporter ? 1 : 0);

      for (const story of fillInside(
        state.available.filter((s) => s.id !== lead.id),
        uses,
        capacity,
      )) {
        actions.push({ kind: 'publish', id: story.id });
      }
    }

    state = playDay(state, pool, actions);
    if (state.over) return state;
    // Only advance between days, never past the last, so a survivor's `day` is
    // the number of days it played rather than one more.
    if (day < days) state = { ...state, day: state.day + 1 };
  }

  return state;
}
