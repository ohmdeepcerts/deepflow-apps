import { defineConfig } from '@playwright/test';

// End-to-end regression suite for the three Vite-built apps
// (ARCHITECTURE_REDESIGN_PROPOSAL.md Part 4/5, Phase 7). The old root-level
// index.html / engineer.html / client-portal.html have been retired — this
// now serves and tests only the current build.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4175',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4175 --strictPort',
    port: 4175,
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
