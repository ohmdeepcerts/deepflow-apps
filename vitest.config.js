import { defineConfig } from 'vitest/config';

// Deliberately separate from vite.config.js: that file sets `root: 'apps'`
// for the multi-page app build, which isn't appropriate for test discovery
// against /tests and /packages at the repo root.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
  },
});
