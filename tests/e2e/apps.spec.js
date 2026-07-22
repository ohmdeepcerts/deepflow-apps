// Standing regression suite for the three Vite-built apps. Originally
// written as "migration-parity" checks comparing the old flat-file apps
// against the new /apps build during the Phase 5 migration (see
// ARCHITECTURE_REDESIGN_PROPOSAL.md Part 5) — now that the old root-level
// index.html / engineer.html / client-portal.html have been retired
// (Phase 7) and the Vite build is the only version of these apps, this file
// is the permanent baseline: does each app's login/entry screen render with
// no console errors.
import { test, expect } from '@playwright/test';

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('Client Portal', () => {
  test('the "you need your personal link" state renders correctly', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/portal/');
    await expect(page.getByText('You need your personal link')).toBeVisible();
    await expect(page.getByText('portal/?id=YOUR-ID')).toBeVisible();
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('an invalid id/type does not crash', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/portal/index.html?id=not-a-real-id&type=landlord');
    await page.waitForTimeout(2000);
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});

test.describe('Employee App', () => {
  test('the login screen renders with no console errors', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/engineer/');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});

test.describe('Office App', () => {
  test('the login screen renders with no console errors', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/office/');
    await expect(page.locator('#login-email')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#login-btn')).toBeVisible();
    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });
});
