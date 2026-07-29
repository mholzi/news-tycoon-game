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
import { STRINGER_PENCE } from './sources';

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
function pick(available: readonly Story[], uses: PolicyUses): Story | undefined {
  const allowed = available.filter((s) => {
    if (s.source === 'advertorial') return uses.advertorial === true;
    if (s.source === 'wire') return uses.wire === true;
    if (s.source === 'stringer') return uses.stringer === true;
    if (s.source === 'planted' || s.source === 'follow') return uses.unbidden === true;
    if (s.source === 'tip') {
      if (uses.unbidden !== true) return false;
      // Checking is what makes it printable; not checking is the gamble.
      return uses.checkTips === true ? s.unverified !== true : true;
    }
    return true;
  });
  // `filter` already returned a fresh array, so this sorts nothing the caller
  // can see.
  return allowed.sort((a, b) =>
    b.growth !== a.growth ? b.growth - a.growth : a.id < b.id ? -1 : 1,
  )[0];
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

    if (uses.checkTips === true) {
      for (const story of state.available) {
        if (story.unverified && !state.checking.some((c) => c.id === story.id)) {
          actions.push({ kind: 'check', id: story.id });
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

    const best = pick(state.available, uses);
    if (best !== undefined) actions.push({ kind: 'publish', id: best.id });

    state = playDay(state, pool, actions);
    if (state.over) return state;
    // Only advance between days, never past the last, so a survivor's `day` is
    // the number of days it played rather than one more.
    if (day < days) state = { ...state, day: state.day + 1 };
  }

  return state;
}
