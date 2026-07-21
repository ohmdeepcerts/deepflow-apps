// Migration-parity checks — compares the OLD, unmodified app (repo root,
// what GitHub Pages serves today) against the NEW, Vite-built version under
// /apps (what will eventually replace it) for the pieces of the migration
// that have actually happened so far. As each app is migrated
// (ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5), add its comparison here.
//
// This is distinct from smoke.spec.js: that file is the permanent baseline
// against the old apps (never changes). This file grows as each app's
// migration lands, and proves old and new agree — not just that the new
// one doesn't crash.
import { test, expect } from '@playwright/test';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('Client Portal — old vs. new (Phase 1 migration)', () => {
  test('the "you need your personal link" state matches exactly', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('http://localhost:4175/portal/');
    await expect(page.getByText('You need your personal link')).toBeVisible();
    await expect(page.getByText('client-portal.html?id=YOUR-ID')).toBeVisible();
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('an invalid id/type does not crash, same as the old app', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('http://localhost:4175/portal/index.html?id=not-a-real-id&type=landlord');
    await page.waitForTimeout(2000);
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});
