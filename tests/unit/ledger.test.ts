import { describe, expect, it } from 'vitest';
import { formatCopies, formatPrice, formatTakings, PRICE_TABLE } from '../../src/ledger';

/**
 * What survived the rewrite.
 *
 * The economy this file used to test — two accounts, print or hold — is gone.
 * These are the parts that were about the period and the presentation rather
 * than about that design, and they still have to hold.
 */

describe('the price table', () => {
  it('has a row for every decade a campaign can be set in', () => {
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
});

describe('formatting', () => {
  it('rounds copies and separates thousands', () => {
    expect(formatCopies(22_578.6)).toBe('22,579');
    expect(formatCopies(20_000)).toBe('20,000');
  });

  it('writes the price in whole pence', () => {
    expect(formatPrice(2)).toBe('2p');
    expect(formatPrice(100)).toBe('100p');
  });

  it('writes money in pounds, with a minus when it has gone wrong', () => {
    expect(formatTakings(3_890_688)).toBe('£38,906.88');
    expect(formatTakings(0)).toBe('£0.00');
    expect(formatTakings(-1_200)).toBe('-£12.00');
  });
});
