/**
 * The cover prices, and how to write the figures down.
 *
 * What is left of the ledger that shipped on 2026-07-28. The economy it served
 * — two accounts, print or hold, a twelve-issue campaign — was replaced by the
 * daily paper in `src/paper.ts`, which owns the arithmetic now. These are the
 * parts that were about the period rather than about that design.
 */

import type { DecadePrices } from './ledger-types';

export type { DecadePrices };

export const PRICE_TABLE: Record<number, DecadePrices> = {
  1920: { cheap: 1, standard: 2, dear: 3 },
  1930: { cheap: 1, standard: 2, dear: 3 },
  1940: { cheap: 2, standard: 3, dear: 5 },
  1950: { cheap: 2, standard: 4, dear: 6 },
  1960: { cheap: 4, standard: 6, dear: 9 },
  1970: { cheap: 6, standard: 10, dear: 15 },
  1980: { cheap: 12, standard: 20, dear: 30 },
  1990: { cheap: 25, standard: 40, dear: 60 },
  2000: { cheap: 30, standard: 50, dear: 75 },
  2010: { cheap: 60, standard: 100, dear: 150 },
  2020: { cheap: 120, standard: 200, dear: 300 },
  2030: { cheap: 180, standard: 300, dear: 450 },
};

// Derived, not restated. A 2040 row added to the table above would otherwise
// stay silently unreachable behind a clamp nobody remembered to widen.

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
});
const copiesFormat = new Intl.NumberFormat('en-GB');

/**
 * An explicit locale, so the output does not follow whatever the runner's default
 * happens to be. It is not a guarantee: a `small-icu` Node build has no en-GB
 * data and falls back, which would break these strings and the assertions on
 * them. The CI image ships full ICU, so this is a known dependency rather than a
 * solved problem.
 */
export const formatCopies = (copies: number): string => copiesFormat.format(Math.round(copies));
export const formatPrice = (pence: number): string => `${pence}p`;
export const formatTakings = (pence: number): string => gbp.format(pence / 100);
