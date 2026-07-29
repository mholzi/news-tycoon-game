/**
 * How the figures are written down.
 *
 * All that is left of the ledger that shipped on 2026-07-28. The economy it
 * served — two accounts, print or hold, a twelve-issue campaign — was replaced
 * by the daily paper in `src/paper.ts`.
 *
 * `PRICE_TABLE` went with it. It priced a paper by the decade it was set in,
 * and campaigns were decoupled from the centuries on 2026-07-29: a run is not
 * set in a period and does not charge like one. The episodes keep their real
 * years because they are real cases. It is in the history if the period ever
 * comes back as a mechanic rather than as a fact about the archive.
 */

const gbp = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
});
const copiesFormat = new Intl.NumberFormat('en-GB');

/**
 * An explicit locale, so the output does not follow whatever the runner's
 * default happens to be. Not a guarantee: a `small-icu` Node build has no en-GB
 * data and falls back, which would break these strings and the assertions on
 * them. The CI image ships full ICU, so this is a known dependency rather than
 * a solved problem.
 */
export const formatCopies = (copies: number): string => copiesFormat.format(Math.round(copies));
export const formatPrice = (pence: number): string => `${pence}p`;
export const formatTakings = (pence: number): string => gbp.format(pence / 100);
