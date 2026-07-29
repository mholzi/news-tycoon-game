import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type PlayFeed, type Playable } from '../../src/feed';
import { CALIBRATION_DAYS, playPolicy, type PolicyUses } from '../../src/policy';
import { outcomeLine, RUNS } from '../../src/runs';
import type { PaperState } from '../../src/paper';
import {
  COPIES_CEILING,
  COPIES_FLOOR,
  HIRE_COST_PENCE,
  START_COPIES,
  WAGE_PENCE_PER_DAY,
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

  it('carries a fourth reporter as dead weight and closes on a sixth', () => {
    // Renamed off "punishes hiring past what the paper can carry": at 0.35 the
    // fourth reporter is not punished at all. It changes no play whatever —
    // identical circulation, identical stories — and costs exactly its wages.
    // The punishment claim rests entirely on the sixth, so the name says so.
    //
    // The fourth reporter's cost is asserted as a relation, not a copied
    // figure: SURVIVORS lists 22,579 copies and 36 published for BOTH rows, so
    // pinning the numbers alone lets `investigations-4` restate the row above it
    // and measure nothing.
    const three = play(1);
    const four = play(1, 4);
    expect(three.over).toBe(false);
    expect(four.over).toBe(false);
    expect(play(1, 6).over).toBe(true);

    // Same game, one extra idle wage a day for the whole campaign.
    expect(four.copies).toBe(three.copies);
    expect(four.published.map((s) => s.id)).toEqual(three.published.map((s) => s.id));
    expect(four.cashPence).toBe(three.cashPence - CALIBRATION_DAYS * WAGE_PENCE_PER_DAY);
  });

  it('gives an idle paper months rather than days or a whole year', () => {
    // The clock has to be long enough to be a decision and short enough to be a
    // pressure. Bounds from the design, not from a run — but the design's own
    // sense of "long enough" moved with the margin: at 0.25 an idle paper had
    // 112 days, and it now has 228. Still inside the simulated year, which is
    // the part that matters: standing still always ends the campaign.
    const idle = play(0).day;
    expect(idle).toBeGreaterThan(60);
    expect(idle).toBeLessThan(CALIBRATION_DAYS);
  });

  it('grows a working paper rather than merely keeping it alive', () => {
    const end = play(1);
    expect(end.copies).toBeGreaterThan(20_000);
    expect(end.cashPence).toBeGreaterThan(0);
  });
});

describe('the calibration', () => {
  it('closes an idle paper on the measured days', () => {
    expect(play(0).day).toBe(228);
    expect(play(0, 4).day).toBe(113);
    expect(play(0, 6).day).toBe(30);
  });

  it('carries a worked paper through the year on the measured figures', () => {
    const end = play(1);
    expect(end.day).toBe(CALIBRATION_DAYS);
    expect(Math.round(end.copies)).toBe(22_579);
    expect(end.published).toHaveLength(36);
    expect(end.cashPence).toBe(7_856_960);
  });

  it('closes an over-staffed paper on the measured days', () => {
    // A worked paper now carries four reporters through the year; six still
    // close it, and sooner than an idle six because the cultivating costs money
    // the circulation never earns back.
    expect(play(1, 4).day).toBe(CALIBRATION_DAYS);
    expect(play(1, 6).day).toBe(25);
    expect(play(1, 6).day).toBeLessThan(play(0, 6).day);
  });

  it('pins the constants the runs above cannot reach', () => {
    // Mutation testing found these three invisible: an order of magnitude on
    // any of them left every test green, because no campaign here approaches a
    // bound or runs out of money at the moment of hiring.
    expect(COPIES_CEILING).toBe(80_000);
    expect(COPIES_FLOOR).toBe(2_000);
    expect(HIRE_COST_PENCE).toBe(5_000);
    // Moves with MARGIN_SHARE, and deliberately so: a bigger margin with
    // unchanged bills would be a second, unmeasured change to the economy.
    expect(billBasisPence()).toBe(14_000);
  });
});

describe('the other six sources', () => {
  // Relations first, as everywhere else here. The figures beneath them come from
  // `npx vite-node scripts/simulate.ts`.

  it('keeps a paper alive on almost nothing, and no more than alive', () => {
    // The old claim — the wire closes you, just later — is NOT dead at this
    // margin. It moved: the wire used to close you on day 138 and now closes you
    // on day 419. Everything in this file is measured over CALIBRATION_DAYS, so
    // `over === false` at day 400 says the paper is still solvent at the horizon
    // and nothing more. Read alone it would be a claim about the economy that
    // the economy does not make, so the real closing day is asserted under it.
    //
    // The point survives intact, and is the better half of it. 399 wire items in
    // 400 days for £687 of cash and a circulation that has more than halved:
    // subsistence, and nothing that could ever reach the ceiling.
    const wire = play(0, 3, { wire: true });
    expect(wire.over).toBe(false);
    expect(wire.won).toBe(false);
    expect(wire.published).toHaveLength(399);
    expect(Math.round(wire.copies)).toBe(8_952);
    expect(wire.cashPence).toBe(68_729);
    expect(wire.copies).toBeLessThan(20_000);

    // Run past the horizon and the wire still closes you. Without this the
    // assertion above measures where the simulation stops, not the game.
    const past = playPolicy(pool, 0, { reporters: 3 }, 420, { wire: true });
    expect(past.over).toBe(true);
    expect(past.won).toBe(false);
    expect(past.day).toBe(419);
  });

  it('never lets an advertorial keep a paper alive', () => {
    const ads = play(0, 3, { advertorial: true });
    expect(ads.over).toBe(true);
    expect(ads.won).toBe(false);
    expect(ads.day).toBe(198);
  });

  it('leaves an advertorial paper richer and less read than one that prints nothing', () => {
    // Compared on the earlier of the two closing days, which is the idle one.
    const idle = play(0);
    const ads = playPolicy(pool, 0, { reporters: 3 }, idle.day, { advertorial: true });
    expect(ads.cashPence).toBeGreaterThan(idle.cashPence);
    expect(ads.copies).toBeLessThan(idle.copies);
  });

  it('makes checking a tip cost days rather than buy survival', () => {
    // The claim inverted, and the inversion is the finding. At 0.25 both
    // policies closed and checking bought 15 days of life. Now both WIN, and
    // checking costs 19 days: the gambler reaches the ceiling on day 80, the
    // careful paper on day 99. Verifying a tip is a real trade with a price,
    // which is what it should have been all along — it was never a free good.
    const every: PolicyUses = { wire: true, stringer: true, advertorial: true, unbidden: true };
    const blind = play(1, 3, every);
    const careful = play(1, 3, { ...every, checkTips: true });

    expect(blind.won).toBe(true);
    expect(blind.day).toBe(80);
    expect(careful.won).toBe(true);
    expect(careful.day).toBe(99);
    expect(careful.day).toBeGreaterThan(blind.day);

    // What checking buys instead of speed: the careful paper prints more, having
    // thrown away the tips that did not stand up rather than run them.
    expect(careful.published.length).toBeGreaterThan(blind.published.length);

    // Without this the test passed while `pick` filtered every tip out of a
    // checking policy, so what it measured was not printing tips at all — 36
    // checks paid for, 15 standing up, none ever run.
    expect(careful.published.some((s) => s.source === 'tip')).toBe(true);
  });

  it('takes a paper that uses everything all the way to the ceiling', () => {
    // Was `survives` at 79,840 copies, then day 48, then day 41 as each measured
    // fix landed. It now wins — and this is the row the six sources were added
    // for. `investigations 3r 1c` below, the archive alone, never gets here.
    const mixed = play(1, 3, {
      wire: true,
      stringer: true,
      advertorial: true,
      checkTips: true,
      unbidden: true,
    });
    expect(mixed.over).toBe(true);
    expect(mixed.won).toBe(true);
    expect(mixed.day).toBe(99);
    expect(mixed.copies).toBe(COPIES_CEILING);
    expect(mixed.cashPence).toBe(1_265_930);
  });

  /** Days whose issue held more than one story, read off the ledger. */
  const multiStoryDays = (state: PaperState): number => {
    const perDay = new Map<number, number>();
    for (const entry of state.ledger) {
      if (entry.text.startsWith('Published ')) {
        perDay.set(entry.day, (perDay.get(entry.day) ?? 0) + 1);
      }
    }
    return [...perDay.values()].filter((n) => n > 1).length;
  };

  it('gets to fill the inside on a handful of days, and pays for the privilege', () => {
    // At 0.25 this filled on ONE day in a campaign that closed either way, and
    // the feature was reported as landing on nothing. A longer campaign gives it
    // five — but it is still not free: the inside costs 14 days, because a hand
    // spent writing is a hand not putting somebody on a lead.
    const every = { wire: true, stringer: true, advertorial: true, checkTips: true, unbidden: true };
    const careful = play(1, 3, every);
    const multi = play(1, 3, { ...every, multiStory: true });

    expect(multiStoryDays(careful)).toBe(0);
    expect(multiStoryDays(multi)).toBe(5);
    expect(multi.won).toBe(true);
    expect(multi.day).toBe(113);
    expect(multi.day).toBeGreaterThan(careful.day);
    expect(multi.published.length).toBe(63);
    expect(multi.cashPence).toBe(1_434_219);
  });

  it('turns the inside into a liability once the newsroom is bigger', () => {
    // The old claim — `multiStory` is inert at four and six reporters, so the
    // runs are bit-identical — is half dead, and the half that died is the more
    // interesting one.
    //
    // At SIX it is still inert: zero fills, identical run, both closing on day
    // 13 before a second runnable story ever reaches the desk.
    const every = { wire: true, stringer: true, advertorial: true, checkTips: true, unbidden: true };
    const off6 = play(1, 6, every);
    const on6 = play(1, 6, { ...every, multiStory: true });
    expect(multiStoryDays(on6)).toBe(0);
    expect(on6.day).toBe(off6.day);
    expect(on6.cashPence).toBe(off6.cashPence);

    // At FOUR it fires exactly once, on day 15, and that single inside story
    // loses the campaign: without it the paper wins on day 68, with it the paper
    // closes on day 26. The extra story earns 184p on the day and costs a
    // reporter plus a bill later, and the run never recovers the lead it did not
    // pick up. Recorded rather than tuned away — this is the shared reporter
    // budget doing exactly what it was built to do, at a staffing that cannot
    // absorb it.
    const off4 = play(1, 4, every);
    const on4 = play(1, 4, { ...every, multiStory: true });
    expect(multiStoryDays(on4)).toBe(1);
    expect(off4.won).toBe(true);
    expect(off4.day).toBe(68);
    expect(on4.won).toBe(false);
    expect(on4.over).toBe(true);
    expect(on4.day).toBe(26);
  });

  it('leaves the archive-only economy recognisable, at its new margin', () => {
    // Was `leaves the existing economy exactly where it was`, written for #9 to
    // prove that feature changed nothing. This change is SUPPOSED to move these
    // numbers, so the test now guards the shape rather than the old figures: an
    // idle paper still closes, a worked one still clears the archive and banks
    // money, and neither reaches the ceiling.
    //
    // The load-bearing line is `play(1)`, not `play(0)`. `play(0)` never
    // publishes anything at all, so it exercises none of the publish path and
    // proves nothing about writing costing a reporter. `play(1)` does: it runs
    // at zero headroom on nearly every one of its 36 publish days, so any
    // further leak out of the shared budget would move these numbers.
    expect(play(0).over).toBe(true);
    expect(play(0).won).toBe(false);
    expect(play(0).day).toBe(228);

    expect(play(1).over).toBe(false);
    expect(play(1).published).toHaveLength(36);
    expect(play(1).cashPence).toBe(7_856_960);
  });
});

/**
 * Every row of the printed table, and the shape it is supposed to have.
 *
 * `RUNS` is imported from `src/runs.ts` rather than from `scripts/simulate.ts`,
 * which would run the whole fourteen-policy simulation and print fifteen lines
 * at import time just to read an array.
 *
 * The expectations live here, keyed by name, so a policy added to the simulator
 * without one fails as a missing key rather than going quietly unchecked.
 */
describe('every calibration row', () => {
  interface Outcome {
    over: boolean;
    won: boolean;
    day: number;
  }

  const EXPECTED: Record<string, Outcome> = {
    nothing: { over: true, won: false, day: 228 },
    'nothing-4': { over: true, won: false, day: 113 },
    'nothing-6': { over: true, won: false, day: 30 },
    investigations: { over: false, won: false, day: CALIBRATION_DAYS },
    'investigations-4': { over: false, won: false, day: CALIBRATION_DAYS },
    'investigations-6': { over: true, won: false, day: 25 },
    'investigations-2c': { over: true, won: true, day: 109 },
    'wire-only': { over: false, won: false, day: CALIBRATION_DAYS },
    'advertorial-only': { over: true, won: false, day: 198 },
    'unbidden-only': { over: true, won: false, day: 170 },
    'stringer-only': { over: true, won: true, day: 114 },
    mixed: { over: true, won: true, day: 99 },
    'mixed-blind': { over: true, won: true, day: 80 },
    multi: { over: true, won: true, day: 113 },
  };

  /** The three rows that reach day 400 — the only ones D4 states figures for. */
  const SURVIVORS: Record<string, { copies: number; published: number; cashPence: number }> = {
    investigations: { copies: 22_579, published: 36, cashPence: 7_856_960 },
    'investigations-4': { copies: 22_579, published: 36, cashPence: 6_656_960 },
    'wire-only': { copies: 8_952, published: 399, cashPence: 68_729 },
  };

  const ended = RUNS.map(([name, reporters, cultivators, uses]) => ({
    name,
    end: playPolicy(pool, cultivators, { reporters }, CALIBRATION_DAYS, uses),
  }));

  it('has an expectation for every row the simulator prints', () => {
    expect(RUNS.map(([name]) => name).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(ended)('$name ends as measured', ({ name, end }) => {
    const want = EXPECTED[name];
    expect(want).toBeDefined();
    expect({ over: end.over, won: end.won, day: end.day }).toEqual(want);

    // Figures only for the rows that run the year out. For a row that closes or
    // wins, the day IS the outcome, and pinning copies and cash generated by the
    // build under test would pin nothing.
    const survivor = SURVIVORS[name];
    if (survivor !== undefined) {
      expect(Math.round(end.copies)).toBe(survivor.copies);
      expect(end.published).toHaveLength(survivor.published);
      expect(end.cashPence).toBe(survivor.cashPence);
    }
  });

  it('has three shapes of campaign, not one', () => {
    // The point of the margin change. Before it, thirteen of fourteen rows
    // closed and the fourteenth ran the year out; nothing could win at all.
    expect(ended.filter(({ end }) => end.won)).toHaveLength(5);
    expect(ended.filter(({ end }) => end.over && !end.won)).toHaveLength(6);
    expect(ended.filter(({ end }) => !end.over)).toHaveLength(3);
  });

  it('never wins on the archive alone', () => {
    // `investigations 3r 1c` is the one strategy that worked before any of this,
    // and it is stable and never reaches the ceiling. Winning needs the bought
    // and generated sources from #9, which is the first time those are worth
    // anything.
    const archive = ended.find(({ name }) => name === 'investigations')!.end;
    expect(archive.over).toBe(false);
    expect(archive.won).toBe(false);
    expect(archive.day).toBe(CALIBRATION_DAYS);
    expect(archive.copies).toBeLessThan(COPIES_CEILING);
  });

  it('closes an idle paper on a day the win condition cannot have touched', () => {
    // The independently derivable anchor. `nothing 3r 0c` publishes nothing and
    // never grows, so it can never approach the ceiling and D2 cannot reach it.
    // Day 228 is decided by the margin alone and was measured in the margin-only
    // sweep, before the win condition existed. If it moves, the win check has
    // leaked into a path it does not belong in.
    const idle = ended.find(({ name }) => name === 'nothing')!.end;
    expect(idle.day).toBe(228);
    expect(idle.won).toBe(false);
    expect(idle.published).toHaveLength(0);
    // Against START_COPIES, not COPIES_CEILING. An idle paper opens at 20,000
    // and only ever decays, so `< COPIES_CEILING` (80,000) cannot fail under any
    // implementation and asserted nothing. What the ceiling is unreachable
    // FROM is the opening circulation, so that is what the bound is stated
    // against.
    expect(idle.copies).toBeLessThan(START_COPIES);
  });

  // `outcomeLine` was a ternary inline in `scripts/simulate.ts`, where nothing
  // could reach it: swapping its two branches left all tests green and `tsc`
  // clean while the table silently printed five wins as bankruptcies. The
  // ordering is the only thing in the script worth getting wrong, so it lives in
  // `src/runs.ts` where a test can hold it.

  it('reads a won paper as won, not as broke', () => {
    // A won paper is ALSO over. This is the state that tells the two orderings
    // apart, and the only one that does.
    const won = ended.find(({ name }) => name === 'mixed')!.end;
    expect(won.over).toBe(true);
    expect(won.won).toBe(true);
    expect(outcomeLine(won)).toBe('won on day 99');
  });

  it('reads a closed paper as broke', () => {
    const broke = ended.find(({ name }) => name === 'nothing')!.end;
    expect(outcomeLine(broke)).toBe('broke on day 228');
  });

  it('reads a paper still running at the horizon as surviving', () => {
    const alive = ended.find(({ name }) => name === 'investigations')!.end;
    expect(alive.over).toBe(false);
    expect(outcomeLine(alive)).toBe('survives: 22,579 copies, 36 published, £78,569.60');
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
