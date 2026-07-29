import { describe, expect, it } from 'vitest';
import { formatCopies, formatPrice, formatTakings } from '../../src/ledger';

/**
 * What survived the rewrite: the way figures are written down.
 *
 * The economy this file used to test is gone, and so is the price table — a run
 * is no longer set in a decade.
 */
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
