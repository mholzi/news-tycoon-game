import { startPaper, type PaperState } from '../../src/paper';
import { VERSION } from '../../src/save';

/**
 * A loadable campaign, built rather than hand-written.
 *
 * `PaperState` has sixteen fields and `load()` returns `undefined` unless the
 * ones it checks are all present and the right shape. A hand-written fixture
 * that misses one is not rejected loudly — it is discarded, the game starts a
 * fresh campaign, and the test goes green while asserting nothing it meant to.
 * That silent pass is the whole reason this helper exists.
 *
 * Start from `startPaper()`, which is the same constructor the game uses, then
 * override only what the test is about. The expected strings belong in the
 * test, never in here: a fixture that carries its own answer cannot fail.
 */
export function makeSave(overrides: Partial<PaperState> = {}): string {
  const state: PaperState = { ...startPaper(), ...overrides };
  return JSON.stringify({ version: VERSION, state });
}
