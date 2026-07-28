/**
 * Deterministic randomness, because a campaign has to be re-derivable.
 *
 * The dealer picks 12 episodes out of 36. If that pick used `Math.random()` the
 * same seed would give a different campaign every time, and a saved campaign
 * could never be rebuilt from what was written down. Everything here is a pure
 * function of its arguments: no `Math.random()`, no `Date.now()`, no module
 * state that survives a call.
 *
 * The exact expressions matter more than the quality of the distribution. Two
 * implementations that both "shuffle correctly" but differ in index arithmetic
 * would deal different campaigns from the same seed, which is the one thing
 * this file exists to prevent. `tests/unit/rng.test.ts` pins them to golden
 * values so a refactor that changes the sequence goes red.
 */

/**
 * FNV-1a, 32-bit, as an unsigned integer that is never 0.
 *
 * Zero is excluded because `mulberry32` seeded with 0 still produces a usable
 * sequence but makes "did the seed arrive?" impossible to tell from the output.
 * An empty string hashes to the FNV offset basis, so 0 only turns up for inputs
 * that happen to cancel it out; `|| 1` covers those without special-casing.
 */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    // The FNV prime, 16777619, via shifts: Math.imul keeps this in int32 range
    // where a plain `*` would lose precision above 2^53.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

/** mulberry32. Returns a function producing values in [0, 1). */
export function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates, walking downwards, on a copy.
 *
 * Written out rather than compressed because the index arithmetic is the
 * contract: `j` is drawn from `[0, i]` inclusive, and the swap happens even
 * when `i === j`. Change either and every campaign in every save changes with
 * it.
 */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}
