import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Playable } from '../../src/feed';
import { startPaper, type PaperState } from '../../src/paper';
import { CALIBRATION_DAYS, playPolicy } from '../../src/policy';
import { clear, KEY, load, reconcile, save, VERSION } from '../../src/save';

/**
 * An in-memory stand-in for `localStorage`, installed as a global rather than
 * injected: `save.ts` reads `globalThis.localStorage` fresh on every call
 * precisely so this works without pulling jsdom into a node test run.
 */
function memoryStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage & { map: Map<string, string> };
}

let store: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const pool = (): Playable[] =>
  JSON.parse(readFileSync('tests/fixtures/pool-36.json', 'utf-8')).episodes;

/** A state with a real ledger, bills and published list behind it. */
function midCampaign(): PaperState {
  return playPolicy(pool(), 0, { reporters: 3 }, Math.min(12, CALIBRATION_DAYS));
}

describe('save and load', () => {
  it('round-trips a mid-campaign state across all sixteen fields', () => {
    const before = midCampaign();
    save(before);
    expect(load()).toEqual(before);
  });

  it('returns undefined when nothing was ever saved', () => {
    expect(load()).toBeUndefined();
  });

  it('returns undefined on text that is not JSON', () => {
    store.setItem(KEY, 'not json {');
    expect(load()).toBeUndefined();
  });

  /*
   * The reason VERSION exists. A blob from a build whose PaperState had a
   * different shape is discarded, never migrated: a half-migrated campaign
   * fails later and in a way the player cannot understand.
   */
  it('discards a blob written by a different version', () => {
    store.setItem(KEY, JSON.stringify({ version: VERSION + 1, state: startPaper() }));
    expect(load()).toBeUndefined();
  });

  it('rejects a state whose day is not a number', () => {
    store.setItem(KEY, JSON.stringify({ version: VERSION, state: { ...startPaper(), day: 'x' } }));
    expect(load()).toBeUndefined();
  });

  it('rejects a state whose ledger is not an array', () => {
    store.setItem(
      KEY,
      JSON.stringify({ version: VERSION, state: { ...startPaper(), ledger: null } }),
    );
    expect(load()).toBeUndefined();
  });
});

describe('clear', () => {
  /*
   * Asserted against the store rather than through `load`, because this is the
   * only place `clear` is observable at all: in the running game the render
   * that follows `Start again` writes a fresh campaign to the same key, so
   * nothing downstream can tell whether the key was removed first.
   */
  it('removes the key while a campaign is stored', () => {
    save(startPaper());
    expect(store.map.has(KEY)).toBe(true);
    clear();
    expect(store.map.has(KEY)).toBe(false);
  });
});

describe('storage that fails', () => {
  it('does not throw when setItem throws', () => {
    vi.stubGlobal('localStorage', {
      ...store,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    });
    expect(() => save(startPaper())).not.toThrow();
  });

  it('does not throw when getItem throws', () => {
    vi.stubGlobal('localStorage', {
      ...store,
      getItem: () => {
        throw new Error('storage disabled');
      },
    });
    expect(() => load()).not.toThrow();
    expect(load()).toBeUndefined();
  });

  /* Safari private browsing, and any browser with site data switched off. */
  it('does not throw when there is no localStorage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => save(startPaper())).not.toThrow();
    expect(() => clear()).not.toThrow();
    expect(load()).toBeUndefined();
  });
});

describe('reconcile', () => {
  const episodes = [{ slug: 'kept' }, { slug: 'also-kept' }] as unknown as Playable[];

  it('drops a lead whose episode has left the pool', () => {
    const state = { ...startPaper(), leads: ['kept', 'gone', 'also-kept'] };
    expect(reconcile(state, episodes).leads).toEqual(['kept', 'also-kept']);
  });

  /*
   * The asymmetry decision 3 settled: a lead costs nothing to drop, a running
   * investigation has up to six reporter-days in it. It survives, and `playDay`
   * says "came to nothing" at maturity, which is the honest outcome.
   */
  it('leaves a running investigation alone even when its slug has gone', () => {
    const state = { ...startPaper(), running: [{ slug: 'gone', readyOn: 20 }] };
    expect(reconcile(state, episodes).running).toEqual([{ slug: 'gone', readyOn: 20 }]);
  });

  it('returns the same object when every lead still resolves', () => {
    const state = { ...startPaper(), leads: ['kept'] };
    expect(reconcile(state, episodes)).toBe(state);
  });
});
