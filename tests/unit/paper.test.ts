import { describe, expect, it } from 'vitest';
import type { Playable } from '../../src/feed';
import {
  ACCESS_FACTOR,
  BILL_BASIS_COPIES,
  COPIES_CEILING,
  COPIES_FLOOR,
  billBasisPence,
  HIRE_COST_PENCE,
  IDLE_DECAY,
  INSIDE_SHARE,
  issueGrowth,
  INVESTIGATION_DAYS,
  LAW_COST_MULTIPLE,
  LEVERS,
  MARGIN_SHARE,
  MIN_REPORTERS,
  MONEY_COST_MULTIPLE,
  playDay,
  PUBLISH_GROWTH,
  runCampaign,
  SOURCE_STEP_PENCE,
  SOURCE_STEPS_TO_LEAD,
  START_CASH_PENCE,
  START_COPIES,
  COVER_PRICE_PENCE,
  START_REPORTERS,
  startPaper,
  STARTING_SOURCES,
  validatePool,
  WAGE_PENCE_PER_DAY,
  type Action,
  type PaperState,
} from '../../src/paper';
import { ADVERTORIAL_ID, type Story, type StorySource } from '../../src/sources';

/** Only `slug`, `lever` and the print delay matter here; the prose makes it a real `Playable`. */
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

/** Advance a day the way `runCampaign` does, so tests read like play. */
const step = (state: PaperState, actions: Action[] = [], pool = POOL): PaperState => {
  const next = playDay(state, pool, actions);
  return next.over ? next : { ...next, day: next.day + 1 };
};

const line = (state: PaperState, text: string) => state.ledger.find((l) => l.text === text);

describe('opening a paper', () => {
  it('starts on day one with the era standard price', () => {
    const paper = startPaper();
    expect(paper.day).toBe(1);
    expect(paper.cashPence).toBe(START_CASH_PENCE);
    expect(paper.copies).toBe(START_COPIES);
    expect(paper.reporters).toBe(START_REPORTERS);
    expect(paper.pricePence).toBe(COVER_PRICE_PENCE);
    expect(paper.sources.map((s) => s.id)).toEqual([...STARTING_SOURCES]);
  });

  it('refuses an opening that could never be played', () => {
    expect(() => startPaper({ reporters: 0 })).toThrow(RangeError);
    expect(() => startPaper({ reporters: 1.5 })).toThrow(RangeError);
    expect(() => startPaper({ cashPence: -1 })).toThrow(RangeError);
  });

  it('refuses to open below the floor `fire` enforces', () => {
    // The bound has to be MIN_REPORTERS, not 1. A paper of one or two is a
    // state the rules say is unreachable — and an unlosable one, since the
    // advertorial pays a flat fee against wages that scale with heads.
    for (let n = 1; n < MIN_REPORTERS; n += 1) {
      expect(() => startPaper({ reporters: n })).toThrow(RangeError);
    }
    expect(() => startPaper({ reporters: MIN_REPORTERS })).not.toThrow();
  });

  it('measures a bill in a day of takings, not in a day of cover price', () => {
    expect(billBasisPence()).toBe(
      Math.round(BILL_BASIS_COPIES * COVER_PRICE_PENCE * MARGIN_SHARE),
    );
  });

  it('is not set in a period: no campaign carries a decade', () => {
    // Decoupled on 2026-07-29. Episodes keep their real years because they are
    // real cases; the paper does not price itself from them.
    expect(startPaper()).not.toHaveProperty('decade');
  });
});

describe('a day', () => {
  it('pays every reporter whether or not they filed', () => {
    const after = step(startPaper());
    expect(line(after, 'Wages')?.pence).toBe(-START_REPORTERS * WAGE_PENCE_PER_DAY);
  });

  it('sells the paper at the day rate', () => {
    const after = step(startPaper());
    const expected = Math.round(after.copies * after.pricePence * MARGIN_SHARE);
    expect(line(after, 'Sales')?.pence).toBe(expected);
  });

  it('loses readers on a day with no story', () => {
    const after = step(startPaper());
    expect(after.copies).toBeCloseTo(START_COPIES * (1 - IDLE_DECAY), 6);
  });

  it('covers its wages at the opening size, and stops doing so as readers drift', () => {
    // D9: routine pays its way. A paper that does nothing is briefly solvent and
    // then is not, because circulation decays and the payroll does not.
    const day1 = step(startPaper());
    expect(day1.cashPence).toBeGreaterThan(START_CASH_PENCE);

    let paper = startPaper();
    for (let i = 0; i < 60; i += 1) paper = step(paper);
    const before = paper.cashPence;
    paper = step(paper);
    expect(paper.cashPence).toBeLessThan(before);
  });
});

describe('cultivating a source', () => {
  it('takes four days and then yields one lead', () => {
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD - 1; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
      expect(paper.leads).toHaveLength(0);
    }
    paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    expect(paper.leads.length + paper.running.length).toBe(1);
    expect(paper.sources.find((s) => s.id === 'council')?.steps).toBe(0);
  });

  it('costs money every step', () => {
    const after = step(startPaper(), [{ kind: 'cultivate', sourceId: 'council' }]);
    expect(line(after, 'Cultivated council')?.pence).toBe(-SOURCE_STEP_PENCE);
  });

  it('takes the lowest slug first, by code point and never by locale', () => {
    // 'B-story' sorts before 'a-story' by code point and after it under
    // localeCompare. The source comment calls that ordering load-bearing, and
    // before this test swapping the comparator left every test green.
    const mixed = [episode('a-story', 'access'), episode('B-story', 'money')];
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }], mixed);
    }
    expect(paper.running[0].slug).toBe('B-story');
  });

  it('leaves a spent source stuck at the threshold rather than promising more', () => {
    // It used to reset the counter before checking, so a spent archive showed
    // 0/4, 1/4, 2/4 for ever while charging for every step of it.
    let paper = startPaper({ cashPence: 100_000_000 });
    const one = [episode('a-story', 'access')];
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD * 3; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }], one);
    }
    expect(paper.sources.find((s) => s.id === 'council')?.steps).toBe(SOURCE_STEPS_TO_LEAD);
  });

  it('says so when the archive is spent', () => {
    let paper = startPaper();
    // Four cycles of four days against a three-episode pool.
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD * 4; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    expect(line(paper, 'No story in it.')).toBeDefined();
  });
});

describe('an investigation', () => {
  it('takes six days and then the story is available', () => {
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    const startedOn = paper.day - 1;
    expect(paper.running[0].readyOn).toBe(startedOn + INVESTIGATION_DAYS);

    for (let i = 0; i < INVESTIGATION_DAYS - 1; i += 1) paper = step(paper);
    expect(paper.available.filter((s) => s.source === 'investigation')).toHaveLength(0);
    paper = step(paper);
    expect(paper.available.map((s) => s.id)).toContain('a-story');
  });

  it('frees its reporter again on maturity', () => {
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    expect(paper.running).toHaveLength(1);
    for (let i = 0; i < INVESTIGATION_DAYS; i += 1) paper = step(paper);
    expect(paper.running).toHaveLength(0);
  });
});

describe('publishing', () => {
  const withStory = (): PaperState => {
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    for (let i = 0; i < INVESTIGATION_DAYS; i += 1) paper = step(paper);
    return paper;
  };

  it('grows circulation instead of shrinking it', () => {
    const ready = withStory();
    const before = ready.copies;
    const after = step(ready, [{ kind: 'publish', id: 'a-story' }]);
    expect(after.copies).toBeCloseTo(before * (1 + PUBLISH_GROWTH), 6);
    expect(after.published.map((s) => s.id)).toEqual(['a-story']);
  });

  it('runs a story once, however many times it is queued', () => {
    // An issue holds more than one story now, so a second publish is no longer
    // refused on principle. What stops a repeat is that the story left the desk
    // when it ran: the second attempt finds nothing there.
    const ready = withStory();
    const after = step(ready, [
      { kind: 'publish', id: 'a-story' },
      { kind: 'publish', id: 'a-story' },
    ]);
    expect(line(after, 'That story is not ready.')).toBeDefined();
    expect(after.published).toHaveLength(1);
  });

  it('refuses a story that is not ready', () => {
    const after = step(startPaper(), [{ kind: 'publish', id: 'a-story' }]);
    expect(line(after, 'That story is not ready.')).toBeDefined();
    expect(after.published).toHaveLength(0);
  });

  it('leaves an unpublished story on the desk indefinitely', () => {
    let paper = withStory();
    for (let i = 0; i < 10; i += 1) paper = step(paper);
    expect(paper.available.map((s) => s.id)).toContain('a-story');
  });
});

describe('a bill', () => {
  const publishOn = (lever: string): PaperState => {
    const pool = [episode('a-story', lever, 3)];
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }], pool);
    }
    for (let i = 0; i < INVESTIGATION_DAYS; i += 1) paper = step(paper, [], pool);
    return step(paper, [{ kind: 'publish', id: 'a-story' }], pool);
  };

  it('lands days later, not on the day it was earned', () => {
    let paper = publishOn('access');
    const atPublish = paper.copies;
    paper = step(paper, [], [episode('a-story', 'access', 3)]);
    paper = step(paper, [], [episode('a-story', 'access', 3)]);
    expect(paper.copies).toBeGreaterThan(atPublish * 0.97);
    paper = step(paper, [], [episode('a-story', 'access', 3)]);
    expect(line(paper, 'The bill for a-story')).toBeDefined();
  });

  it('bleeds circulation for access', () => {
    let paper = publishOn('access');
    const pool = [episode('a-story', 'access', 3)];
    const before = paper.copies;
    for (let i = 0; i < 3; i += 1) paper = step(paper, [], pool);
    expect(paper.copies).toBeLessThan(before * (1 - IDLE_DECAY) ** 3 * ACCESS_FACTOR * 1.001);
  });

  it('charges cash for money and more for law', () => {
    const pool = (lever: string) => [episode('a-story', lever, 3)];
    let money = publishOn('money');
    let law = publishOn('law');
    for (let i = 0; i < 3; i += 1) {
      money = step(money, [], pool('money'));
      law = step(law, [], pool('law'));
    }
    expect(line(money, 'The bill for a-story')?.pence).toBe(
      -Math.round(MONEY_COST_MULTIPLE * billBasisPence()),
    );
    expect(line(law, 'The bill for a-story')?.pence).toBe(
      -Math.round(LAW_COST_MULTIPLE * billBasisPence()),
    );
  });

  it('charges nothing for a lever the economy does not know', () => {
    const pool = [episode('a-story', 'bribery', 3)];
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }], pool);
    }
    for (let i = 0; i < INVESTIGATION_DAYS; i += 1) paper = step(paper, [], pool);
    paper = step(paper, [{ kind: 'publish', id: 'a-story' }], pool);
    for (let i = 0; i < 3; i += 1) paper = step(paper, [], pool);
    expect(line(paper, 'No charge for a-story.')).toBeDefined();
  });
});

describe('the payroll', () => {
  it('hires for a fee and the new reporter is free the same day', () => {
    const after = step(startPaper(), [{ kind: 'hire' }]);
    expect(after.reporters).toBe(START_REPORTERS + 1);
    expect(line(after, 'Hired a reporter')?.pence).toBe(-HIRE_COST_PENCE);
  });

  it('refuses to hire on an empty till', () => {
    const after = step(startPaper({ cashPence: WAGE_PENCE_PER_DAY * START_REPORTERS }), [
      { kind: 'hire' },
    ]);
    expect(line(after, 'Cannot afford the wage.')).toBeDefined();
    expect(after.reporters).toBe(START_REPORTERS);
  });

  it('will not go below the smallest newsroom the rules allow', () => {
    let paper = startPaper({ reporters: MIN_REPORTERS });
    paper = step(paper, [{ kind: 'fire' }]);
    expect(line(paper, `You cannot put out a daily with fewer than ${MIN_REPORTERS}.`)).toBeDefined();
    expect(paper.reporters).toBe(MIN_REPORTERS);
  });

  it('lets a free reporter go before touching an investigation', () => {
    let paper = startPaper({ reporters: MIN_REPORTERS + 1 });
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    expect(paper.running).toHaveLength(1);
    paper = step(paper, [{ kind: 'fire' }]);
    expect(paper.reporters).toBe(MIN_REPORTERS);
    expect(paper.running).toHaveLength(1);
  });

  it('cancels the newest investigation when nobody is free, and keeps the lead', () => {
    let paper = startPaper({ reporters: MIN_REPORTERS + 1 });
    // Every source worked in parallel, which is as many investigations as the
    // archive can carry: three sources, three episodes, three stories running.
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(
        paper,
        STARTING_SOURCES.map((sourceId) => ({ kind: 'cultivate', sourceId }) as Action),
      );
    }
    // One quiet day puts the queued leads on the reporters who were cultivating.
    paper = step(paper);
    expect(paper.running).toHaveLength(STARTING_SOURCES.length);

    // Three running plus one cultivating accounts for all four, so the fire
    // finds nobody free. Below the floor of three this state is unreachable —
    // it needs a fourth hand to spend.
    paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }, { kind: 'fire' }]);
    expect(paper.reporters).toBe(MIN_REPORTERS);
    expect(paper.running).toHaveLength(STARTING_SOURCES.length - 1);
    expect(paper.leads).toHaveLength(1);
  });
});

describe('the plan runs in the order it was written', () => {
  it('does not let a later action undo an earlier one', () => {
    // Three passes by kind made [work courts, let one go] and [let one go, work
    // courts] the same day, which is not what the screen promises.
    // Four reporters with three already on stories: exactly one is free, so the
    // order of [work courts] and [let one go] decides whether courts is worked.
    const busy = (): PaperState => {
      let paper = startPaper({ reporters: MIN_REPORTERS + 1 });
      for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
        paper = step(
          paper,
          STARTING_SOURCES.map((sourceId) => ({ kind: 'cultivate', sourceId }) as Action),
        );
      }
      return step(paper);
    };

    const a = step(busy(), [{ kind: 'cultivate', sourceId: 'courts' }, { kind: 'fire' }]);
    const b = step(busy(), [{ kind: 'fire' }, { kind: 'cultivate', sourceId: 'courts' }]);

    expect(a.sources.find((s) => s.id === 'courts')?.steps).toBe(1);
    expect(b.sources.find((s) => s.id === 'courts')?.steps).toBe(0);
  });
});

describe('refusals', () => {
  it('names an unknown source', () => {
    const after = step(startPaper(), [{ kind: 'cultivate', sourceId: 'the-palace' }]);
    expect(line(after, 'No such source.')).toBeDefined();
  });

  it('works a source once a day', () => {
    const after = step(startPaper(), [
      { kind: 'cultivate', sourceId: 'council' },
      { kind: 'cultivate', sourceId: 'council' },
    ]);
    expect(line(after, 'That source has had its day.')).toBeDefined();
  });

  it('needs a spare reporter for every source worked', () => {
    // "One reporter, two sources" is no longer an openable paper — the floor is
    // three. One reporter on an investigation leaves two free, so the third
    // source worked the same day has nobody to work it.
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    expect(paper.running).toHaveLength(1);

    const after = step(
      paper,
      STARTING_SOURCES.map((sourceId) => ({ kind: 'cultivate', sourceId }) as Action),
    );
    expect(line(after, 'Nobody spare to work it.')).toBeDefined();
  });

  it('cannot cultivate on an empty till', () => {
    const after = step(startPaper({ cashPence: WAGE_PENCE_PER_DAY * START_REPORTERS }), [
      { kind: 'cultivate', sourceId: 'council' },
    ]);
    expect(line(after, 'Cannot afford it.')).toBeDefined();
  });
});

describe('closing', () => {
  it('ends the day cash goes below zero and runs nothing after', () => {
    // Six reporters against an opening print run: the payroll outruns the sale.
    let paper = startPaper({ reporters: 6, cashPence: 0 });
    paper = step(paper);
    expect(paper.over).toBe(true);
    expect(line(paper, 'The paper has closed.')).toBeDefined();

    const before = { ...paper };
    const after = playDay(paper, POOL, [{ kind: 'hire' }]);
    expect(after.day).toBe(before.day);
    expect(after.cashPence).toBe(before.cashPence);
    expect(after.reporters).toBe(before.reporters);
  });
});

describe('circulation', () => {
  it('never leaves its band', () => {
    const days: Action[][] = Array.from({ length: 200 }, () => [
      { kind: 'cultivate', sourceId: 'council' },
    ]);
    for (const state of runCampaign(POOL, days)) {
      expect(state.copies).toBeGreaterThanOrEqual(COPIES_FLOOR);
      expect(state.copies).toBeLessThanOrEqual(COPIES_CEILING);
    }
  });

  it('stops at the ceiling however many stories run', () => {
    // Mutation testing found the clamp dead: no campaign in the suite came near
    // a bound, so deleting both clamp() calls left every test green. This drives
    // circulation into the ceiling deliberately.
    let paper = startPaper({ cashPence: 100_000_000 });
    paper.copies = COPIES_CEILING - 1;
    for (let i = 0; i < 20; i += 1) {
      paper = { ...playDay(paper, POOL, []), day: paper.day + 1 };
      paper.copies *= 1.5;
      paper = { ...playDay(paper, POOL, []), day: paper.day + 1 };
    }
    expect(paper.copies).toBe(COPIES_CEILING);
  });

  it('stops at the floor however long nobody publishes', () => {
    let paper = startPaper({ cashPence: 100_000_000 });
    paper.copies = COPIES_FLOOR + 1;
    for (let i = 0; i < 400; i += 1) {
      paper = { ...playDay(paper, POOL, []), day: paper.day + 1 };
      if (paper.over) break;
    }
    expect(paper.copies).toBe(COPIES_FLOOR);
  });
});

describe('the pool', () => {
  it('reports a lever the economy cannot charge for', () => {
    expect(validatePool([episode('x', 'bribery')])).toContainEqual({
      code: 'unknown-lever',
      slug: 'x',
      lever: 'bribery',
    });
  });

  it('reports a repeated slug', () => {
    expect(validatePool([episode('x', 'access'), episode('x', 'law')])).toContainEqual({
      code: 'duplicate-slug',
      slug: 'x',
      count: 2,
    });
  });

  it('says nothing about a sound pool', () => {
    expect(validatePool(POOL)).toEqual([]);
  });

  it('rejects a slug reserved for a generated story', () => {
    // `available`, `published` and `bills` are all keyed by one id space, so a
    // feed episode called `advertorial` or `tip-7` collides with a generated
    // one: `publish` resolves by findIndex, hits whichever comes first, and the
    // researched story is unpublishable for ever with its bill never firing.
    // None of that is visible to the player, which is why it is a build-time
    // refusal rather than something to notice in play.
    for (const slug of ['advertorial', 'wire-1', 'planted-1', 'stringer-1', 'tip-1', 'follow-1']) {
      expect(validatePool([episode(slug, 'access')])).toContainEqual({
        code: 'reserved-slug',
        slug,
      });
    }
  });

  it('reserves an id for every source that generates one', () => {
    // The regex in `validatePool` is a hand-written parallel to the `<source>-
    // <day>` ids in sources.ts. This is what fails if an eighth generated
    // source lands without extending it — the collision above, reopened.
    const generates: readonly StorySource[] = ['wire', 'planted', 'stringer', 'tip', 'follow'];
    for (const source of generates) {
      expect(validatePool([episode(`${source}-42`, 'access')])).toContainEqual({
        code: 'reserved-slug',
        slug: `${source}-42`,
      });
    }
    expect(validatePool([episode(ADVERTORIAL_ID, 'access')])).toContainEqual({
      code: 'reserved-slug',
      slug: ADVERTORIAL_ID,
    });
  });

  it('leaves a slug that only looks generated alone', () => {
    // The shape is `<source>-<digits>`. Prose that merely starts the same way
    // is a legitimate episode slug and must not be refused.
    for (const slug of ['wire-story', 'tipping-point', 'follow-up', 'planted-evidence']) {
      expect(validatePool([episode(slug, 'access')])).toEqual([]);
    }
  });

  it('knows exactly three levers', () => {
    expect([...LEVERS]).toEqual(['access', 'money', 'law']);
  });
});

describe('an issue, not a slot', () => {
  /** Only `growth` and `source` matter to `issueGrowth`; the rest makes it a `Story`. */
  const at = (growth: number, source = 'stringer'): Story => ({
    id: `s-${growth}-${source}`,
    source: source as Story['source'],
    headline: 'x',
    growth,
    consequence: null,
    paysPence: 0,
    unverified: false,
    offeredOn: 1,
  });

  it('is a day with no paper when it is empty', () => {
    expect(issueGrowth([])).toBe(1 - IDLE_DECAY);
  });

  it('is exactly the lead when the lead is all there is', () => {
    expect(issueGrowth([at(1.07)])).toBe(1.07);
  });

  it('gives each inside story a diminishing share of its surplus', () => {
    // Computed from the formula by hand, not read back off the implementation.
    const inside = (n: number) => issueGrowth([at(1.07), ...Array(n).fill(at(1.04))]);
    expect(inside(1)).toBeCloseTo(1.084267, 6);
    expect(inside(2)).toBeCloseTo(1.089086, 6);
    expect(inside(5)).toBeCloseTo(1.091417, 6);
  });

  it('lets a story below one drag the issue under its own lead', () => {
    // The property the whole shape was chosen for: padding costs you.
    expect(issueGrowth([at(1.07), at(0.998, 'wire')])).toBeLessThan(1.07);
  });

  /**
   * The bound. No quantity of lesser copy may beat one good story.
   *
   * `1.07` is deliberately absent: an issue led by an investigation with more
   * investigations inside is *supposed* to beat a lone one. The claim is only
   * about copy that is worse than an investigation.
   */
  it('never lets lesser copy reach an investigation, however much of it there is', () => {
    for (const growth of [1.04, 1.03, 0.998, 0.996, 0.975, 0.95]) {
      for (let n = 1; n <= 8; n += 1) {
        const g = issueGrowth([at(growth), ...Array(n).fill(at(growth))]);
        expect(g).toBeLessThan(1 + PUBLISH_GROWTH);
      }
    }
  });

  it('keeps INSIDE_SHARE under the crossing where that stops being true', () => {
    // 0.416949 is where an all-planted issue reaches an investigation's 1.07.
    expect(INSIDE_SHARE).toBeLessThan(0.416949);
  });

  it('refuses a story nobody is free to write, and takes nothing else with it', () => {
    // Compared against a control day, because every day writes 'Wages' and
    // 'Sales' and always moves the till.
    const busy = startPaper();
    const plan: Action[] = STARTING_SOURCES.map(
      (sourceId) => ({ kind: 'cultivate', sourceId }) as Action,
    );
    const control = step(busy, plan);
    const refused = step(busy, [...plan, { kind: 'publish', id: 'advertorial' }]);

    expect(line(refused, 'Nobody spare to write it.')).toBeDefined();
    expect(line(control, 'Nobody spare to write it.')).toBeUndefined();
    expect(refused.published).toEqual(control.published);
    expect(refused.cashPence).toBe(control.cashPence);
    expect(refused.bills).toEqual(control.bills);
  });

  it('charges a reporter for a story, so writing and working a source compete', () => {
    const after = step(startPaper(), [
      { kind: 'publish', id: 'advertorial' },
      ...STARTING_SOURCES.map((sourceId) => ({ kind: 'cultivate', sourceId }) as Action),
    ]);
    // Three reporters: one wrote, two worked sources, the third source had nobody.
    expect(line(after, 'Nobody spare to work it.')).toBeDefined();
  });

  it('sells the advertiser one page and no more', () => {
    const after = step(startPaper({ reporters: 6 }), [
      { kind: 'publish', id: 'advertorial' },
      { kind: 'publish', id: 'advertorial' },
    ]);
    expect(line(after, 'The advertiser gets one page.')).toBeDefined();
    expect(after.published.filter((s) => s.id === 'advertorial')).toHaveLength(1);
    // Still an offer, so it is there again tomorrow.
    expect(after.available.some((s) => s.id === 'advertorial')).toBe(true);
  });

  it('lets the plan order decide what leads', () => {
    // A matured investigation and a bought story on the same desk, with enough
    // hands to run both, so only the order can explain the difference.
    let paper = startPaper({ reporters: 6 });
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    for (let i = 0; i < INVESTIGATION_DAYS; i += 1) paper = step(paper);
    paper = step(paper, [{ kind: 'buy-stringer' }]);
    const stringer = paper.available.find((s: Story) => s.source === 'stringer')!;
    expect(paper.available.some((s: Story) => s.id === 'a-story')).toBe(true);

    const led = (first: string, second: string) =>
      step(paper, [
        { kind: 'publish', id: first },
        { kind: 'publish', id: second },
      ]).copies;

    // An investigation leads at 1.07 and a stringer at 1.03, so the order shows.
    expect(led('a-story', stringer.id)).not.toBeCloseTo(led(stringer.id, 'a-story'), 6);
  });
});

describe('agency copy', () => {
  const subscribed = (): PaperState => {
    let paper = step(startPaper(), [{ kind: 'subscribe' }]);
    paper = step(paper);
    expect(paper.available.some((s) => s.source === 'wire')).toBe(true);
    return paper;
  };

  it('fills as much of an issue as you like, and costs no reporter', () => {
    const paper = subscribed();
    const wire = paper.available.find((s) => s.source === 'wire')!;
    // Every reporter is on a source, so nothing is free to write.
    const after = step(paper, [
      ...STARTING_SOURCES.map((sourceId) => ({ kind: 'cultivate', sourceId }) as Action),
      ...Array(4).fill({ kind: 'publish', id: wire.id } as Action),
    ]);
    expect(line(after, 'Nobody spare to write it.')).toBeUndefined();
    // Four printed, all of them the wire — the repeated id is the point.
    expect(after.published.filter((s) => s.id === wire.id)).toHaveLength(4);
  });

  it('is worth barely more than not publishing at all', () => {
    const paper = subscribed();
    const wire = paper.available.find((s) => s.source === 'wire')!;
    const four = issueGrowth(Array(4).fill(wire));
    expect(four).toBeGreaterThan(1 - IDLE_DECAY);
    expect(four).toBeLessThan(1);
  });

  it('cannot be run by a paper that is not on the wire', () => {
    // Reachable only by construction: the desk is only ever given a wire item
    // while the subscription is live.
    const paper = subscribed();
    const wire = paper.available.find((s) => s.source === 'wire')!;
    const off: PaperState = { ...paper, subscribed: false };
    const after = step(off, [{ kind: 'publish', id: wire.id }]);
    expect(line(after, 'The wire is not yours to run.')).toBeDefined();
    expect(after.published).toHaveLength(0);
  });
});

describe('runCampaign', () => {
  it('returns one state per played day and stops when the paper closes', () => {
    const days: Action[][] = Array.from({ length: 400 }, () => []);
    const states = runCampaign(POOL, days);
    expect(states[0].day).toBe(1);
    expect(states[states.length - 1].over).toBe(true);
    expect(states).toHaveLength(states[states.length - 1].day);
  });

  it('is deterministic', () => {
    const days: Action[][] = Array.from({ length: 40 }, () => [
      { kind: 'cultivate', sourceId: 'council' },
    ]);
    expect(runCampaign(POOL, days)).toEqual(runCampaign(POOL, days));
  });
});
