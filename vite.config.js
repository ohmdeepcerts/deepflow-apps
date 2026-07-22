import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page build: one entry per app, matching the three deployed sites.
// See ARCHITECTURE_REDESIGN_PROPOSAL.md Part 2 for why this shape was chosen
// (static output only — GitHub Pages hosting doesn't change).
export default defineConfig({
  root: 'apps',
  // The production build is served from a GitHub Pages *project* site
  // (github.io/deepflow-apps/), not the domain root — every asset URL Vite
  // emits needs that prefix there or they'd 404. But the Playwright
  // migration-parity suite (tests/e2e/migration-parity.spec.js) and local
  // dev/preview all assume root-relative paths, matching how the site is
  // served everywhere except the real Pages deploy — so the prefix is opt-in
  // via GH_PAGES, set only in that one CI deploy step, never for local
  // builds or the build-and-test job.
  base: process.env.GH_PAGES ? '/deepflow-apps/' : '/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        office: resolve(__dirname, 'apps/office/index.html'),
        engineer: resolve(__dirname, 'apps/engineer/index.html'),
        portal: resolve(__dirname, 'apps/portal/index.html'),
      },
    },
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
