import { describe, expect, it } from 'vitest';
import type { Playable } from '../../src/feed';
import {
  ADVERTORIAL_GROWTH,
  ADVERTORIAL_PENCE,
  FOLLOW_GROWTH,
  FOLLOW_TRIGGERS,
  HEADLINE_WORDS,
  PLANT_DELAY_DAYS,
  PLANT_EVERY_DAYS,
  PLANT_GROWTH,
  STORY_SHELF_DAYS,
  STRINGER_DELAY_DAYS,
  STRINGER_GROWTH,
  STRINGER_PENCE,
  TIP_CHECK_DAYS,
  TIP_EVERY_DAYS,
  TIP_FALSE_DELAY_DAYS,
  TIP_FALSE_GROWTH,
  TIP_TRUE_GROWTH,
  TIP_TRUE_PERCENT,
  WIRE_GROWTH,
  WIRE_PENCE_PER_DAY,
  dayHasPlant,
  dayHasTip,
  fnv1a,
  headlineFor,
  advertorialStory,
  followStory,
  plantedStory,
  stringerStory,
  tipIsTrue,
  tipStory,
  wireStory,
} from '../../src/sources';
import {
  COPIES_CEILING,
  COPIES_FLOOR,
  COVER_PRICE_PENCE,
  INVESTIGATION_DAYS,
  IDLE_DECAY,
  MARGIN_SHARE,
  MIN_REPORTERS,
  PUBLISH_GROWTH,
  START_REPORTERS,
  SOURCE_STEPS_TO_LEAD,
  STARTING_SOURCES,
  WAGE_PENCE_PER_DAY,
  playDay,
  startPaper,
  type Action,
  type PaperState,
} from '../../src/paper';

function episode(slug: string, lever: string, issues = 3): Playable {
  return {
    slug,
    title: slug,
    year: 1931,
    place: 'London',
    lever,
    desk: 'A situation.',
    voices: [
      { who: 'a', says: 'x', trust: 'y', doubt: 'z' },
      { who: 'b', says: 'x', trust: 'y', doubt: 'z' },
    ],
    unverifiable: 'Something unknowable.',
    print: { now: 'runs', later: 'the bill', issues },
    hold: { now: 'held', later: 'the other cost', issues },
  };
}

const POOL = [episode('a-story', 'access'), episode('b-story', 'money'), episode('c-story', 'law')];

const step = (state: PaperState, actions: Action[] = [], pool = POOL): PaperState => {
  const next = playDay(state, pool, actions);
  return next.over ? next : { ...next, day: next.day + 1 };
};

const line = (s: PaperState, text: string) => s.ledger.find((l) => l.text === text);
const ids = (s: PaperState) => s.available.map((a) => a.id);

/**
 * The bounds the issue puts on every constant.
 *
 * Asserted against the constants they reference rather than against literals, so
 * tuning a value cannot quietly break the relation it was supposed to respect.
 * The advertorial's bound is the one that mattered: it was satisfied at £70 and
 * still produced a paper that never closed, because it describes the endgame at
 * the circulation floor and says nothing about the surplus banked on the way
 * there. Only running it found that.
 */
describe('the constants stay inside their bounds', () => {
  const floorTakings = Math.round(COPIES_FLOOR * COVER_PRICE_PENCE * MARGIN_SHARE);

  it('prices the wire below a reporter and keeps it below break-even', () => {
    expect(WIRE_PENCE_PER_DAY).toBeGreaterThan(0);
    expect(WIRE_PENCE_PER_DAY).toBeLessThan(WAGE_PENCE_PER_DAY);
    expect(WIRE_GROWTH).toBeGreaterThan(1 - IDLE_DECAY);
    expect(WIRE_GROWTH).toBeLessThan(1);
  });

  it('keeps every generated story below an investigation', () => {
    for (const growth of [PLANT_GROWTH, STRINGER_GROWTH, TIP_TRUE_GROWTH]) {
      expect(growth).toBeGreaterThan(1);
      expect(growth).toBeLessThan(1 + PUBLISH_GROWTH);
    }
    expect(FOLLOW_GROWTH).toBeGreaterThan(1 - IDLE_DECAY);
    expect(FOLLOW_GROWTH).toBeLessThanOrEqual(WIRE_GROWTH);
  });

  it('makes a plant the latest bill in the game', () => {
    const longest = Math.max(...POOL.map((e) => e.print.issues));
    expect(PLANT_DELAY_DAYS).toBeGreaterThan(longest);
    expect(PLANT_DELAY_DAYS).toBeLessThan(60);
    expect(STRINGER_DELAY_DAYS).toBeLessThan(PLANT_DELAY_DAYS);
    expect(TIP_FALSE_DELAY_DAYS).toBeLessThan(PLANT_DELAY_DAYS);
  });

  it('prices a bought story in days of payroll', () => {
    expect(STRINGER_PENCE).toBeGreaterThan(3 * WAGE_PENCE_PER_DAY);
    expect(STRINGER_PENCE).toBeLessThan(10 * WAGE_PENCE_PER_DAY);
  });

  it('makes a lie worse than printing nothing, and checking cheaper than investigating', () => {
    expect(TIP_FALSE_GROWTH).toBeLessThan(1 - IDLE_DECAY);
    expect(TIP_CHECK_DAYS).toBeGreaterThan(0);
    expect(TIP_CHECK_DAYS).toBeLessThan(INVESTIGATION_DAYS);
    expect(TIP_TRUE_PERCENT).toBeGreaterThanOrEqual(40);
    expect(TIP_TRUE_PERCENT).toBeLessThanOrEqual(70);
  });

  it('never lets an advertorial pay the wages', () => {
    expect(ADVERTORIAL_PENCE + floorTakings).toBeLessThan(START_REPORTERS * WAGE_PENCE_PER_DAY);
    expect(ADVERTORIAL_GROWTH).toBeGreaterThan(TIP_FALSE_GROWTH);
    expect(ADVERTORIAL_GROWTH).toBeLessThan(1);
  });

  it('keeps a story on the desk longer than it takes to make one', () => {
    expect(STORY_SHELF_DAYS).toBeGreaterThan(INVESTIGATION_DAYS);
    expect(STORY_SHELF_DAYS).toBeLessThan(30);
  });
});

describe('generated copy names nobody', () => {
  /**
   * Every headline the vocabulary can produce, in the one order it produces
   * them.
   *
   * Rebuilt rather than parsed: the old version split the headline on a hand-
   * written regex and then checked the first phrase against the union of all
   * three lists, so a headline whose `who` came from the `which` list passed.
   * Membership of the exact product set is the claim the module's docstring
   * actually makes.
   */
  const buildable = new Set<string>();
  for (const who of HEADLINE_WORDS.who) {
    for (const what of HEADLINE_WORDS.what) {
      for (const which of HEADLINE_WORDS.which) buildable.add(`${who} ${what} ${which}`);
    }
  }

  it('builds every headline from the vocabulary and nothing else', () => {
    // Over 400 days of every generated source, not just three of them.
    expect(buildable.has(advertorialStory().headline)).toBe(true);
    for (let day = 1; day <= 400; day += 1) {
      for (const story of [
        wireStory(day),
        plantedStory(day),
        stringerStory(day),
        tipStory(day),
        followStory(day),
      ]) {
        expect(buildable.has(story.headline)).toBe(true);
      }
    }
  });

  it('is deterministic in the id and nothing else', () => {
    expect(headlineFor('tip-11')).toBe(headlineFor('tip-11'));
    expect(headlineFor('tip-11')).not.toBe(headlineFor('tip-22'));
  });

  it('hashes the same way every time', () => {
    expect(fnv1a('')).toBe(2166136261);
    expect(fnv1a('a')).toBe(fnv1a('a'));
    expect(tipIsTrue('tip-11')).toBe(tipIsTrue('tip-11'));
  });
});

describe('arrivals are cadences, not chances', () => {
  it('plants and tips land on their own days', () => {
    expect(dayHasPlant(PLANT_EVERY_DAYS)).toBe(true);
    expect(dayHasPlant(PLANT_EVERY_DAYS - 1)).toBe(false);
    expect(dayHasTip(TIP_EVERY_DAYS)).toBe(true);
    expect(dayHasTip(TIP_EVERY_DAYS - 1)).toBe(false);
  });
});

describe('the wire', () => {
  it('charges every day and offers exactly one item, never a pile', () => {
    let paper = step(startPaper(), [{ kind: 'subscribe' }]);
    expect(line(paper, 'On the wire')).toBeDefined();

    for (let i = 0; i < 5; i += 1) paper = step(paper);
    expect(paper.available.filter((s) => s.source === 'wire')).toHaveLength(1);
    expect(line(paper, 'The wire')?.pence).toBe(-WIRE_PENCE_PER_DAY);
  });

  it('clears its last item when the subscription is dropped', () => {
    let paper = step(startPaper(), [{ kind: 'subscribe' }]);
    paper = step(paper);
    expect(ids(paper).some((id) => id.startsWith('wire-'))).toBe(true);
    paper = step(paper, [{ kind: 'unsubscribe' }]);
    expect(ids(paper).some((id) => id.startsWith('wire-'))).toBe(false);
  });

  it('refuses a second subscription and a drop that is not on', () => {
    const twice = step(startPaper(), [{ kind: 'subscribe' }, { kind: 'subscribe' }]);
    expect(line(twice, 'Already on the wire.')).toBeDefined();
    const off = step(startPaper(), [{ kind: 'unsubscribe' }]);
    expect(line(off, 'Not on the wire.')).toBeDefined();
  });

  it('cannot be taken on an empty till, and charges nothing when refused', () => {
    // Wages come out first, so the till has to hold a day of them as well.
    const opening = WAGE_PENCE_PER_DAY * START_REPORTERS + WIRE_PENCE_PER_DAY - 1;
    const after = step(startPaper({ cashPence: opening }), [{ kind: 'subscribe' }]);
    expect(line(after, 'Cannot afford it.')).toBeDefined();
    expect(after.subscribed).toBe(false);
    expect(line(after, 'The wire')).toBeUndefined();
  });
});

describe('the advertorial', () => {
  it('is there from the first morning and never leaves', () => {
    let paper = startPaper();
    expect(ids(paper)).toContain('advertorial');
    paper = step(paper, [{ kind: 'publish', id: 'advertorial' }]);
    expect(ids(paper)).toContain('advertorial');
    paper = step(paper, [{ kind: 'publish', id: 'advertorial' }]);
    expect(paper.published.filter((s) => s.id === 'advertorial')).toHaveLength(2);
  });

  it('pays on the day it runs and costs readers', () => {
    const before = startPaper();
    const after = step(before, [{ kind: 'publish', id: 'advertorial' }]);
    expect(line(after, 'Published advertorial')?.pence).toBe(ADVERTORIAL_PENCE);
    expect(after.copies).toBeCloseTo(before.copies * ADVERTORIAL_GROWTH, 6);
  });
});

describe('the stringer', () => {
  it('charges at once and delivers the next morning', () => {
    const after = step(startPaper(), [{ kind: 'buy-stringer' }]);
    expect(line(after, 'Bought a story')?.pence).toBe(-STRINGER_PENCE);
    expect(ids(after).some((id) => id.startsWith('stringer-'))).toBe(true);
  });

  it('sells one a day', () => {
    const after = step(startPaper(), [{ kind: 'buy-stringer' }, { kind: 'buy-stringer' }]);
    expect(line(after, 'One a day from the stringer.')).toBeDefined();
  });

  it('cannot be bought on an empty till, and delivers nothing when refused', () => {
    const opening = WAGE_PENCE_PER_DAY * START_REPORTERS + STRINGER_PENCE - 1;
    const after = step(startPaper({ cashPence: opening }), [{ kind: 'buy-stringer' }]);
    expect(line(after, 'Cannot afford it.')).toBeDefined();
    expect(line(after, 'Bought a story')).toBeUndefined();
    expect(ids(after).some((id) => id.startsWith('stringer-'))).toBe(false);
  });
});

describe('a tip', () => {
  // Bounded, not `while`: `step` stops advancing `day` once the paper closes,
  // so anything that shuts a paper before the first tip would turn this into an
  // infinite loop that hangs CI instead of a test that fails with a message.
  const withTip = (): PaperState => {
    let paper = startPaper();
    for (let i = 0; i <= TIP_EVERY_DAYS + 1 && !ids(paper).some((id) => id.startsWith('tip-')); i += 1) {
      paper = step(paper);
    }
    expect(ids(paper).some((id) => id.startsWith('tip-'))).toBe(true);
    return paper;
  };

  it('arrives unchecked', () => {
    const paper = withTip();
    expect(paper.available.find((s) => s.source === 'tip')?.unverified).toBe(true);
  });

  it('can be checked, and a false one is taken off the desk', () => {
    let paper = withTip();
    const tip = paper.available.find((s) => s.source === 'tip')!;
    paper = step(paper, [{ kind: 'check', id: tip.id }]);
    expect(paper.checking).toHaveLength(1);

    for (let i = 0; i < TIP_CHECK_DAYS; i += 1) paper = step(paper);

    if (tipIsTrue(tip.id)) {
      expect(paper.available.find((s) => s.id === tip.id)?.unverified).toBe(false);
      expect(line(paper, `${tip.id} stands up`)).toBeDefined();
    } else {
      expect(ids(paper)).not.toContain(tip.id);
      expect(line(paper, 'Nothing in it after all.')).toBeDefined();
    }
  });

  it('can be run while it is being checked, which drops the check', () => {
    let paper = withTip();
    const tip = paper.available.find((s) => s.source === 'tip')!;
    paper = step(paper, [{ kind: 'check', id: tip.id }]);
    expect(paper.checking).toHaveLength(1);
    paper = step(paper, [{ kind: 'publish', id: tip.id }]);
    expect(paper.checking).toHaveLength(0);
    expect(paper.published.map((s) => s.id)).toContain(tip.id);
  });

  it('refuses a check on anything else, and a second check on itself', () => {
    let paper = withTip();
    const tip = paper.available.find((s) => s.source === 'tip')!;
    const twice = step(paper, [
      { kind: 'check', id: tip.id },
      { kind: 'check', id: tip.id },
    ]);
    expect(line(twice, 'Already looking into it.')).toBeDefined();
    expect(line(step(paper, [{ kind: 'check', id: 'advertorial' }]), 'Nothing to check.')).toBeDefined();
  });

  it('occupies a reporter while it runs', () => {
    let paper = withTip();
    const tip = paper.available.find((s) => s.source === 'tip')!;
    const before = paper.reporters - paper.running.length - paper.checking.length;
    paper = step(paper, [{ kind: 'check', id: tip.id }]);
    expect(paper.reporters - paper.running.length - paper.checking.length).toBe(before - 1);
  });

  /**
   * The payoff side of the gamble, which had no test at all.
   *
   * `tip-11` is the first tip a campaign ever offers and it is false, so a test
   * that branches on `tipIsTrue` at runtime only ever runs the losing path —
   * the previous version did exactly that, and would have passed with
   * `tipIsTrue` hardwired to `false`. `tip-33` is the first true one; both are
   * pinned below so a change to the hash fails here rather than silently
   * swapping which branch is covered.
   */
  it('has a first tip that is false and a third that is true', () => {
    expect(tipIsTrue('tip-11')).toBe(false);
    expect(tipIsTrue('tip-33')).toBe(true);
  });

  it('stands up when it is true, and keeps its place on the desk', () => {
    let paper = startPaper();
    for (let i = 0; i < 40 && !ids(paper).includes('tip-33'); i += 1) paper = step(paper);
    expect(ids(paper)).toContain('tip-33');

    paper = step(paper, [{ kind: 'check', id: 'tip-33' }]);
    for (let i = 0; i < TIP_CHECK_DAYS; i += 1) paper = step(paper);

    expect(paper.available.find((s) => s.id === 'tip-33')?.unverified).toBe(false);
    expect(line(paper, 'tip-33 stands up')).toBeDefined();
  });

  it('pays a true tip like a bought story and bills nothing', () => {
    let paper = startPaper();
    for (let i = 0; i < 40 && !ids(paper).includes('tip-33'); i += 1) paper = step(paper);
    paper = step(paper, [{ kind: 'check', id: 'tip-33' }]);
    for (let i = 0; i < TIP_CHECK_DAYS; i += 1) paper = step(paper);

    const bills = paper.bills.length;
    const after = playDay(paper, POOL, [{ kind: 'publish', id: 'tip-33' }]);
    // Growth is applied before the clamp, so compare against the unclamped
    // product rather than assuming the ceiling is out of reach.
    expect(after.copies).toBeCloseTo(
      Math.min(paper.copies * TIP_TRUE_GROWTH, COPIES_CEILING),
      6,
    );
    // A tip that stood up carries no consequence, so nothing is queued.
    expect(after.bills).toHaveLength(bills);
  });

  it('refuses a check with no time left in the tip', () => {
    // The guard exists because the resolution step used to drop such a check
    // without a word: a reporter held for two days, nothing in the ledger, and
    // no way for the player to find out why.
    let paper = withTip();
    const tip = paper.available.find((s) => s.source === 'tip')!;
    while (paper.day + TIP_CHECK_DAYS < tip.offeredOn + STORY_SHELF_DAYS) paper = step(paper);

    const after = step(paper, [{ kind: 'check', id: tip.id }]);
    expect(line(after, 'There is no time left in it.')).toBeDefined();
    expect(after.checking).toHaveLength(0);
  });

  it('refuses a check when every reporter is spoken for', () => {
    let paper = withTip();
    const tip = paper.available.find((s) => s.source === 'tip')!;
    const after = step(paper, [
      ...STARTING_SOURCES.map((sourceId) => ({ kind: 'cultivate', sourceId }) as Action),
      { kind: 'check', id: tip.id },
    ]);
    expect(line(after, 'Nobody spare to check it.')).toBeDefined();
    expect(after.checking).toHaveLength(0);
  });

  it('is called off by name when a reporter goes and no investigation can be given up', () => {
    // The `else if` branch inside `fire`: reachable only with nobody free and
    // nothing running, so the check is the only thing left to surrender.
    let paper = withTip();
    paper = { ...paper, reporters: MIN_REPORTERS + 1 };
    const tip = paper.available.find((s) => s.source === 'tip')!;
    paper = step(paper, [{ kind: 'check', id: tip.id }]);
    expect(paper.checking).toHaveLength(1);
    expect(paper.running).toHaveLength(0);

    // Three cultivating plus one checking accounts for all four.
    const after = step(paper, [
      ...STARTING_SOURCES.map((sourceId) => ({ kind: 'cultivate', sourceId }) as Action),
      { kind: 'fire' },
    ]);
    expect(after.checking).toHaveLength(0);
    expect(line(after, `Called off the check on ${tip.id}.`)).toBeDefined();
    // The work is lost, not the story.
    expect(after.available.find((s) => s.id === tip.id)?.unverified).toBe(true);
  });
});

describe('the follow-up', () => {
  it('is armed by a story left unrun', () => {
    // The positive case, which had no test: the block below asserted only
    // `<= 1`, which passes just as well if a follow-up never arrives at all.
    //
    // The first trigger a quiet campaign ever sees is the tip on day
    // TIP_EVERY_DAYS, not the plant — the advertorial sits on the desk from the
    // first morning and is deliberately not a trigger.
    let paper = startPaper();
    for (let i = 0; i < TIP_EVERY_DAYS; i += 1) paper = step(paper);
    expect(ids(paper)).toContain(`tip-${TIP_EVERY_DAYS}`);
    expect(paper.available.filter((s) => s.source === 'follow')).toHaveLength(0);

    // The tip sits unrun, so somebody else runs it.
    paper = step(paper);
    expect(paper.available.filter((s) => s.source === 'follow')).toHaveLength(1);
    expect(ids(paper)).toContain(`follow-${TIP_EVERY_DAYS + 1}`);
    expect(line(paper, 'Somebody else ran it')).toBeDefined();
  });

  it('never arms another follow-up, and never doubles', () => {
    let paper = startPaper();
    for (let i = 0; i < 60; i += 1) {
      paper = step(paper);
      expect(paper.available.filter((s) => s.source === 'follow').length).toBeLessThanOrEqual(1);
    }
  });

  it('is not in its own trigger set', () => {
    expect(FOLLOW_TRIGGERS).not.toContain('follow');
    expect([...FOLLOW_TRIGGERS].sort()).toEqual(['investigation', 'planted', 'stringer', 'tip']);
  });
});

describe('the shelf', () => {
  it('takes old news off the desk and leaves the advertorial alone', () => {
    let paper = startPaper();
    for (let i = 0; i < STORY_SHELF_DAYS + PLANT_EVERY_DAYS + 2; i += 1) paper = step(paper);
    expect(line(paper, `planted-${PLANT_EVERY_DAYS} is old news.`)).toBeDefined();
    expect(ids(paper)).toContain('advertorial');
  });

  it('never ages an investigation out', () => {
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    for (let i = 0; i < INVESTIGATION_DAYS + STORY_SHELF_DAYS + 2; i += 1) paper = step(paper);
    expect(ids(paper)).toContain('a-story');
  });
});
