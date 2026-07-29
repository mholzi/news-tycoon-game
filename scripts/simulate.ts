/**
 * The calibration table, generated rather than asserted.
 *
 * This exists because four calibrations were wrong in a single day of designing
 * the economy, and each was wrong the same way: a model of part of the system,
 * measured carefully, reported as a measurement of the whole. The last of them
 * left the bills out entirely, which meant the numbers described a game where
 * printing costs nothing.
 *
 * So this does not reimplement the day. It imports `playDay` and drives the
 * shipped code. If the table below is wrong, the game is wrong in the same way,
 * which is the only useful property a calibration script can have.
 *
 *   npx vite-node scripts/simulate.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertPlayFeed, toPlayable, type PlayFeed, type Playable } from '../src/feed';
import { CALIBRATION_DAYS, playPolicy, type PolicyUses } from '../src/policy';
import { formatCopies, formatTakings } from '../src/ledger';


function pool(file: string): Playable[] {
  const raw = readFileSync(join(process.cwd(), 'tests/fixtures', file), 'utf-8');
  return assertPlayFeed(JSON.parse(raw) as PlayFeed).episodes.map(toPlayable);
}

const episodes = pool('pool-36.json');

console.log(`pool: ${episodes.length} episodes, ${CALIBRATION_DAYS} days simulated\n`);
console.log('policy             staff  outcome');

const RUNS: readonly (readonly [string, number, number, PolicyUses])[] = [
  ['nothing', 3, 0, {}],
  ['nothing-4', 4, 0, {}],
  ['nothing-6', 6, 0, {}],
  ['investigations', 3, 1, {}],
  ['investigations-4', 4, 1, {}],
  ['investigations-6', 6, 1, {}],
  ['investigations-2c', 4, 2, {}],
  ['wire-only', 3, 0, { wire: true }],
  ['advertorial-only', 3, 0, { advertorial: true }],
  ['unbidden-only', 3, 0, { unbidden: true }],
  ['stringer-only', 3, 0, { stringer: true }],
  ['mixed', 3, 1, { wire: true, stringer: true, advertorial: true, checkTips: true, unbidden: true }],
  ['mixed-blind', 3, 1, { wire: true, stringer: true, advertorial: true, unbidden: true }],
  ['multi', 3, 1, { wire: true, stringer: true, advertorial: true, checkTips: true, unbidden: true, multiStory: true }],
];

for (const [name, reporters, cultivators, uses] of RUNS) {
  const end = playPolicy(episodes, cultivators, { reporters }, CALIBRATION_DAYS, uses);
  const outcome = end.over
    ? `broke on day ${end.day}`
    : `survives: ${formatCopies(end.copies)} copies, ` +
      `${end.published.length} published, ${formatTakings(end.cashPence)}`;
  console.log(`${name.padEnd(18)} ${String(reporters)}r ${String(cultivators)}c  ${outcome}`);
}
