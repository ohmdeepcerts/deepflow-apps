import { defineConfig } from '@playwright/test';

// The regression baseline for the architecture migration
// (ARCHITECTURE_REDESIGN_PROPOSAL.md Part 4/5). Serves the repo root exactly
// as GitHub Pages does today — the real, currently-deployed index.html /
// engineer.html / client-portal.html, unauthenticated — so every migration
// phase can re-run this unchanged and prove nothing broke.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // The old, unmodified apps at the repo root — exactly what GitHub
      // Pages serves today.
      command: 'npx serve . -l 4173',
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      // The new Vite-built apps — migration-parity tests compare this
      // against port 4173 above to prove each phase changed nothing
      // observable.
      command: 'npm run build && npm run preview -- --port 4175 --strictPort',
      port: 4175,
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
    },
  ],
});
