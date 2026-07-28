import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, shuffled } from '../../src/rng';

/**
 * Golden values, not properties.
 *
 * "Shuffles correctly" is not the contract here. Two correct shuffles that draw
 * their indices differently deal different campaigns from the same seed, and a
 * saved campaign would stop rebuilding. So the sequence itself is pinned: if a
 * refactor changes these numbers it has changed every campaign anyone ever
 * played, and that should be a decision rather than a surprise.
 */

describe('hashSeed', () => {
  it('is the FNV offset basis for the empty string', () => {
    expect(hashSeed('')).toBe(2166136261);
  });

  it('holds its golden values', () => {
    expect(hashSeed('deal-seed-0')).toBe(2349634002);
    expect(hashSeed('a')).toBe(3826002220);
  });

  it('never returns zero, because zero reads as an absent seed', () => {
    for (let i = 0; i < 5000; i += 1) {
      expect(hashSeed(`seed-${i}`)).toBeGreaterThan(0);
    }
  });

  it('separates the per-attempt derivations of one seed', () => {
    const seen = new Set([0, 1, 2, 3, 4].map((k) => hashSeed(`abc#${k}`)));
    expect(seen.size).toBe(5);
  });
});

describe('mulberry32', () => {
  it('holds its golden sequence', () => {
    const rand = mulberry32(hashSeed('deal-seed-0'));
    expect([rand(), rand(), rand()].map((n) => n.toFixed(12))).toEqual([
      '0.849088823656',
      '0.905326694483',
      '0.526713210857',
    ]);
  });

  it('repeats exactly from the same state', () => {
    const take = () => {
      const rand = mulberry32(12345);
      return [rand(), rand(), rand(), rand()];
    };
    expect(take()).toEqual(take());
  });

  it('stays inside [0, 1)', () => {
    const rand = mulberry32(hashSeed('range'));
    for (let i = 0; i < 10000; i += 1) {
      const value = rand();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('shuffled', () => {
  it('holds its golden permutation', () => {
    const rand = mulberry32(hashSeed('golden'));
    expect(shuffled([1, 2, 3, 4, 5, 6, 7, 8], rand)).toEqual([8, 3, 1, 6, 4, 2, 7, 5]);
  });

  it('is a permutation, keeping every element exactly once', () => {
    const input = Array.from({ length: 36 }, (_, i) => i);
    for (let s = 0; s < 200; s += 1) {
      const out = shuffled(input, mulberry32(hashSeed(`perm-${s}`)));
      expect(out.slice().sort((a, b) => a - b)).toEqual(input);
    }
  });

  it('does not touch the input', () => {
    const input = [1, 2, 3, 4, 5];
    shuffled(input, mulberry32(7));
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns single and empty arrays unchanged', () => {
    expect(shuffled([], mulberry32(1))).toEqual([]);
    expect(shuffled(['only'], mulberry32(1))).toEqual(['only']);
  });
});
