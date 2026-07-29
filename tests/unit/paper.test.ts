import { describe, expect, it } from 'vitest';
import type { Playable } from '../../src/feed';
import {
  ACCESS_FACTOR,
  BILL_BASIS_COPIES,
  COPIES_CEILING,
  COPIES_FLOOR,
  decadeOf,
  eraIssuePence,
  FIRST_DECADE,
  HIRE_COST_PENCE,
  IDLE_DECAY,
  INVESTIGATION_DAYS,
  LAST_DECADE,
  LAW_COST_MULTIPLE,
  LEVERS,
  MARGIN_SHARE,
  MONEY_COST_MULTIPLE,
  playDay,
  pricesFor,
  PUBLISH_GROWTH,
  runCampaign,
  SOURCE_STEP_PENCE,
  SOURCE_STEPS_TO_LEAD,
  START_CASH_PENCE,
  START_COPIES,
  START_DECADE,
  START_REPORTERS,
  startPaper,
  STARTING_SOURCES,
  validatePool,
  WAGE_PENCE_PER_DAY,
  type Action,
  type PaperState,
} from '../../src/paper';

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
    expect(paper.decade).toBe(START_DECADE);
    expect(paper.pricePence).toBe(pricesFor(START_DECADE).standard);
    expect(paper.sources.map((s) => s.id)).toEqual([...STARTING_SOURCES]);
  });

  it('refuses an opening that could never be played', () => {
    expect(() => startPaper({ reporters: 0 })).toThrow(RangeError);
    expect(() => startPaper({ reporters: 1.5 })).toThrow(RangeError);
    expect(() => startPaper({ cashPence: -1 })).toThrow(RangeError);
    expect(() => startPaper({ decade: 1925 })).toThrow(RangeError);
  });

  it('clamps a decade outside the table rather than throwing mid-play', () => {
    expect(pricesFor(1850)).toEqual(pricesFor(FIRST_DECADE));
    expect(pricesFor(2400)).toEqual(pricesFor(LAST_DECADE));
    expect(pricesFor(Number.NaN)).toEqual(pricesFor(FIRST_DECADE));
  });

  it('measures a bill in a day of takings, not in a day of cover price', () => {
    expect(eraIssuePence(1920)).toBe(
      Math.round(BILL_BASIS_COPIES * pricesFor(1920).standard * MARGIN_SHARE),
    );
  });

  it('knows which decade a year is in', () => {
    expect(decadeOf(1931)).toBe(1930);
    expect(decadeOf(2015)).toBe(2010);
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

  it('takes the lowest slug first, by code point', () => {
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    expect(paper.running[0].slug).toBe('a-story');
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
    expect(paper.available).toHaveLength(0);
    paper = step(paper);
    expect(paper.available).toEqual(['a-story']);
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
    const after = step(ready, [{ kind: 'publish', slug: 'a-story' }]);
    expect(after.copies).toBeCloseTo(before * (1 + PUBLISH_GROWTH), 6);
    expect(after.published).toEqual(['a-story']);
  });

  it('only one story can lead', () => {
    const ready = withStory();
    const after = step(ready, [
      { kind: 'publish', slug: 'a-story' },
      { kind: 'publish', slug: 'a-story' },
    ]);
    expect(line(after, 'Only one story can lead.')).toBeDefined();
    expect(after.published).toHaveLength(1);
  });

  it('refuses a story that is not ready', () => {
    const after = step(startPaper(), [{ kind: 'publish', slug: 'a-story' }]);
    expect(line(after, 'That story is not ready.')).toBeDefined();
    expect(after.published).toHaveLength(0);
  });

  it('leaves an unpublished story on the desk indefinitely', () => {
    let paper = withStory();
    for (let i = 0; i < 10; i += 1) paper = step(paper);
    expect(paper.available).toEqual(['a-story']);
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
    return step(paper, [{ kind: 'publish', slug: 'a-story' }], pool);
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
      -Math.round(MONEY_COST_MULTIPLE * eraIssuePence(START_DECADE)),
    );
    expect(line(law, 'The bill for a-story')?.pence).toBe(
      -Math.round(LAW_COST_MULTIPLE * eraIssuePence(START_DECADE)),
    );
  });

  it('charges nothing for a lever the economy does not know', () => {
    const pool = [episode('a-story', 'bribery', 3)];
    let paper = startPaper();
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }], pool);
    }
    for (let i = 0; i < INVESTIGATION_DAYS; i += 1) paper = step(paper, [], pool);
    paper = step(paper, [{ kind: 'publish', slug: 'a-story' }], pool);
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

  it('keeps one reporter whatever happens', () => {
    let paper = startPaper({ reporters: 1 });
    paper = step(paper, [{ kind: 'fire' }]);
    expect(line(paper, 'Somebody has to write it.')).toBeDefined();
    expect(paper.reporters).toBe(1);
  });

  it('lets a free reporter go before touching an investigation', () => {
    let paper = startPaper({ reporters: 2 });
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [{ kind: 'cultivate', sourceId: 'council' }]);
    }
    expect(paper.running).toHaveLength(1);
    paper = step(paper, [{ kind: 'fire' }]);
    expect(paper.reporters).toBe(1);
    expect(paper.running).toHaveLength(1);
  });

  it('cancels the newest investigation when nobody is free, and keeps the lead', () => {
    let paper = startPaper({ reporters: 2 });
    // Two sources worked in parallel put both reporters on stories.
    for (let i = 0; i < SOURCE_STEPS_TO_LEAD; i += 1) {
      paper = step(paper, [
        { kind: 'cultivate', sourceId: 'council' },
        { kind: 'cultivate', sourceId: 'courts' },
      ]);
    }
    // Both reporters spent those days on sources, so nobody was free to take the
    // leads. One quiet day puts them both on stories.
    expect(paper.leads).toHaveLength(2);
    paper = step(paper);
    expect(paper.running).toHaveLength(2);

    paper = step(paper, [{ kind: 'fire' }]);
    expect(paper.reporters).toBe(1);
    expect(paper.running).toHaveLength(1);
    expect(paper.leads).toHaveLength(1);
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
    const after = step(startPaper({ reporters: 1 }), [
      { kind: 'cultivate', sourceId: 'council' },
      { kind: 'cultivate', sourceId: 'courts' },
    ]);
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

  it('knows exactly three levers', () => {
    expect([...LEVERS]).toEqual(['access', 'money', 'law']);
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
