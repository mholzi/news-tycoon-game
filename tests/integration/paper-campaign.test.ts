import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type PlayFeed, type Playable } from '../../src/feed';
import { playDay, startPaper, type Action, type PaperState, type StartOptions } from '../../src/paper';

/**
 * The calibration table, asserted.
 *
 * These figures come from `scripts/simulate.ts`, which drives the same
 * `playDay` this file does. That is deliberate and it is the whole point: four
 * calibrations of this economy were wrong in a single day because each was a
 * separate model of part of the system. There is one model now, and if it
 * changes these numbers move with it and this file goes red.
 *
 *   npx vite-node scripts/simulate.ts
 */

const pool: Playable[] = assertPlayFeed(
  JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/pool-36.json'), 'utf-8'),
  ) as PlayFeed,
).episodes.map(toPlayable);

const DAYS = 400;

/** `cultivators` reporters work `council`; anything matured is published at once. */
function play(cultivators: number, options: StartOptions): PaperState {
  let state = startPaper(options);
  for (let day = 1; day <= DAYS; day += 1) {
    const actions: Action[] = [];
    for (let i = 0; i < cultivators; i += 1) actions.push({ kind: 'cultivate', sourceId: 'council' });
    if (state.available.length > 0) actions.push({ kind: 'publish', slug: state.available[0] });

    state = playDay(state, pool, actions);
    if (state.over) return state;
    // Only advance between days, never past the last one, so a survivor's
    // `day` is the number of days it played rather than one more.
    if (day < DAYS) state = { ...state, day: state.day + 1 };
  }
  return state;
}

describe('a paper that does nothing', () => {
  it('closes on day 112 with three reporters', () => {
    const end = play(0, {});
    expect(end.over).toBe(true);
    expect(end.day).toBe(112);
  });

  it('closes sooner the more reporters it carries', () => {
    expect(play(0, { reporters: 4 }).day).toBe(48);
    expect(play(0, { reporters: 6 }).day).toBe(18);
  });
});

describe('a paper that works one source', () => {
  it('survives the year, publishes the whole archive, and grows', () => {
    const end = play(1, {});
    expect(end.over).toBe(false);
    expect(end.day).toBe(DAYS);
    expect(Math.round(end.copies)).toBe(22_579);
    expect(end.published).toHaveLength(36);
    expect(end.cashPence).toBe(3_890_688);
  });

  it('is killed by over-hiring even when it is played well', () => {
    expect(play(1, { reporters: 4 }).day).toBe(35);
    expect(play(1, { reporters: 6 }).day).toBe(15);
  });

  it('is killed by working more sources than the paper can carry', () => {
    expect(play(2, { reporters: 4 }).day).toBe(35);
  });
});

describe('the archive', () => {
  it('is the thing that runs out, and the paper survives it', () => {
    const end = play(1, {});
    // Everything published and still trading: routine copy is what pays the wages,
    // which is the correction that made a 36-episode archive enough.
    expect(end.published).toHaveLength(pool.length);
    expect(end.available).toHaveLength(0);
    expect(end.cashPence).toBeGreaterThan(0);
  });
});
