import { resolve } from 'node:path';
import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Copies apps/portal/sw.js to dist/portal/sw.js after build. Vite's normal
// asset pipeline only picks up files that are actually referenced from an
// HTML entry (<script>/<link>) or dropped in publicDir (which here maps to
// apps/public/, copied to the dist *root* — wrong location for a portal-
// relative registration). The service worker is registered at runtime via
// navigator.serviceWorker.register('./sw.js'), so Vite never sees the
// reference and never bundles or copies it — this plugin is the fix. (Dev
// mode needs no such step: Vite's dev server serves apps/portal/sw.js
// directly at /portal/sw.js since root is already 'apps'.)
const copyPortalServiceWorker = () => ({
  name: 'copy-portal-service-worker',
  closeBundle() {
    copyFileSync(
      resolve(__dirname, 'apps/portal/sw.js'),
      resolve(__dirname, 'dist/portal/sw.js')
    );
  },
});

// Multi-page build: one entry per app, matching the three deployed sites.
// See docs/history/2026-07-architecture-redesign/ARCHITECTURE_REDESIGN_PROPOSAL.md
// Part 2 for why this shape was chosen (static output only — GitHub Pages
// hosting doesn't change).
export default defineConfig({
  root: 'apps',
  plugins: [copyPortalServiceWorker()],
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
