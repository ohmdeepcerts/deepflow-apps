import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Deliberately separate from vite.config.js: that file sets `root: 'apps'`
// for the multi-page app build, which isn't appropriate for test discovery
// against /tests and /packages at the repo root. The `@` aliases are
// duplicated (not imported) from vite.config.js for the same reason —
// they're needed here so tests can import app modules (apps/office/*,
// apps/portal/*, etc.) that reference these packages by alias, same as
// the real build does.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'packages/core'),
      '@data': resolve(__dirname, 'packages/data'),
      '@auth': resolve(__dirname, 'packages/auth'),
      '@business': resolve(__dirname, 'packages/business'),
      '@ui': resolve(__dirname, 'packages/ui'),
      '@pdf': resolve(__dirname, 'packages/pdf'),
      '@offline': resolve(__dirname, 'packages/offline'),
    },
  },
});
