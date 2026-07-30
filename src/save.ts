/**
 * A campaign survives a reload.
 *
 * `localStorage`, one slot, written after every state change. The decision and
 * the two alternatives that lost are in the wiki; the short version is that a
 * backend would end this game's status as a static site for the sake of a
 * feature nobody can use yet, and a URL save code is unwieldy at campaign
 * length.
 */

import type { PaperState } from './paper';
import type { Playable } from './feed';

export const KEY = 'news-tycoon:campaign';

/**
 * Bumped whenever `PaperState` changes shape. A blob carrying any other number
 * is discarded rather than migrated: a half-migrated campaign fails later, in a
 * way the player cannot understand, and there is nothing here worth that.
 */
export const VERSION = 1;

interface Saved {
  version: number;
  state: PaperState;
}

/**
 * Storage, read fresh every call.
 *
 * Never captured at module scope, for two reasons. `localStorage` throws on
 * property access in Safari private browsing and with site data disabled, so
 * touching it at import time would take the whole game down before it drew
 * anything. And a captured reference cannot be substituted afterwards, which
 * would make the failure paths below untestable.
 */
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write the campaign. Never throws.
 *
 * `setItem` throws `QuotaExceededError` when the disk is full or the origin is
 * over budget. A game that dies because it could not save is worse than one
 * that quietly does not remember, so the failure is swallowed — and swallowed
 * silently, without a console line, because it would otherwise fire on every
 * click for a condition the player cannot act on.
 */
export function save(state: PaperState): void {
  try {
    const blob: Saved = { version: VERSION, state };
    storage()?.setItem(KEY, JSON.stringify(blob));
  } catch {
    // Deliberately empty. See above.
  }
}

/**
 * The saved campaign, or `undefined` if there is none, it cannot be read, or it
 * was written by a different version. Never throws.
 */
export function load(): PaperState | undefined {
  let raw: string | null | undefined;
  try {
    raw = storage()?.getItem(KEY);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'string') return undefined;

  let blob: unknown;
  try {
    blob = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof blob !== 'object' || blob === null) return undefined;
  const saved = blob as Partial<Saved>;
  if (saved.version !== VERSION) return undefined;

  const state = saved.state;
  if (typeof state !== 'object' || state === null) return undefined;

  /*
   * Four fields out of sixteen, on purpose. This is a corruption check, not a
   * schema validator: a blob written by this build has the right shape by
   * construction, so what is worth catching is truncated data and a build whose
   * VERSION somebody forgot to bump. It cannot catch an episode leaving the
   * pool — that is `reconcile`'s job, and it needs the pool to do it.
   */
  const shape = state as Partial<PaperState>;
  if (typeof shape.day !== 'number') return undefined;
  if (typeof shape.cashPence !== 'number') return undefined;
  if (typeof shape.over !== 'boolean') return undefined;
  if (!Array.isArray(shape.ledger)) return undefined;

  return state;
}

/** Forget the campaign. Never throws. */
export function clear(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Same reasoning as `save`.
  }
}

/**
 * Settle a restored campaign against the archive as it is now.
 *
 * A save holds slugs, not episodes: `leads` is a list of them and every
 * `Investigation` is `{ slug, readyOn }`. They are resolved against the pool at
 * maturity, six days later, and until campaigns could survive a reload the pool
 * a campaign started with was always the pool it ended with. Persistence is
 * what breaks that.
 *
 * The asymmetry is deliberate. A lead has nothing invested in it, so dropping
 * one costs the player nothing and needs no explanation. A running
 * investigation has up to six reporter-days in it, and the honest thing is the
 * ledger line `paper.ts` already writes — "came to nothing" — rather than
 * silently deleting the work or refusing the whole save.
 */
export function reconcile(state: PaperState, pool: readonly Playable[]): PaperState {
  const known = new Set(pool.map((episode) => episode.slug));
  const kept = state.leads.filter((slug) => known.has(slug));
  // Same object when nothing was dropped: the common path allocates nothing and
  // a caller can compare by identity to know whether anything changed.
  if (kept.length === state.leads.length) return state;
  return { ...state, leads: kept };
}
