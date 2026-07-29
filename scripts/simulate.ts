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
import { CALIBRATION_DAYS, playPolicy } from '../src/policy';
import { outcomeLine, RUNS } from '../src/runs';


function pool(file: string): Playable[] {
  const raw = readFileSync(join(process.cwd(), 'tests/fixtures', file), 'utf-8');
  return assertPlayFeed(JSON.parse(raw) as PlayFeed).episodes.map(toPlayable);
}

const episodes = pool('pool-36.json');

console.log(`pool: ${episodes.length} episodes, ${CALIBRATION_DAYS} days simulated\n`);
console.log('policy             staff  outcome');

for (const [name, reporters, cultivators, uses] of RUNS) {
  const end = playPolicy(episodes, cultivators, { reporters }, CALIBRATION_DAYS, uses);
  const outcome = outcomeLine(end);
  console.log(`${name.padEnd(18)} ${String(reporters)}r ${String(cultivators)}c  ${outcome}`);
}
