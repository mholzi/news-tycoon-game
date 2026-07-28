import { defineConfig, devices } from '@playwright/test';

/**
 * One project, not two.
 *
 * The site runs desktop and mobile because it makes a claim about reading on a
 * phone. The game makes no such claim yet, and a second project would double
 * the run time to assert something nobody has designed.
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
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
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
