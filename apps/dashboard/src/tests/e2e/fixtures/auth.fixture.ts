import { test as base, expect, type Page } from '@playwright/test';

/**
 * Admin credentials untuk E2E (disediakan via env, default dari spec).
 */
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@test.com';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password123';

/**
 * Login sebagai admin (dipakai di auth.setup.ts dan test mandiri).
 * Catatan: backend menerapkan rate limit 5 percobaan/15 menit pada login
 * admin — jangan panggil login berulang; pakai storageState (auth.setup).
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('**/admin', { timeout: 15_000 });
}

/**
 * Fixture authenticatedPage — page dengan session admin (storageState).
 * Tanpa login ulang per test.
 *
 * Contoh:
 * ```ts
 * test('navigasi', async ({ authenticatedPage }) => {
 *   await authenticatedPage.goto('/admin/products/magic-paste');
 * });
 * ```
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    // storageState dari setup project sudah menyediakan session admin.
    // Pastikan benar-benar ada sesi; jika tidak, halaman akan redirect ke login.
    await page.goto('/admin');
    await page.waitForURL('**/admin', { timeout: 15_000 });
    await use(page);
  },
});

export { expect };
