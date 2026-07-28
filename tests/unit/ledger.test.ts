import { describe, expect, it, vi } from 'vitest';
import type { Playable } from '../../src/feed';
import { LEVERS, validatePool } from '../../src/deal';
import {
  ACCESS_FACTOR,
  accrue,
  applyBill,
  choosePrice,
  enterDecade,
  eraIssuePence,
  formatCopies,
  formatPrice,
  formatTakings,
  LAW_COST_MULTIPLE,
  MONEY_COST_MULTIPLE,
  PRICE_MULTIPLIER,
  PRICE_TABLE,
  PRINT_LIFT,
  pricesFor,
  promptCount,
  runLedger,
  START_COPIES,
  startLedger,
  type IssueAction,
  type PriceChoice,
} from '../../src/ledger';

/**
 * A synthetic episode. Only `year`, `lever` and the two delays matter to the
 * ledger; the prose exists so the value is a real `Playable` and not a cast.
 */
function episode(year: number, lever: string, delay = 3): Playable {
  return {
    slug: `e-${year}-${lever}`,
    title: `e-${year}`,
    year,
    place: 'London',
    lever,
    desk: 'A situation.',
    voices: [
      { who: 'a', says: 'x', trust: 'y', doubt: 'z' },
      { who: 'b', says: 'x', trust: 'y', doubt: 'z' },
    ],
    unverifiable: 'Something unknowable.',
    print: { now: 'runs', later: 'the bill', issues: delay },
    hold: { now: 'held', later: 'the other cost', issues: delay },
  };
}

const fresh = () => startLedger(1930, new Set<number>());

describe('the price table', () => {
  it('has a row for every decade the campaign can reach', () => {
    for (let decade = 1920; decade <= 2030; decade += 10) {
      expect(PRICE_TABLE[decade]).toBeDefined();
    }
  });

  it('keeps the three prices distinct in every decade', () => {
    for (const prices of Object.values(PRICE_TABLE)) {
      expect(prices.cheap).toBeLessThan(prices.standard);
      expect(prices.standard).toBeLessThan(prices.dear);
    }
  });

  it('clamps a decade below the table and warns once, not once per lookup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const warned = new Set<number>();
    expect(pricesFor(1850, warned)).toEqual(PRICE_TABLE[1920]);
    pricesFor(1850, warned);
    pricesFor(1850, warned);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('clamps a decade above the table', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(pricesFor(2400, new Set())).toEqual(PRICE_TABLE[2030]);
    warn.mockRestore();
  });

  it('measures a bill in issues of the era, not in cash', () => {
    expect(eraIssuePence(1930, new Set())).toBe(START_COPIES * PRICE_TABLE[1930].standard);
    expect(eraIssuePence(2010, new Set())).toBe(START_COPIES * PRICE_TABLE[2010].standard);
  });
});

describe('takings', () => {
  it('accrues the week at the standard price', () => {
    const ledger = fresh();
    accrue(ledger, false);
    expect(ledger.takingsPence).toBe(START_COPIES * PRICE_TABLE[1930].standard);
  });

  it('lifts only the week a story ran, never the baseline sale', () => {
    const ledger = fresh();
    accrue(ledger, true);
    expect(ledger.takingsPence).toBe(
      Math.round(START_COPIES * PRINT_LIFT * PRICE_TABLE[1930].standard),
    );
    expect(ledger.copies).toBe(START_COPIES);
  });

  it('goes negative and stays there rather than clamping', () => {
    const ledger = fresh();
    applyBill(ledger, 'law', 2010, new Set());
    expect(ledger.takingsPence).toBeLessThan(0);
    expect(ledger.takingsPence).toBe(-Math.round(LAW_COST_MULTIPLE * eraIssuePence(2010, new Set())));
  });
});

describe('a bill', () => {
  it('bleeds copies for access, permanently', () => {
    const ledger = fresh();
    applyBill(ledger, 'access', 1930, new Set());
    expect(ledger.copies).toBeCloseTo(START_COPIES * ACCESS_FACTOR, 6);
    expect(ledger.takingsPence).toBe(0);
  });

  it('compounds two access bills rather than adding them', () => {
    const ledger = fresh();
    applyBill(ledger, 'access', 1930, new Set());
    applyBill(ledger, 'access', 1930, new Set());
    expect(ledger.copies).toBeCloseTo(START_COPIES * ACCESS_FACTOR * ACCESS_FACTOR, 6);
    expect(ledger.copies).not.toBeCloseTo(START_COPIES * 0.92, 6);
  });

  it('charges money against the takings and leaves the sale alone', () => {
    const ledger = fresh();
    applyBill(ledger, 'money', 1930, new Set());
    expect(ledger.copies).toBe(START_COPIES);
    expect(ledger.takingsPence).toBe(
      -Math.round(MONEY_COST_MULTIPLE * eraIssuePence(1930, new Set())),
    );
  });

  it('charges law harder than money in the same era', () => {
    const money = fresh();
    const law = fresh();
    applyBill(money, 'money', 1980, new Set());
    applyBill(law, 'law', 1980, new Set());
    expect(law.takingsPence).toBeLessThan(money.takingsPence);
  });

  it('costs the era it lands in, so a bled paper is not spared', () => {
    const ledger = fresh();
    ledger.copies = 1;
    applyBill(ledger, 'money', 1930, new Set());
    expect(ledger.takingsPence).toBe(
      -Math.round(MONEY_COST_MULTIPLE * eraIssuePence(1930, new Set())),
    );
  });

  it('does nothing at all for a held story', () => {
    const ledger = fresh();
    applyBill(ledger, null, 2010, new Set());
    expect(ledger).toEqual(fresh());
  });

  it('warns and moves nothing for an unknown lever', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ledger = fresh();
    applyBill(ledger, 'bribery', 1930, new Set());
    expect(ledger).toEqual(fresh());
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('the price', () => {
  it('starts at the standard price of the first decade', () => {
    expect(startLedger(1960, new Set()).pricePence).toBe(PRICE_TABLE[1960].standard);
  });

  it('takes the new decade standard when the menu is ignored', () => {
    const ledger = fresh();
    enterDecade(ledger, 2010, new Set());
    expect(ledger.pricePence).toBe(PRICE_TABLE[2010].standard);
    expect(ledger.copies).toBe(START_COPIES);
  });

  it('buys readers when it is cheap and loses them when it is dear', () => {
    const cheap = fresh();
    const dear = fresh();
    choosePrice(cheap, 1930, 'cheap', new Set());
    choosePrice(dear, 1930, 'dear', new Set());
    expect(cheap.copies).toBeCloseTo(START_COPIES * PRICE_MULTIPLIER.cheap, 6);
    expect(dear.copies).toBeCloseTo(START_COPIES * PRICE_MULTIPLIER.dear, 6);
    expect(cheap.pricePence).toBe(PRICE_TABLE[1930].cheap);
    expect(dear.pricePence).toBe(PRICE_TABLE[1930].dear);
  });

  it('compounds cheap across decades instead of resetting', () => {
    const ledger = fresh();
    choosePrice(ledger, 1930, 'cheap', new Set());
    choosePrice(ledger, 1960, 'cheap', new Set());
    expect(ledger.copies).toBeCloseTo(START_COPIES * 1.15 * 1.15, 6);
  });

  it('treats standard as a real choice that changes nothing', () => {
    const ledger = fresh();
    ledger.copies = 12_345;
    choosePrice(ledger, 1930, 'standard', new Set());
    expect(ledger.copies).toBe(12_345);
  });
});

describe('runLedger', () => {
  const four = [
    episode(1931, 'access'),
    episode(1962, 'money'),
    episode(1984, 'law'),
    episode(2011, 'access'),
  ];

  it('counts one prompt per distinct decade in deal order', () => {
    expect(promptCount(four)).toBe(4);
    expect(promptCount([episode(1931, 'access'), episode(1934, 'money')])).toBe(1);
  });

  it('refuses a short action list rather than guessing', () => {
    expect(() => runLedger(four, ['standard', 'standard', 'standard', 'standard'], ['print'])).toThrow(
      RangeError,
    );
  });

  it('refuses a short choice list rather than guessing', () => {
    const actions: IssueAction[] = ['print', 'print', 'print', 'print'];
    expect(() => runLedger(four, ['standard'], actions)).toThrow(RangeError);
  });

  it('accepts a null choice as a prompt the player ignored', () => {
    const actions: IssueAction[] = ['hold', 'hold', 'hold', 'hold'];
    const ignored = runLedger(four, [null, null, null, null], actions);
    const standard: PriceChoice[] = ['standard', 'standard', 'standard', 'standard'];
    expect(ignored).toEqual(runLedger(four, standard, actions));
  });

  it('is deterministic', () => {
    const choices: PriceChoice[] = ['cheap', 'dear', 'standard', 'cheap'];
    const actions: IssueAction[] = ['print', 'hold', 'print', 'print'];
    expect(runLedger(four, choices, actions)).toEqual(runLedger(four, choices, actions));
  });

  it('never charges a held story, on any issue', () => {
    const held = runLedger(four, [null, null, null, null], ['hold', 'hold', 'hold', 'hold']);
    // Four episodes plus the quiet issues their held consequences keep alive.
    expect(held.copies).toBe(START_COPIES);
    expect(held.takingsPence).toBeGreaterThan(0);
  });

  it('leaves a holder richer than a printer, which is the argument', () => {
    const actions: IssueAction[] = ['print', 'print', 'print', 'print'];
    const held: IssueAction[] = ['hold', 'hold', 'hold', 'hold'];
    const choices: PriceChoice[] = ['standard', 'standard', 'standard', 'standard'];
    expect(runLedger(four, choices, held).takingsPence).toBeGreaterThan(
      runLedger(four, choices, actions).takingsPence,
    );
  });
});

describe('formatting', () => {
  it('rounds copies and separates thousands', () => {
    expect(formatCopies(16_986.9312)).toBe('16,987');
    expect(formatCopies(20_000)).toBe('20,000');
  });

  it('writes the price in whole pence, three digits included', () => {
    expect(formatPrice(2)).toBe('2p');
    expect(formatPrice(100)).toBe('100p');
  });

  it('writes takings in pounds, with a minus when it has gone wrong', () => {
    expect(formatTakings(1_953_992)).toBe('£19,539.92');
    expect(formatTakings(0)).toBe('£0.00');
    expect(formatTakings(-1_200)).toBe('-£12.00');
  });
});

describe('the levers the pool is allowed to use', () => {
  it('is the same list the economy switches on', () => {
    expect([...LEVERS]).toEqual(['access', 'money', 'law']);
  });

  it('reports an episode whose lever the economy cannot charge', () => {
    const issues = validatePool([episode(1931, 'bribery')]);
    expect(issues).toContainEqual({
      code: 'unknown-lever',
      slug: 'e-1931-bribery',
      lever: 'bribery',
    });
  });

  it('says nothing about a pool whose levers are all known', () => {
    const issues = validatePool([episode(1931, 'access'), episode(1962, 'law')]);
    expect(issues.filter((i) => i.code === 'unknown-lever')).toHaveLength(0);
  });

  it('warns once per unknown lever, not once per bill', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ledger = fresh();
    const seen = new Set<string>();
    applyBill(ledger, 'bribery', 1930, new Set(), seen);
    applyBill(ledger, 'bribery', 1930, new Set(), seen);
    applyBill(ledger, 'bribery', 1930, new Set(), seen);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('inputs that should not crash the campaign', () => {
  it('refuses an empty campaign rather than dereferencing episodes[0]', () => {
    expect(() => runLedger([], ['standard'], ['print'])).toThrow(RangeError);
  });

  it('survives a NaN decade instead of throwing on an undefined table row', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(pricesFor(Number.NaN, new Set())).toEqual(PRICE_TABLE[1920]);
    warn.mockRestore();
  });
});
