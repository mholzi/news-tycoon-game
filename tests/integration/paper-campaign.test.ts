import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type PlayFeed, type Playable } from '../../src/feed';
import { CALIBRATION_DAYS, playPolicy, type PolicyUses } from '../../src/policy';
import {
  COPIES_CEILING,
  COPIES_FLOOR,
  HIRE_COST_PENCE,
  billBasisPence,
} from '../../src/paper';

/**
 * The calibration, and the shape it is supposed to have.
 *
 * Two kinds of assertion here, and the difference matters.
 *
 * The **literals** come from `scripts/simulate.ts`, which drives the same
 * `playPolicy` this file does. They catch any change to any constant, but they
 * are the output of the code under test: on their own they are a regression
 * lock whose only possible repair is to re-baseline, and a re-baselined lock
 * cannot tell a tuning change from a regression.
 *
 * So the **relations** below are the real test. They say what the economy is
 * for — carrying more staff kills you sooner, working a source is what keeps
 * you alive — and they cannot be satisfied by copying whatever the model
 * currently prints. If a change inverts one of them the suite goes red no
 * matter what the numbers are.
 *
 *   npx vite-node scripts/simulate.ts
 */

const pool: Playable[] = assertPlayFeed(
  JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/pool-36.json'), 'utf-8'),
  ) as PlayFeed,
).episodes.map(toPlayable);

const play = (cultivators: number, reporters?: number, uses: PolicyUses = {}) =>
  playPolicy(
    pool,
    cultivators,
    reporters === undefined ? {} : { reporters },
    CALIBRATION_DAYS,
    uses,
  );

describe('the shape of the economy', () => {
  it('kills a bigger payroll sooner', () => {
    const three = play(0).day;
    const four = play(0, 4).day;
    const six = play(0, 6).day;
    expect(six).toBeLessThan(four);
    expect(four).toBeLessThan(three);
  });

  it('rewards working a source and punishes standing still', () => {
    expect(play(0).over).toBe(true);
    expect(play(1).over).toBe(false);
  });

  it('punishes hiring past what the paper can carry, even when it is played well', () => {
    expect(play(1).over).toBe(false);
    expect(play(1, 4).over).toBe(true);
    expect(play(1, 6).day).toBeLessThan(play(1, 4).day);
  });

  it('gives an idle paper weeks rather than days or years', () => {
    // The clock has to be long enough to be a decision and short enough to be a
    // pressure. Bounds from the design, not from a run.
    const idle = play(0).day;
    expect(idle).toBeGreaterThan(60);
    expect(idle).toBeLessThan(200);
  });

  it('grows a working paper rather than merely keeping it alive', () => {
    const end = play(1);
    expect(end.copies).toBeGreaterThan(20_000);
    expect(end.cashPence).toBeGreaterThan(0);
  });
});

describe('the calibration', () => {
  it('closes an idle paper on the measured days', () => {
    expect(play(0).day).toBe(112);
    expect(play(0, 4).day).toBe(48);
    expect(play(0, 6).day).toBe(18);
  });

  it('carries a worked paper through the year on the measured figures', () => {
    const end = play(1);
    expect(end.day).toBe(CALIBRATION_DAYS);
    expect(Math.round(end.copies)).toBe(22_579);
    expect(end.published).toHaveLength(36);
    expect(end.cashPence).toBe(4_520_688);
  });

  it('closes an over-staffed paper on the measured days', () => {
    expect(play(1, 4).day).toBe(35);
    expect(play(1, 6).day).toBe(15);
  });

  it('pins the constants the runs above cannot reach', () => {
    // Mutation testing found these three invisible: an order of magnitude on
    // any of them left every test green, because no campaign here approaches a
    // bound or runs out of money at the moment of hiring.
    expect(COPIES_CEILING).toBe(80_000);
    expect(COPIES_FLOOR).toBe(2_000);
    expect(HIRE_COST_PENCE).toBe(5_000);
    expect(billBasisPence()).toBe(10_000);
  });
});

describe('the other six sources', () => {
  // Relations first, as everywhere else here. The figures beneath them come from
  // `npx vite-node scripts/simulate.ts`.

  it('makes the wire a floor rather than a living', () => {
    const wire = play(0, 3, { wire: true });
    expect(wire.over).toBe(true);
    expect(wire.day).toBeGreaterThan(play(0).day);
    expect(wire.day).toBe(138);
  });

  it('never lets an advertorial keep a paper alive', () => {
    const ads = play(0, 3, { advertorial: true });
    expect(ads.over).toBe(true);
    expect(ads.day).toBe(137);
  });

  it('leaves an advertorial paper richer and less read than one that prints nothing', () => {
    // Compared on the earlier of the two closing days, which is the idle one.
    const idle = play(0);
    const ads = playPolicy(pool, 0, { reporters: 3 }, idle.day, { advertorial: true });
    expect(ads.cashPence).toBeGreaterThan(idle.cashPence);
    expect(ads.copies).toBeLessThan(idle.copies);
  });

  it('punishes running tips blind and rewards checking them', () => {
    const every: PolicyUses = { wire: true, stringer: true, advertorial: true, unbidden: true };
    const blind = play(1, 3, every);
    const careful = play(1, 3, { ...every, checkTips: true });
    expect(blind.over).toBe(true);
    expect(blind.day).toBe(25);
    expect(careful.over).toBe(false);
  });

  it('carries a paper that uses everything and checks its tips', () => {
    const mixed = play(1, 3, {
      wire: true,
      stringer: true,
      advertorial: true,
      checkTips: true,
      unbidden: true,
    });
    expect(mixed.over).toBe(false);
    expect(Math.round(mixed.copies)).toBe(79_840);
    expect(mixed.cashPence).toBe(6_084_047);
  });

  it('leaves the existing economy exactly where it was', () => {
    // Criterion 13. Plants and tips still arrive under a flags-false policy;
    // what changed is that such a policy does not publish them.
    expect(play(0).day).toBe(112);
    expect(play(1).published).toHaveLength(36);
    expect(play(1).cashPence).toBe(4_520_688);
  });
});

describe('the archive', () => {
  it('is the thing that runs out, and the paper survives it', () => {
    const end = play(1);
    expect(end.published).toHaveLength(pool.length);
    // The advertorial is permanent, so the desk is never truly empty.
    expect(end.available.filter((s) => s.source === 'investigation')).toHaveLength(0);
    expect(end.cashPence).toBeGreaterThan(0);
  });
});
