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
import {
  playDay,
  startPaper,
  type Action,
  type PaperState,
  type StartOptions,
} from '../src/paper';

const DAYS = 400;

function pool(file: string): Playable[] {
  const raw = readFileSync(join(process.cwd(), 'tests/fixtures', file), 'utf-8');
  return assertPlayFeed(JSON.parse(raw) as PlayFeed).episodes.map(toPlayable);
}

/**
 * The policy the issue's table is measured under: `cultivators` reporters work
 * `council` every day, and any story that has matured is published at once.
 * Publishing is capped at one a day by `playDay`, so a backlog simply waits.
 */
function play(episodes: Playable[], cultivators: number, options: StartOptions): PaperState {
  let state = startPaper(options);

  for (let day = 1; day <= DAYS; day += 1) {
    const actions: Action[] = [];
    for (let i = 0; i < cultivators; i += 1) actions.push({ kind: 'cultivate', sourceId: 'council' });
    if (state.available.length > 0) actions.push({ kind: 'publish', slug: state.available[0] });

    state = playDay(state, episodes, actions);
    if (state.over) return state;
    // Only advance between days, so a survivor's `day` is the days it played.
    if (day < DAYS) state = { ...state, day: state.day + 1 };
  }

  return state;
}

const episodes = pool('pool-36.json');
const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

console.log(`pool: ${episodes.length} episodes, ${DAYS} days simulated\n`);
console.log('reporters  cultivating  outcome');

for (const [reporters, cultivators] of [
  [3, 0],
  [4, 0],
  [6, 0],
  [3, 1],
  [4, 1],
  [6, 1],
  [4, 2],
] as const) {
  const end = play(episodes, cultivators, { reporters });
  const outcome = end.over
    ? `broke on day ${end.day}`
    : `survives: ${Math.round(end.copies).toLocaleString('en-GB')} copies, ` +
      `${end.published.length} published, ${money(end.cashPence)}`;
  console.log(`${String(reporters).padStart(9)}  ${String(cultivators).padStart(11)}  ${outcome}`);
}
