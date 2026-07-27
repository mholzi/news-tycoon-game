import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // No sourcemaps in production. The answer-exclusion test scans the built
    // output for the word `outcome`; a sourcemap would carry the original text
    // of every file into `dist/` and make that scan meaningless.
    sourcemap: false,
  },
});
