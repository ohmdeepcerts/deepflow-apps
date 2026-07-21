import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page build: one entry per app, matching the three deployed sites.
// See ARCHITECTURE_REDESIGN_PROPOSAL.md Part 2 for why this shape was chosen
// (static output only — GitHub Pages hosting doesn't change).
export default defineConfig({
  root: 'apps',
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
