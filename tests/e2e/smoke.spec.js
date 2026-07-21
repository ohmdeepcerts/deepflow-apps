// Regression baseline — Phase 0 of ARCHITECTURE_REDESIGN_PROPOSAL.md.
//
// Captured against the *unmodified* production apps before any migration
// work begins. No login credentials are used (see the proposal, Part 4) —
// these are unauthenticated smoke checks: does the page load, does it show
// the right unauthenticated shell, and does it do so with zero console
// errors. Every later migration phase re-runs this file unchanged; a phase
// isn't done until it still passes.
import { test, expect } from '@playwright/test';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('Office App (index.html)', () => {
  test('loads the login screen with no console errors', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/index.html');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeVisible();
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});

test.describe('Employee App (engineer.html)', () => {
  test('loads the login screen with no console errors', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/engineer.html');
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});

test.describe('Client Portal (client-portal.html)', () => {
  test('shows the "you need your personal link" state when no id is present', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/client-portal.html');
    await expect(page.getByText('You need your personal link')).toBeVisible();
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('does not crash when given a nonsense id/type', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/client-portal.html?id=not-a-real-id&type=landlord');
    // No assertion on the exact error state shown (that's real, evolving
    // product behaviour) — the regression contract here is narrower and
    // more important: an invalid link must never produce an uncaught
    // exception in a page with no authentication of its own.
    await page.waitForTimeout(2000);
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});
