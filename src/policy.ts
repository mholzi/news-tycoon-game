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
import { playDay, startPaper, type Action, type PaperState, type StartOptions } from './paper';

export const CALIBRATION_DAYS = 400;

/**
 * Work `cultivators` reporters on `council` every day and run any story the
 * moment it matures. `playDay` caps publishing at one a day, so a backlog waits.
 */
export function playPolicy(
  pool: readonly Playable[],
  cultivators: number,
  options: StartOptions = {},
  days = CALIBRATION_DAYS,
): PaperState {
  let state = startPaper(options);

  for (let day = 1; day <= days; day += 1) {
    const actions: Action[] = [];
    for (let i = 0; i < cultivators; i += 1) {
      actions.push({ kind: 'cultivate', sourceId: 'council' });
    }
    if (state.available.length > 0) {
      actions.push({ kind: 'publish', slug: state.available[0] });
    }

    state = playDay(state, pool, actions);
    if (state.over) return state;
    // Only advance between days, never past the last, so a survivor's `day` is
    // the number of days it played rather than one more.
    if (day < days) state = { ...state, day: state.day + 1 };
  }

  return state;
}
