/**
 * The policies the calibration is run over.
 *
 * A list and nothing else: no imports that do work, no `console.log`, no
 * simulation at import time. It lives here rather than in `scripts/simulate.ts`
 * because the integration test asserts the same table the script prints, and
 * that script runs all fourteen policies and prints fifteen lines the moment it
 * is imported. A test that imported the list from there would silently re-run
 * the whole calibration to read an array.
 *
 * The rows carry no outcomes. What each one is expected to do belongs to the
 * test, keyed by name, so a policy added here without an expectation fails as a
 * missing key rather than going quietly unchecked.
 */

import type { PolicyUses } from './policy';

export type Run = readonly [name: string, reporters: number, cultivators: number, uses: PolicyUses];

export const RUNS: readonly Run[] = [
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
