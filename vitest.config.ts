import { defineConfig } from 'vitest/config';

/**
 * Vitest owns `tests/unit` and `tests/integration`; Playwright owns
 * `tests/e2e`. Without this, Vitest collects the `.spec.ts` files too and
 * fails on Playwright's `test()`, which refuses to run outside its own runner.
 */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
  },
});
