import { resolve, dirname } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'vite';

// Copies each app's sw.js to dist/<app>/sw.js after build. Vite's normal
// asset pipeline only picks up files that are actually referenced from an
// HTML entry (<script>/<link>) or dropped in publicDir (which here maps to
// apps/public/, copied to the dist *root* — wrong location for an app-
// relative registration). Every app's service worker is registered at
// runtime via navigator.serviceWorker.register('./sw.js'), so Vite never
// sees the reference and never bundles or copies it — this plugin is the
// fix. (Dev mode needs no such step: Vite's dev server serves each
// apps/<app>/sw.js directly at /<app>/sw.js since root is already 'apps'.)
// Originally portal-only (Client Portal push notifications); Office and
// Engineer gained their own sw.js/push flow later, so this copies all
// three rather than growing into three near-identical plugins.
const copyServiceWorkers = () => ({
  name: 'copy-service-workers',
  closeBundle() {
    for (const app of ['office', 'engineer', 'portal']) {
      const dest = resolve(__dirname, `dist/${app}/sw.js`);
      // closeBundle isn't guaranteed to fire after every app's dist/<app>/
      // directory has been written — on at least one Vite/Rolldown version
      // this ran before dist/office/ existed yet, since office is by far
      // the largest bundle. mkdirSync-recursive makes the copy robust to
      // that ordering regardless of which app finishes writing first.
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(resolve(__dirname, `apps/${app}/sw.js`), dest);
    }
  },
});

// Multi-page build: one entry per app, matching the three deployed sites.
// See docs/history/2026-07-architecture-redesign/ARCHITECTURE_REDESIGN_PROPOSAL.md
// Part 2 for why this shape was chosen (static output only — GitHub Pages
// hosting doesn't change).
export default defineConfig({
  root: 'apps',
  plugins: [copyServiceWorkers()],
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
