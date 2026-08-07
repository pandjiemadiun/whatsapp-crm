import { test, expect } from '@playwright/test';

test.describe('UX Cleanup Round 1 — Screenshots', () => {
  const authToken = 'b7f35799-6098-487d-8f91-afc48aae634a';

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('admin_token', 'b7f35799-6098-487d-8f91-afc48aae634a');
    });
  });

  test('D1 DashboardHome error state — 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/dashboard');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/d1-dashboard-375.png', fullPage: true });
  });

  test('D1 DashboardHome error state — 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/dashboard');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/d1-dashboard-1280.png', fullPage: true });
  });

  test('O2+O4 OrderManager — 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/orders');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/o2-ordermanager-375.png', fullPage: true });
  });

  test('O2+O4 OrderManager — 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/orders');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/o2-ordermanager-1280.png', fullPage: true });
  });

  test('PS2+PO3 ProfilePage — 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/admin/profile');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/ps2-profile-375.png', fullPage: true });
  });

  test('PS2+PO3 ProfilePage — 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/profile');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/ps2-profile-1280.png', fullPage: true });
  });

  test('P1 MagicPastePreview — Tingkat cocok labels', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/magic-paste');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/p1-magicpaste-1280.png', fullPage: true });
  });
});
