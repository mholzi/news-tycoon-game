import { defineConfig, devices } from '@playwright/test';

/**
 * Two projects now, and the second one is narrow on purpose.
 *
 * This used to say "one project, not two": the game made no claim about being
 * played on a phone, so a mobile project would have doubled the run time to
 * assert something nobody had designed. The broadsheet layout makes that claim
 * — a pinned account, a pinned print bar, 44px targets, no sideways scroll —
 * so there is now something to assert.
 *
 * `testMatch` keeps them disjoint. Without it a second project re-runs all 28
 * desktop tests at 390px, which is slow and which asserts a phone contract on
 * tests that were never written for one.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'html',
  use: {
    baseURL: 'http://localhost:4319',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop',
      testMatch: /paper\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: /\.mobile\.spec\.ts$/,
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    /*
     * Build first, always.
     *
     * `vite preview` serves whatever is in `dist/` and never builds it, so
     * running the suite after a source change tested the *previous* build. It
     * shows up as the strangest possible failure: unit tests green on the new
     * code, end-to-end tests green on the old code, and a diff between them
     * that nothing in the output explains. The build is a few seconds and it
     * removes a whole category of false result.
     */
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4319',
    /*
     * Never reuse whatever happens to be on the port.
     *
     * This cost an hour. Vite's default preview port, 4173, was already taken
     * on the development machine by an unrelated app, so `reuseExistingServer`
     * quietly pointed the whole suite at someone else's site: every page-driven
     * test failed with "element not found" while the one test that talks to the
     * feed over HTTP kept passing, which is exactly the shape of a bug that
     * looks like flakiness. `--strictPort` means our own server would rather
     * fail loudly than move, and false means we always get our own.
     */
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
